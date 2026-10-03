#!/usr/bin/env node
// Tier B verification scenario. Runs Collara's governed verifier-registry actions against the GovernanceRules
// contract of the DM-onboarded decentralized party, confirming and executing through the members' DM nodes
// (POST /governance/confirm|execute, governance_type core_domain). Proposals are created through the Ledger API
// ("Path B" in DM's CUSTOM_DAML_TEMPLATES.md: DM's /governance/propose only knows its built-in proposal types).
//
// Checks (each with DM responses and ledger receipts under .local/tierb/receipts/scenario-*.json):
//   bootstrap   registry v0 through a governed execute
//   one         one confirmation cannot execute (DM execute + a direct Ledger API execute)
//   duplicate   a second confirmation by the same member does not count twice
//   two         two distinct members' confirmations execute AddVerifier, then SuspendVerifier
//   stale       a proposal pinned to an older registry version fails
//   attest      VR_IssueAttestation works before the suspension and fails after it (new and old accreditation)
//   lock        the governance party cannot release a CollateralLock
//   topology    with only p1 connected, a governance confirm cannot commit; with p1+p2 it can (p3 stays down)
//
//   node scripts/tierb/scenario.mjs [--skip-topology]
import { createHash } from "node:crypto";
import { acs, dm, errorOf, eventsOf, ledger, ledgerEnd, must, submit, submitWithOutcome, tpl, txReceipt } from "./clients.mjs";
import { REPO_WSL, readState, sleep, writeReceipt, writeState, wslScript } from "./lib.mjs";

const S = readState();
if (!S.governance?.rulesCid) {
  console.error("error: not onboarded (run scripts/tierb/onboard.mjs first)");
  process.exit(1);
}
const DEC = S.decParty;
const M = S.members; // { p1, p2, p3 }
const RULES = S.governance.rulesCid;
const NODE_OF = { [M.p1]: "p1", [M.p2]: "p2", [M.p3]: "p3" };

const T = {
  bootstrap: tpl("collara-governance", "Collara.Governance.Proposals", "BootstrapVerifierRegistryProposal"),
  add: tpl("collara-governance", "Collara.Governance.Proposals", "AddVerifierProposal"),
  suspend: tpl("collara-governance", "Collara.Governance.Proposals", "SuspendVerifierProposal"),
  registry: tpl("collara-governance", "Collara.Governance.Registry", "VerifierRegistry"),
  accreditation: tpl("collara-governance", "Collara.Governance.Registry", "VerifierAccreditation"),
  rules: tpl("governance-core-v1", "Governance.Rules", "GovernanceRules"),
  confirmation: tpl("governance-core-v1", "Governance.Confirmation", "GovernanceConfirmation"),
  result: tpl("governance-core-v1", "Governance.ExecutionResult", "GovernanceExecutionResult"),
  config: tpl("collara-contracts", "Collara.Config", "CollaraConfig"),
  request: tpl("collara-contracts", "Collara.Verification", "VerificationRequest"),
  lock: tpl("collara-contracts", "Collara.Control", "CollateralLock"),
};

const RUN = new Date().toISOString().replaceAll(":", "-");
const receipts = { run: RUN, decParty: DEC, members: M, rulesCid: RULES, checks: {}, log: [] };
const save = () => writeReceipt(`scenario-${RUN}`, receipts);
const log = (entry) => {
  receipts.log.push({ at: new Date().toISOString(), ...entry });
  save();
};
const check = (name, ok, detail) => {
  receipts.checks[name] = { ok, ...detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail?.summary ? ` - ${detail.summary}` : ""}`);
  save();
  if (!ok) throw new Error(`check ${name} failed`);
};
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

// --- ledger helpers ----------------------------------------------------------------------------------------------

async function grant(nodeName, parties) {
  const rights = parties.flatMap((party) => [{ kind: { CanActAs: { value: { party } } } }, { kind: { CanReadAs: { value: { party } } } }]);
  must(await ledger(nodeName, "POST", "/v2/users/ledger-api-user/rights", { userId: "ledger-api-user", rights, identityProviderId: "" }), `grant on ${nodeName}`);
}

/** Allocates `hint` on the participant, or reuses it when a previous run already did. */
async function allocate(nodeName, hint) {
  const res = await ledger(nodeName, "POST", "/v2/parties", { partyIdHint: hint, identityProviderId: "" });
  let party = res.ok ? res.json.partyDetails.party : undefined;
  if (!party && /already exists|already allocated/i.test(res.text)) {
    const list = must(await ledger(nodeName, "GET", "/v2/parties?pageSize=1000"), "list parties");
    party = list.partyDetails.find((d) => d.party.startsWith(`${hint}::`) && d.isLocal)?.party;
  }
  if (!party) must(res, `allocate ${hint}`);
  await grant(nodeName, [party]);
  return party;
}

async function createOn(nodeName, actAs, templateId, args, { readAs = [] } = {}) {
  const res = await submit(nodeName, { actAs, readAs, commands: [{ CreateCommand: { templateId, createArguments: args } }] });
  const tx = must(res, `create ${templateId}`).transaction;
  const created = eventsOf(tx).created.find((c) => c.templateId.endsWith(templateId.split(":").slice(1).join(":")));
  return { cid: created.contractId, receipt: txReceipt(tx) };
}

async function exerciseOn(nodeName, actAs, templateId, contractId, choice, choiceArgument, { readAs = [] } = {}) {
  const res = await submit(nodeName, { actAs, readAs, commands: [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }] });
  return { res, tx: res.ok ? res.json.transaction : undefined };
}

/** Transactions on `nodeName` after `begin` visible to `parties` (LEDGER_EFFECTS). */
async function updatesSince(nodeName, parties, begin) {
  const end = await ledgerEnd(nodeName);
  if (end <= begin) return [];
  const raw = must(
    await ledger(nodeName, "POST", "/v2/updates?limit=200&stream_idle_timeout_ms=1000", {
      beginExclusive: begin,
      endInclusive: end,
      updateFormat: {
        includeTransactions: {
          transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS",
          eventFormat: { filtersByParty: Object.fromEntries(parties.map((p) => [p, { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] }])), verbose: false },
        },
      },
    }),
    "updates",
  );
  return raw.map((u) => u?.update?.Transaction?.value).filter(Boolean);
}

async function findTx(nodeName, parties, begin, choice) {
  for (let i = 0; i < 20; i++) {
    const txs = await updatesSince(nodeName, parties, begin);
    const hit = txs.find((tx) => eventsOf(tx).exercised.some((x) => x.choice === choice));
    if (hit) return hit;
    await sleep(500);
  }
  return undefined;
}

async function active(nodeName, party, templateId) {
  return (await acs(nodeName, [party], [templateId])).contracts;
}

// --- DM helpers --------------------------------------------------------------------------------------------------

const PLACEHOLDER_ACTION = { type: "governance_set_threshold", new_threshold: 1 }; // required by the DTO, ignored for core_domain

async function dmConfirmations(nodeName) {
  const r = await dm(nodeName, "GET", `/governance/confirmations?party_id=${encodeURIComponent(DEC)}`);
  return must(r, `confirmations on ${nodeName}`);
}

/**
 * The DM feed entry for one proposal. The v1.12.0 binary does not return `executable_confirmation_cids` for domain
 * actions (later DM commits add it), so it is derived here the way DM's own e2e helper and UI do: the newest live
 * confirmation per current member, unexpired.
 */
async function domainAction(nodeName, proposalCid) {
  const c = await dmConfirmations(nodeName);
  const a = c.domain_actions?.find((x) => x.proposal_cid === proposalCid);
  if (a && !a.executable_confirmation_cids) {
    const now = Date.now() / 1000;
    const newest = new Map();
    for (const conf of a.confirmations ?? []) {
      if (!S.governance.members.includes(conf.confirming_party)) continue;
      if (conf.expires_at && conf.expires_at <= now) continue;
      const prev = newest.get(conf.confirming_party);
      if (!prev || conf.created_at > prev.created_at) newest.set(conf.confirming_party, conf);
    }
    a.executable_confirmation_cids = [...newest.values()].map((x) => x.contract_id);
    a.executable_confirmation_cids_derived = true;
  }
  return a;
}

/** Confirm through the member's own DM node; returns the new confirmation cid and the ledger receipt. */
async function dmConfirm(member, proposalCid, label) {
  const nodeName = NODE_OF[member];
  const before = new Set((await active(nodeName, member, T.confirmation)).map((c) => c.contractId));
  const begin = await ledgerEnd(nodeName);
  const body = { party_id: DEC, rules_contract_id: RULES, action: PLACEHOLDER_ACTION, governance_type: "core_domain", proposal_cid: proposalCid };
  const res = await dm(nodeName, "POST", "/governance/confirm", body, { timeoutMs: 300_000 });
  const entry = { label, kind: "dm-confirm", node: nodeName, member, request: body, dmStatus: res.status, dmResponse: res.json ?? res.text, ms: res.ms };
  if (!res.ok) {
    log(entry);
    return { ok: false, res, entry };
  }
  const after = (await active(nodeName, member, T.confirmation)).filter((c) => !before.has(c.contractId) && c.createArgument.confirmer === member);
  const tx = await findTx(nodeName, [member, DEC], begin, "GovernanceRules_ConfirmAction");
  entry.confirmationCid = after[0]?.contractId;
  entry.ledger = tx ? txReceipt(tx) : null;
  log(entry);
  return { ok: true, cid: entry.confirmationCid, entry };
}

/** Execute through `executor`'s DM node with the given confirmation cids. */
async function dmExecute(executor, proposalCid, confirmationCids, label) {
  const nodeName = NODE_OF[executor];
  const begin = await ledgerEnd(nodeName);
  const body = { party_id: DEC, rules_contract_id: RULES, action: PLACEHOLDER_ACTION, confirmation_cids: confirmationCids, disclosed_contracts: [], governance_type: "core_domain", proposal_cid: proposalCid };
  const res = await dm(nodeName, "POST", "/governance/execute", body, { timeoutMs: 300_000 });
  const entry = { label, kind: "dm-execute", node: nodeName, executor, request: body, dmStatus: res.status, dmResponse: res.json ?? res.text, ms: res.ms };
  if (res.ok) {
    const tx = await findTx(nodeName, [executor, DEC], begin, "GovernanceRules_ExecuteConfirmedAction");
    entry.ledger = tx ? txReceipt(tx) : null;
    entry.executionResult = tx ? eventsOf(tx).created.find((c) => c.templateId.endsWith(":Governance.ExecutionResult:GovernanceExecutionResult"))?.createArgument : null;
  } else {
    const end = await ledgerEnd(nodeName);
    const txs = await updatesSince(nodeName, [executor, DEC], begin);
    entry.ledgerAfterFailure = { ledgerEndBefore: begin, ledgerEndAfter: end, executeTransactions: txs.filter((tx) => eventsOf(tx).exercised.some((x) => x.choice === "GovernanceRules_ExecuteConfirmedAction")).length };
  }
  log(entry);
  return { ok: res.ok, res, entry };
}

const errText = (r) => (r.res?.json?.error ?? r.res?.text ?? "").toString();

// --- Canton console helpers (participant connectivity) -----------------------------------------------------------

function connectivity(action, targets) {
  const r = wslScript("infra/tierb/ctl.sh", {
    args: ["console", `${REPO_WSL}/infra/tierb/canton/connectivity.canton`, `ACTION=${action}`, `TARGETS=${targets.join(",")}`],
    capture: true,
    timeoutMs: 300_000,
  });
  const lines = (r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("TIERB_JSON ")).map((l) => JSON.parse(l.slice(11)));
  log({ kind: "connectivity", action, targets, exit: r.status, result: lines, stderr: r.status ? (r.stderr || r.stdout).slice(-2000) : undefined });
  if (r.status !== 0) throw new Error(`connectivity ${action} failed: ${(r.stderr || r.stdout).slice(-1500)}`);
  return lines;
}

function dmProcess(action, nodeName) {
  const r = wslScript("infra/tierb/ctl.sh", { args: [action, nodeName], capture: true, timeoutMs: 180_000 });
  log({ kind: "dm-process", action, node: nodeName, exit: r.status, out: (r.stdout || "").trim() });
  if (r.status !== 0) throw new Error(`${action} ${nodeName} failed: ${r.stderr || r.stdout}`);
}

// --- scenario ----------------------------------------------------------------------------------------------------

async function main() {
  const skipTopology = process.argv.includes("--skip-topology");
  console.log(`decentralized party ${DEC}\nrules ${RULES}`);

  // Collara business parties (synthetic), all on p1. The governance party is NOT hosted with submission rights
  // anywhere: it only signs through governed executes (and DM's interactive /contracts workflow).
  const registrar = await allocate("p1", "tierb-CollaraRegistrar");
  const owner = await allocate("p1", "tierb-DemoManufacturer");
  const verifier = await allocate("p1", "tierb-DemoVerifier");
  const lender = await allocate("p1", "tierb-DemoLenderA");
  receipts.parties = { registrar, owner, verifier, lender };
  // Members read as the decentralized party (DM's own convention) on their participant; rights already granted
  // by onboard.mjs for ledger-api-user.

  const config = await createOn("p1", [registrar], T.config, {
    registrar, namespace: "collara-tierb", governanceParty: DEC, suspensionPolicy: "REQUIRE_ACTIVE_VERIFIER", configVersion: "1", directory: [verifier, lender],
  });
  log({ kind: "setup", what: "CollaraConfig pinned to the decentralized governance party", cid: config.cid, ledger: config.receipt });

  // 1. Bootstrap the registry (v0) ----------------------------------------------------------------------------------
  const boot = await createOn("p1", [M.p1], T.bootstrap, {
    governanceParty: DEC, proposer: M.p1, operator: registrar, registryId: "collara-tierb-registry", genesisVerifiers: [],
    proposalDeadline: iso(2 * 3600_000), reason: "Bootstrap the Tier B verifier registry (synthetic demo)",
  }, { readAs: [DEC] });
  log({ kind: "propose", label: "bootstrap", proposer: M.p1, proposalCid: boot.cid, ledger: boot.receipt });
  const b1 = await dmConfirm(M.p1, boot.cid, "bootstrap:confirm m1");
  const b2 = await dmConfirm(M.p2, boot.cid, "bootstrap:confirm m2");
  const bview = await domainAction("p2", boot.cid);
  const bx = await dmExecute(M.p2, boot.cid, bview.executable_confirmation_cids, "bootstrap:execute by m2");
  const reg0 = (await active("p1", registrar, T.registry))[0];
  check("bootstrap", bx.ok && b1.ok && b2.ok && reg0?.createArgument.version === "0", {
    summary: `registry v${reg0?.createArgument.version} ${reg0?.contractId?.slice(0, 16)}…`,
    registryCid: reg0?.contractId, executeUpdateId: bx.entry.ledger?.updateId, executeOffset: bx.entry.ledger?.offset, confirmers: bx.entry.executionResult?.confirmers,
  });

  // 2. AddVerifier proposal A and a competing proposal B, both pinned to v0 -----------------------------------------
  const addArgs = (ref) => ({
    governanceParty: DEC, proposer: M.p1, registryCid: reg0.contractId, expectedVersion: "0", verifier, verifierRef: "VER-001",
    orgName: "Demo Verifier", scope: ["CNC_MACHINERY"], validUntil: null, proposalDeadline: iso(2 * 3600_000), reason: `Accredit Demo Verifier (${ref})`,
  });
  const A = await createOn("p1", [M.p1], T.add, addArgs("proposal A"), { readAs: [DEC] });
  const B = await createOn("p1", [M.p1], T.add, addArgs("proposal B, competing filing"), { readAs: [DEC] });
  log({ kind: "propose", label: "add A", proposalCid: A.cid, ledger: A.receipt });
  log({ kind: "propose", label: "add B (competing, same pin v0)", proposalCid: B.cid, ledger: B.receipt });

  // one confirmation cannot execute
  const a1 = await dmConfirm(M.p1, A.cid, "add A:confirm m1");
  const viewOne = await domainAction("p1", A.cid);
  const oneDm = await dmExecute(M.p1, A.cid, [a1.cid], "add A:execute with 1 confirmation (DM)");
  const oneDirect = await exerciseOn("p1", [M.p1], T.rules, RULES, "GovernanceRules_ExecuteConfirmedAction", { executor: M.p1, actionProposalCid: A.cid, confirmations: [a1.cid] }, { readAs: [DEC] });
  log({ kind: "ledger-execute", label: "add A:execute with 1 confirmation (direct Ledger API)", ok: oneDirect.res.ok, error: oneDirect.res.ok ? undefined : errorOf(oneDirect.res) });
  check("one_confirmation_cannot_execute", !oneDm.ok && !oneDirect.res.ok && /Enough confirmations/.test(errText(oneDm)) && oneDm.entry.ledgerAfterFailure.executeTransactions === 0, {
    summary: `DM HTTP ${oneDm.res.status}; ledger ${oneDirect.res.json?.code ?? oneDirect.res.status}`,
    dmView: { confirmation_count: viewOne?.confirmation_count, can_execute: viewOne?.can_execute, threshold: S.governance.threshold },
    dmError: errText(oneDm).slice(0, 600), ledgerError: errorOf(oneDirect.res),
  });

  // duplicate confirmation by the same member does not count twice
  const a1b = await dmConfirm(M.p1, A.cid, "add A:confirm m1 again (duplicate)");
  const viewDup = await domainAction("p1", A.cid);
  const dupDm = await dmExecute(M.p1, A.cid, [a1.cid, a1b.cid], "add A:execute with m1+m1 (DM)");
  check("duplicate_confirmation_does_not_count", a1b.ok && !dupDm.ok && /No duplicate confirmers/.test(errText(dupDm)) && viewDup?.can_execute === false, {
    summary: `second m1 confirmation accepted (${a1b.cid?.slice(0, 12)}…), DM count ${viewDup?.confirmation_count}, can_execute ${viewDup?.can_execute}; execute m1+m1 rejected`,
    dmView: { confirmation_count: viewDup?.confirmation_count, can_execute: viewDup?.can_execute, executable_confirmation_cids: viewDup?.executable_confirmation_cids },
    dmError: errText(dupDm).slice(0, 600),
  });

  // two distinct members execute AddVerifier
  await dmConfirm(M.p2, A.cid, "add A:confirm m2");
  const viewTwo = await domainAction("p2", A.cid);
  const addX = await dmExecute(M.p2, A.cid, viewTwo.executable_confirmation_cids, "add A:execute by m2 with m1+m2");
  const reg1 = (await active("p1", registrar, T.registry))[0];
  const acc1 = (await active("p1", verifier, T.accreditation)).find((c) => c.createArgument.status === "ACTIVE");
  check("two_confirmations_execute_add", addX.ok && reg1?.createArgument.version === "1" && Boolean(acc1), {
    summary: `registry v${reg1?.createArgument.version}, accreditation ${acc1?.createArgument.verifierRef} ACTIVE`,
    executeUpdateId: addX.entry.ledger?.updateId, executeOffset: addX.entry.ledger?.offset, executionResult: addX.entry.executionResult,
    usedConfirmations: viewTwo.executable_confirmation_cids, registryCid: reg1?.contractId, accreditationCid: acc1?.contractId,
  });

  // stale: competing proposal B (pinned to v0) cannot execute after A moved the registry to v1
  await dmConfirm(M.p2, B.cid, "add B:confirm m2");
  await dmConfirm(M.p3, B.cid, "add B:confirm m3");
  const viewB = await domainAction("p3", B.cid);
  const staleX = await dmExecute(M.p3, B.cid, viewB.executable_confirmation_cids, "add B:execute by m3 (stale pin v0)");
  check("stale_proposal_fails", viewB?.can_execute === true && !staleX.ok && staleX.entry.ledgerAfterFailure.executeTransactions === 0, {
    summary: `DM can_execute=${viewB?.can_execute} (2 confirmations) but the ledger rejected the execute`,
    dmError: errText(staleX).slice(0, 800),
  });

  // 3. Attestation before suspension ----------------------------------------------------------------------------------
  const anchor = { packageRef: "EVP-ASSET-DEMO-001", manifestVersion: "1", manifestHash: createHash("sha256").update("collara-tierb-synthetic-manifest-v1").digest("hex") };
  const newRequest = async (ref) => createOn("p1", [owner], T.request, {
    owner, verifier, registrar, namespace: "collara-tierb", requestRef: ref, assetId: "ASSET-DEMO-001", passportVersion: "1", caseRef: "CL-001",
    evidence: anchor, equipmentScope: "CNC_MACHINERY", checklist: ["Serial plate SYNTH-CNC-001", "Model DEMO-CNC-500"], dueBy: null, status: "REQUESTED", version: "1", changeNote: "",
  });
  const accept = async (requestCid, accreditationCid) => {
    const r = await exerciseOn("p1", [verifier], T.request, requestCid, "VR_AcceptAssignment", { configCid: config.cid, accreditationCid, actorRef: "tierb-verifier" });
    return { ...r, cid: r.tx ? eventsOf(r.tx).created.find((c) => c.templateId.endsWith(":Collara.Verification:VerificationRequest"))?.contractId : undefined };
  };
  const issue = (requestCid, accreditationCid, ref) => exerciseOn("p1", [verifier], T.request, requestCid, "VR_IssueAttestation", {
    configCid: config.cid, accreditationCid, attestationRef: ref,
    checks: [{ item: "Serial plate", finding: "Matches SYNTH-CNC-001 (synthetic)", result: "CHECKED" }],
    limitations: "Synthetic demo data.", method: "Document review (synthetic)", inspectedAt: iso(0), validFrom: iso(0), validUntil: iso(180 * 86400_000), supersedes: null, actorRef: "tierb-verifier",
  });
  const r1 = await newRequest("VR-TIERB-001");
  const r1a = await accept(r1.cid, acc1.contractId);
  const att1 = await issue(r1a.cid, acc1.contractId, "ATT-TIERB-001");
  const att1Receipt = att1.tx ? txReceipt(att1.tx) : null;
  log({ kind: "attest", label: "issue before suspension", ok: att1.res.ok, ledger: att1Receipt, error: att1.res.ok ? undefined : errorOf(att1.res) });
  // Q4 (research-dm.md §11): does the accreditation fetch inform the governance members' participants?
  // Only the Ledger API stream is checked here; whether the fetch needs the governance party's confirmation is
  // measured in step 7 (issuance-side check with only p1 connected).
  const seenOn = {};
  for (const n of ["p2", "p3"]) {
    const tx = att1Receipt ? (await updatesSince(n, [DEC], 0)).find((t) => t.updateId === att1Receipt.updateId) : undefined;
    seenOn[n] = Boolean(tx);
  }
  // A second request accepted while the verifier is still active (issued after the suspension below).
  const r2 = await newRequest("VR-TIERB-002");
  const r2a = await accept(r2.cid, acc1.contractId);
  check("attestation_before_suspension", att1.res.ok && r2a.res.ok, {
    summary: `ATT-TIERB-001 issued (${att1Receipt?.updateId?.slice(0, 16)}…); in the governance party's Ledger API stream on p2/p3: ${JSON.stringify(seenOn)}`,
    updateId: att1Receipt?.updateId, offset: att1Receipt?.offset, inGovernancePartyStreamOn: seenOn,
  });

  // 4. SuspendVerifier: proposed by m2 on p2, confirmed by m2 + m3, executed by m1 -------------------------------
  const S1 = await createOn("p2", [M.p2], T.suspend, {
    governanceParty: DEC, proposer: M.p2, registryCid: reg1.contractId, expectedVersion: "1", accreditationCid: acc1.contractId, verifier,
    proposalDeadline: iso(2 * 3600_000), reason: "Suspend Demo Verifier pending re-accreditation (synthetic)",
  }, { readAs: [DEC] });
  log({ kind: "propose", label: "suspend", proposer: M.p2, proposalCid: S1.cid, ledger: S1.receipt });
  await dmConfirm(M.p2, S1.cid, "suspend:confirm m2");
  await dmConfirm(M.p3, S1.cid, "suspend:confirm m3");
  const viewS = await domainAction("p1", S1.cid);
  const susX = await dmExecute(M.p1, S1.cid, viewS.executable_confirmation_cids, "suspend:execute by m1 with m2+m3");
  const reg2 = (await active("p1", registrar, T.registry))[0];
  const acc2 = (await active("p1", verifier, T.accreditation)).find((c) => c.createArgument.verifier === verifier);
  check("two_confirmations_execute_suspend", susX.ok && reg2?.createArgument.version === "2" && acc2?.createArgument.status === "SUSPENDED", {
    summary: `registry v${reg2?.createArgument.version}, accreditation ${acc2?.createArgument.status}`,
    executeUpdateId: susX.entry.ledger?.updateId, executeOffset: susX.entry.ledger?.offset, executionResult: susX.entry.executionResult,
    registryCid: reg2?.contractId, accreditationCid: acc2?.contractId,
  });

  // 5. Suspension blocks a subsequent attestation issuance ------------------------------------------------------------
  const att2new = await issue(r2a.cid, acc2.contractId, "ATT-TIERB-002");
  const att2old = await issue(r2a.cid, acc1.contractId, "ATT-TIERB-002");
  log({ kind: "attest", label: "issue after suspension, current (SUSPENDED) accreditation", ok: att2new.res.ok, error: att2new.res.ok ? undefined : errorOf(att2new.res) });
  log({ kind: "attest", label: "issue after suspension, archived ACTIVE accreditation", ok: att2old.res.ok, error: att2old.res.ok ? undefined : errorOf(att2old.res) });
  check("suspension_blocks_attestation", !att2new.res.ok && /Verifier suspended/.test(att2new.res.text) && !att2old.res.ok, {
    summary: `new cid: ${errorOf(att2new.res).code}; archived cid: ${errorOf(att2old.res).code}`,
    currentAccreditation: errorOf(att2new.res), archivedAccreditation: errorOf(att2old.res),
  });

  // 6. Governance cannot release a collateral lock --------------------------------------------------------------------
  const lock = await createOn("p1", [registrar, owner, lender], T.lock, {
    registrar, owner, lender, namespace: "collara-tierb", assetId: "ASSET-DEMO-001", controlVersion: "2", evidence: anchor, lockRef: "LOCK-TIERB-001", caseRef: "CL-001",
    authorizationRef: "AUTH-TIERB-001", agreementRef: "AGR-TIERB-001", attestationRef: "ATT-TIERB-001", activatedAt: iso(0), activatedByRef: "tierb-lender",
  });
  log({ kind: "setup", what: "CollateralLock created directly by registrar+owner+lender (test fixture, not Control_Activate)", cid: lock.cid, ledger: lock.receipt });
  const relGov = await exerciseOn("p1", [DEC], T.lock, lock.cid, "Lock_Release", { releaseRequestRef: "REL-TIERB-GOV", actorRef: "governance" });
  const relMember = await exerciseOn("p1", [M.p1], T.lock, lock.cid, "Lock_Release", { releaseRequestRef: "REL-TIERB-M1", actorRef: "gov-member-p1" }, { readAs: [DEC] });
  const stillLocked = (await active("p1", lender, T.lock)).some((c) => c.contractId === lock.cid);
  log({ kind: "lock", label: "Lock_Release actAs decentralized governance party", ok: relGov.res.ok, error: relGov.res.ok ? undefined : errorOf(relGov.res) });
  log({ kind: "lock", label: "Lock_Release actAs governance member m1 (readAs governance party)", ok: relMember.res.ok, error: relMember.res.ok ? undefined : errorOf(relMember.res) });
  check("governance_cannot_release_lock", !relGov.res.ok && !relMember.res.ok && stillLocked, {
    summary: `governance party: ${errorOf(relGov.res).code}; member: ${errorOf(relMember.res).code}; lock still active`,
    asGovernanceParty: errorOf(relGov.res), asMember: errorOf(relMember.res),
    codePath: "collara-governance has no dependency on collara-contracts and no template that references CollateralLock; Lock_Release is controlled by the lender only",
  });

  writeState({ scenario: { run: RUN, registryCid: reg2.contractId, accreditationCid: acc2.contractId, configCid: config.cid, parties: receipts.parties } });
  if (skipTopology) return;

  // 7. Topology threshold: one member participant vs two ---------------------------------------------------------------
  const C = await createOn("p1", [M.p1], T.add, {
    governanceParty: DEC, proposer: M.p1, registryCid: reg2.contractId, expectedVersion: "2", verifier, verifierRef: "VER-001",
    orgName: "Demo Verifier", scope: ["CNC_MACHINERY"], validUntil: null, proposalDeadline: iso(2 * 3600_000), reason: "Re-accredit Demo Verifier (topology test)",
  }, { readAs: [DEC] });
  log({ kind: "propose", label: "add C (topology test)", proposalCid: C.cid, ledger: C.receipt });
  dmProcess("dm-stop", "p2");
  dmProcess("dm-stop", "p3");
  connectivity("disconnect", ["p2", "p3"]);
  const t0 = Date.now();
  const oneUp = await dmConfirm(M.p1, C.cid, "add C:confirm m1 with only p1 connected");
  const oneUpMs = Date.now() - t0;
  connectivity("reconnect", ["p2"]);
  dmProcess("dm-start", "p2");
  await sleep(3000);
  const twoUp1 = await dmConfirm(M.p1, C.cid, "add C:confirm m1 with p1+p2 connected");
  const twoUp2 = await dmConfirm(M.p2, C.cid, "add C:confirm m2 with p1+p2 connected");
  const viewC = await domainAction("p1", C.cid);
  const cX = await dmExecute(M.p1, C.cid, viewC?.executable_confirmation_cids ?? [], "add C:execute by m1 with p3 down");
  check("topology_threshold_one_vs_two", !oneUp.ok && twoUp1.ok && twoUp2.ok && cX.ok, {
    summary: `only p1: confirm failed after ${Math.round(oneUpMs / 1000)} s; p1+p2: confirm x2 + execute committed with p3 offline`,
    oneUpError: (oneUp.res?.json?.error ?? oneUp.res?.text ?? "").slice(0, 800),
    twoUpExecuteUpdateId: cX.entry.ledger?.updateId, twoUpExecuteOffset: cX.entry.ledger?.offset,
  });

  // 8. Does attestation-side use of the accreditation need the governance party's participants? (research Q4)
  const acc3 = (await active("p1", verifier, T.accreditation)).find((c) => c.createArgument.status === "ACTIVE");
  const r3 = await newRequest("VR-TIERB-003");
  connectivity("disconnect", ["p2"]);
  const fetchOutcome = await submitWithOutcome("p1", {
    actAs: [verifier],
    commands: [{ ExerciseCommand: { templateId: T.request, contractId: r3.cid, choice: "VR_AcceptAssignment", choiceArgument: { configCid: config.cid, accreditationCid: acc3.contractId, actorRef: "tierb-verifier" } } }],
  });
  log({ kind: "attest", label: "VR_AcceptAssignment (fetches the governance-signed accreditation) with only p1 connected", outcome: fetchOutcome });
  connectivity("reconnect", ["p2", "p3"]);
  dmProcess("dm-start", "p3");
  // Control: the same acceptance once p2 and p3 are back.
  const fetchControl = await submitWithOutcome("p1", {
    actAs: [verifier],
    commands: [{ ExerciseCommand: { templateId: T.request, contractId: r3.cid, choice: "VR_AcceptAssignment", choiceArgument: { configCid: config.cid, accreditationCid: acc3.contractId, actorRef: "tierb-verifier" } } }],
  });
  log({ kind: "attest", label: "VR_AcceptAssignment again with all three participants connected", outcome: fetchControl });
  receipts.checks.accreditation_fetch_needs_governance_threshold = {
    ok: !fetchOutcome.accepted && fetchControl.accepted,
    observation: fetchOutcome.accepted
      ? "committed with only p1: the accreditation fetch did not need the governance party's other participants"
      : `rejected with only p1 (${fetchOutcome.status?.message?.split(":")[0] ?? fetchOutcome.phase}); committed once p2+p3 were back`,
    onlyP1: fetchOutcome, allThree: fetchControl,
  };
  const r3ms = fetchOutcome.ms;
  console.log(`INFO accreditation fetch: ${receipts.checks.accreditation_fetch_needs_governance_threshold.observation} (${Math.round(r3ms / 1000)} s)`);
  save();
}

main()
  .catch((e) => {
    receipts.error = e.stack || e.message;
    console.error(e.stack || e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    receipts.finishedAt = new Date().toISOString();
    console.log(`receipts: ${save()}`);
  });
