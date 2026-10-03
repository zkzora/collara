#!/usr/bin/env node
// Writes docs/evidence/tierb-summary.json from the newest Tier B receipts (.local/tierb/receipts) and the WSL
// install manifest. Compact: ids, offsets, thresholds, error codes; the full DM responses stay in the receipts.
//   node scripts/tierb/summary.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RECEIPTS_DIR, REPO_ROOT, fail, wslScript } from "./lib.mjs";

const newest = (prefix) => {
  const f = readdirSync(RECEIPTS_DIR).filter((n) => n.startsWith(prefix)).sort().at(-1);
  return f ? { file: f, data: JSON.parse(readFileSync(join(RECEIPTS_DIR, f), "utf8")) } : undefined;
};
const scenario = newest("scenario-");
const topology = newest("topology-");
const signing = newest("signing-");
const onboardFiles = readdirSync(RECEIPTS_DIR).filter((n) => n.startsWith("onboard-")).sort();
// The onboarding run that produced the scenario's decentralized party.
const onboard = onboardFiles
  .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(RECEIPTS_DIR, f), "utf8")) }))
  .filter((o) => o.data.some((x) => x.step === "onboarding:decentralized-parties" && JSON.stringify(x.response).includes(scenario?.data.decParty)))
  .at(-1);
if (!scenario || !onboard) fail("missing scenario or onboarding receipts");

const manifest = wslScript("infra/tierb/ctl.sh", { args: ["status"], capture: true }).stdout ?? "";
const install = (wslScript("infra/tierb/manifest.sh", { capture: true }).stdout ?? "").trim().split(/\r?\n/).filter(Boolean);

const step = (name) => onboard.data.filter((x) => x.step === name);
const s = scenario.data;
const log = s.log;
const byLabel = (label) => log.find((l) => l.label === label);
const lr = (l) => (l?.ledger ? { updateId: l.ledger.updateId, offset: l.ledger.offset } : null);

const summary = {
  generatedBy: "scripts/tierb/summary.mjs",
  generatedAt: new Date().toISOString(),
  label: "Decentralization Manager · local 3-node topology · one operator",
  honesty: "One local operator runs every node (one Canton JVM in WSL with 3 participants, 3 DM processes). This demonstrates the mechanism, not independent operators. Synthetic data only.",
  receipts: { onboarding: `.local/tierb/receipts/${onboard.file}`, scenario: `.local/tierb/receipts/${scenario.file}`, topology: topology ? `.local/tierb/receipts/${topology.file}` : null, signing: signing ? `.local/tierb/receipts/${signing.file}` : null },
  versions: {
    install,
    cantonProtocolVersion: 35,
    synchronizerAlias: "global",
    dmMode: "dec-party-manager serve --insecure (unsafe HMAC Canton token, any inbound bearer accepted)",
  },
  onboarding: {
    decentralizedParty: s.decParty,
    request: step("onboarding:start")[0]?.request,
    workflowStatus: { onboarding: step("onboarding:status")[0]?.response?.status, dars: step("dars:status")[0]?.response?.status, contracts: step("contracts:status")[0]?.response?.status },
    members: s.members,
    darsVetted: Object.fromEntries(step("dars:vetted").map((x) => [x.node, x.response.filter((p) => /collara|governance/.test(p.package_name)).map((p) => `${p.package_name}@${p.package_id.slice(0, 12)}`)])),
    governanceRules: step("contracts:governance-state").map((x) => ({ seenBy: x.url.split("@")[1], contractId: x.response.state.contract_id, threshold: x.response.state.threshold, members: x.response.state.members.length, timeoutMicroseconds: x.response.state.action_confirmation_timeout_microseconds, packageRef: x.response.state.package_ref })),
  },
  thresholds: {
    application: { what: "GovernanceRules.threshold (Daml): distinct member parties that must confirm", value: 2, of: 3 },
    decentralizedNamespace: { what: "DecentralizedNamespaceDefinition threshold: owner-key signatures needed for topology changes of the party", from: topology?.data.topology.find((t) => t.kind === "decentralized_namespace") },
    participantConfirmation: { what: "PartyToParticipant threshold: hosting participants that must confirm a transaction the party confirms", from: topology?.data.topology.find((t) => t.kind === "party_to_participant") },
    partySigningKeys: { what: "party signing-key threshold inside PartyToParticipant: signatures needed on a submission that acts as the party (DM /contracts)", from: topology?.data.topology.find((t) => t.kind === "party_to_participant")?.partySigningKeys },
  },
  checks: {
    bootstrap: { ...pick(s.checks.bootstrap, ["ok", "registryCid", "executeUpdateId", "executeOffset", "confirmers"]) },
    one_confirmation_cannot_execute: { ok: s.checks.one_confirmation_cannot_execute.ok, dmView: s.checks.one_confirmation_cannot_execute.dmView, dmHttpStatus: byLabel("add A:execute with 1 confirmation (DM)")?.dmStatus, ledgerError: s.checks.one_confirmation_cannot_execute.ledgerError },
    duplicate_confirmation_does_not_count: { ok: s.checks.duplicate_confirmation_does_not_count.ok, secondConfirmation: lr(byLabel("add A:confirm m1 again (duplicate)")), dmView: s.checks.duplicate_confirmation_does_not_count.dmView, dmError: s.checks.duplicate_confirmation_does_not_count.dmError },
    two_confirmations_execute_add: pick(s.checks.two_confirmations_execute_add, ["ok", "executeUpdateId", "executeOffset", "registryCid", "accreditationCid", "usedConfirmations"]),
    two_confirmations_execute_add_result: s.checks.two_confirmations_execute_add.executionResult,
    stale_proposal_fails: pick(s.checks.stale_proposal_fails, ["ok", "summary", "dmError"]),
    attestation_before_suspension: pick(s.checks.attestation_before_suspension, ["ok", "updateId", "offset", "inGovernancePartyStreamOn"]),
    two_confirmations_execute_suspend: pick(s.checks.two_confirmations_execute_suspend, ["ok", "executeUpdateId", "executeOffset", "registryCid", "accreditationCid"]),
    two_confirmations_execute_suspend_result: s.checks.two_confirmations_execute_suspend.executionResult,
    suspension_blocks_attestation: pick(s.checks.suspension_blocks_attestation, ["ok", "currentAccreditation", "archivedAccreditation"]),
    governance_cannot_release_lock: pick(s.checks.governance_cannot_release_lock, ["ok", "asGovernanceParty", "asMember", "codePath"]),
    topology_threshold_one_vs_two: pick(s.checks.topology_threshold_one_vs_two, ["ok", "summary", "oneUpError", "twoUpExecuteUpdateId", "twoUpExecuteOffset"]),
    accreditation_fetch_needs_governance_threshold: s.checks.accreditation_fetch_needs_governance_threshold,
    dns_threshold: topology?.data.dnsThreshold ?? null,
    party_signing_key_threshold: signing?.data.result ?? null,
  },
  dmCalls: log.filter((l) => l.kind === "dm-confirm" || l.kind === "dm-execute").map((l) => ({ label: l.label, node: l.node, http: l.dmStatus, ms: l.ms, ledger: lr(l), error: l.dmStatus >= 300 ? String(l.dmResponse?.error ?? l.dmResponse).slice(0, 300) : undefined })),
  statusAtSummary: manifest.trim().split(/\r?\n/),
};

function pick(o, keys) {
  return Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
}

const out = join(REPO_ROOT, "docs", "evidence", "tierb-summary.json");
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`wrote ${out}`);
