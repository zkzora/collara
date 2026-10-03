#!/usr/bin/env node
// Tier B onboarding through the Decentralization Manager REST API (mirrors DM's own e2e phases:
// integration-tests/common.sh::configure_peers, crates/decman/tests/common/phases/{create_dec_party,
// distribute_dars,deploy_gov_core}.rs):
//
//   1. peer mesh: each node's Noise key + participant id -> POST /network-config on every node, then restart
//   2. POST /onboarding on p1 (threshold 2, peers p2+p3); p2 and p3 accept the invitation
//   3. member parties gov-member-p{1,2,3} (one per participant) + ledger-api-user rights; PUT /party-config
//   4. POST /dars/upload + /dars/distribute: DM governance DARs + Collara DARs; p2 and p3 accept
//   5. POST /contracts: GovernanceRules signed by the decentralized party (members m1..m3, threshold 2, 30 min)
//
// Every DM response is saved under .local/tierb/receipts/onboard-*.json.
//   node scripts/tierb/onboard.mjs [--prefix=collara-gov] [--threshold=2]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_USER, dm, ledger, must } from "./clients.mjs";
import { NODES, REPO_ROOT, fail, readState, sleep, writeReceipt, writeState, wslScript } from "./lib.mjs";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const PREFIX = arg("prefix", "collara-gov");
const THRESHOLD = Number(arg("threshold", "2"));
const RULES_TIMEOUT_US = 30 * 60 * 1_000_000;

const DARS = [
  ["governance-action-v1-0.1.0.dar", "daml/collara/vendor-dars/governance-action-v1-0.1.0.dar"],
  ["governance-core-v1-0.1.0.dar", "daml/collara/vendor-dars/governance-core-v1-0.1.0.dar"],
  ["collara-governance-0.1.0.dar", "daml/collara/governance/.daml/dist/collara-governance-0.1.0.dar"],
  ["collara-contracts-0.2.0.dar", "daml/collara/contracts/.daml/dist/collara-contracts-0.2.0.dar"],
];

const receipts = [];
function record(step, res, extra = {}) {
  receipts.push({ step, at: new Date().toISOString(), method: res.method, url: res.url, status: res.status, ms: res.ms, response: res.json ?? res.text.slice(0, 4000), ...extra });
}
const call = async (step, nodeName, method, path, body) => {
  const res = await dm(nodeName, method, path, body);
  record(step, res, { node: nodeName, request: body && JSON.stringify(body).length < 4000 ? body : body ? "<large>" : undefined });
  return must(res, `${step} (${nodeName} ${method} ${path})`);
};

async function waitFor(what, check, { timeoutMs = 240_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${what}: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 500)}`);
}

async function acceptInvitation(nodeName, type, step) {
  const inv = await waitFor(`${type} invitation on ${nodeName}`, async () => {
    const r = await dm(nodeName, "GET", "/invitations");
    return r.json?.invitations?.find((i) => i.invitation_type === type);
  }, { timeoutMs: 90_000 });
  record(`${step}:invitation`, { method: "GET", url: `/invitations@${nodeName}`, status: 200, ms: 0, json: inv });
  await call(`${step}:accept`, nodeName, "POST", "/invitations/accept", { id: inv.id });
  return inv;
}

async function waitWorkflow(path, step) {
  const final = await waitFor(`${path} completed`, async () => {
    const r = await dm("p1", "GET", path);
    const s = r.json?.status;
    if (s && /^failed$/i.test(s)) throw Object.assign(new Error(`${path} failed: ${r.json.error ?? r.text}`), { fatal: true, json: r.json });
    return s && /^completed$/i.test(s) ? r.json : undefined;
  }, { timeoutMs: 300_000, intervalMs: 1500 }).catch((e) => {
    if (e.fatal) throw e;
    throw e;
  });
  record(`${step}:status`, { method: "GET", url: path, status: 200, ms: 0, json: final });
  return final;
}

function restartDm(nodeName) {
  const r = wslScript("infra/tierb/ctl.sh", { args: ["dm-restart", nodeName], capture: true, timeoutMs: 180_000 });
  if (r.status !== 0) throw new Error(`dm-restart ${nodeName} failed: ${r.stderr || r.stdout}`);
  process.stdout.write(r.stdout);
}

async function main() {
  const state = readState();
  if (state.governance?.rulesCid) {
    console.log(`already onboarded (decentralized party ${state.decParty}); run down + up for a fresh topology`);
    return;
  }
  if (process.argv.includes("--resume-rules") && state.decParty && state.members) {
    await readRules(state.decParty);
    return;
  }

  // 1. Peer mesh --------------------------------------------------------------------------------------------
  const peers = [];
  for (const n of NODES) {
    const keys = await call("peers:keys", n.name, "GET", "/keys/status");
    const cfg = await call("peers:node-config", n.name, "GET", "/node-config");
    peers.push({ participant_id: cfg.node.participant_id, name: `Collara member ${n.name}`, address: "127.0.0.1", port: n.dmNoise, public_key: keys.public_key, party: null });
  }
  for (const n of NODES) await call("peers:network-config", n.name, "POST", "/network-config", peers);
  console.log("peer mesh configured; restarting DM nodes so they load the peer keys");
  for (const n of NODES) restartDm(n.name);
  await sleep(5000);
  const participants = Object.fromEntries(NODES.map((n, i) => [n.name, peers[i].participant_id]));
  writeState({ participants });

  // 2. Onboarding: decentralized party hosted on p1, p2, p3 -----------------------------------------------------
  const onboarding = { party_id_prefix: PREFIX, peer_ids: [participants.p2, participants.p3], threshold: THRESHOLD };
  await call("onboarding:start", "p1", "POST", "/onboarding", onboarding);
  await Promise.all([acceptInvitation("p2", "Onboarding", "onboarding"), acceptInvitation("p3", "Onboarding", "onboarding")]);
  await waitWorkflow("/onboarding/status", "onboarding");
  const parties = await waitFor("decentralized party", async () => {
    const r = await dm("p1", "GET", "/decentralized-parties");
    return r.json?.parties?.find((p) => (p.party_id?.prefix ?? String(p.party_id).split("::")[0]) === PREFIX) && r.json;
  }, { timeoutMs: 60_000 });
  record("onboarding:decentralized-parties", { method: "GET", url: "/decentralized-parties", status: 200, ms: 0, json: parties });
  const decEntry = parties.parties.find((p) => (p.party_id?.prefix ?? String(p.party_id).split("::")[0]) === PREFIX);
  const decParty = typeof decEntry.party_id === "string" ? decEntry.party_id : `${decEntry.party_id.prefix}::${decEntry.party_id.namespace ?? decEntry.party_id.fingerprint}`;
  console.log(`decentralized party: ${decParty}`);
  writeState({ decParty, decPartyEntry: decEntry });

  // 3. Member parties, rights, party-config ---------------------------------------------------------------------
  const members = {};
  for (const n of NODES) {
    const res = await ledger(n.name, "POST", "/v2/parties", { partyIdHint: `gov-member-${n.name}`, identityProviderId: "" });
    record("members:allocate", res, { node: n.name });
    members[n.name] = must(res, `allocate gov-member-${n.name}`).partyDetails.party;
  }
  for (const n of NODES) {
    const rights = [members[n.name], decParty].flatMap((party) => [
      { kind: { CanActAs: { value: { party } } } },
      { kind: { CanReadAs: { value: { party } } } },
    ]);
    const res = await ledger(n.name, "POST", `/v2/users/${ADMIN_USER}/rights`, { userId: ADMIN_USER, rights, identityProviderId: "" });
    record("members:grant-rights", res, { node: n.name });
    must(res, `grant rights on ${n.name}`);
  }
  for (const n of NODES) {
    await call("members:party-config", n.name, "PUT", "/party-config", {
      dec_party_id: decParty,
      member_party_id: members[n.name],
      user_id: ADMIN_USER,
      keycloak_url: "",
      keycloak_realm: "",
      keycloak_client_id: "",
      packages: { governance_action: "#governance-action-v1", governance_core: "#governance-core-v1" },
    });
  }
  writeState({ members });

  // 4. DAR distribution -------------------------------------------------------------------------------------------
  const darFiles = DARS.map(([filename, rel]) => ({ filename, data: readFileSync(join(REPO_ROOT, rel)).toString("base64") }));
  await call("dars:upload", "p1", "POST", "/dars/upload", { dar_files: darFiles });
  await call("dars:distribute", "p1", "POST", "/dars/distribute", { dar_files: darFiles, peer_ids: [participants.p2, participants.p3] });
  await Promise.all([acceptInvitation("p2", "Dars", "dars"), acceptInvitation("p3", "Dars", "dars")]);
  await waitWorkflow("/dars/distribute/status", "dars");
  for (const n of NODES) await call("dars:vetted", n.name, "GET", "/packages/vetted").catch((e) => console.warn(`vetted check on ${n.name}: ${e.message}`));

  // 5. GovernanceRules signed by the decentralized party ----------------------------------------------------------
  const uids = decEntry.participants.map((p) => (typeof p.participant_uid === "string" ? p.participant_uid : `${p.participant_uid.prefix ?? ""}`));
  const contracts = {
    decentralized_party_id: decParty,
    participant_ids: uids,
    participant_parties: [members.p1, members.p2, members.p3],
    operator_party: members.p1,
    contracts: [{
      id: "collara-governance-rules",
      name: "GovernanceRules",
      package_id: "#governance-core-v1",
      module_name: "Governance.Rules",
      entity_name: "GovernanceRules",
      fields: [
        { type: "decentralized_party" },
        { type: "party_set", parties: [members.p1, members.p2, members.p3] },
        { type: "int64", value: THRESHOLD },
        { type: "rel_time", microseconds: RULES_TIMEOUT_US },
        { type: "none" },
      ],
    }],
  };
  await call("contracts:start", "p1", "POST", "/contracts", contracts);
  await Promise.all([acceptInvitation("p2", "Contracts", "contracts"), acceptInvitation("p3", "Contracts", "contracts")]);
  await waitWorkflow("/contracts/status", "contracts");
  await readRules(decParty);
}

/** GET /governance/state on every node: each member's DM node must see the same GovernanceRules. */
async function readRules(decParty) {
  const seen = {};
  for (const n of NODES) {
    const wrapped = await waitFor(`GovernanceRules state on ${n.name}`, async () => {
      const r = await dm(n.name, "GET", `/governance/state?party_id=${encodeURIComponent(decParty)}`);
      return r.ok && r.json?.state?.contract_id ? r.json : undefined;
    }, { timeoutMs: 60_000 });
    record("contracts:governance-state", { method: "GET", url: `/governance/state@${n.name}`, status: 200, ms: 0, json: wrapped });
    seen[n.name] = wrapped.state;
  }
  const gov = seen.p1;
  if (!NODES.every((n) => seen[n.name].contract_id === gov.contract_id)) throw new Error("DM nodes disagree on the GovernanceRules contract");
  console.log(`GovernanceRules ${gov.contract_id} threshold ${gov.threshold} of ${gov.members.length} (same on all three DM nodes)`);
  writeState({ governance: { rulesCid: gov.contract_id, threshold: gov.threshold, members: gov.members, timeoutUs: gov.action_confirmation_timeout_microseconds, packageRef: gov.package_ref } });
}

main()
  .catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    const file = writeReceipt(`onboard-${new Date().toISOString().replaceAll(":", "-")}`, receipts);
    console.log(`receipts: ${file}`);
    if (process.exitCode) fail("onboarding did not complete");
  });
