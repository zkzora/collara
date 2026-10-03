#!/usr/bin/env node
// Tier B status: processes and ports inside WSL, plus what the DM nodes report (decentralized party, rules).
//   node scripts/tierb/status.mjs
import { dm } from "./clients.mjs";
import { NODES, readState, wslScript } from "./lib.mjs";

wslScript("infra/tierb/ctl.sh", { args: ["status"], timeoutMs: 60_000 });
const state = readState();
for (const n of NODES) {
  const cfg = await dm(n.name, "GET", "/node-config", undefined, { timeoutMs: 3000, retries: 1 }).catch(() => undefined);
  console.log(`${n.name}: DM ${cfg?.ok ? `up, participant ${cfg.json?.node?.participant_id}` : "unreachable from Windows"}`);
}
if (state.decParty) {
  console.log(`last decentralized party: ${state.decParty}${state.governance ? "" : " (topology stopped or not onboarded)"}`);
  const gov = await dm("p1", "GET", `/governance/state?party_id=${encodeURIComponent(state.decParty)}`, undefined, { timeoutMs: 5000, retries: 1 }).catch(() => undefined);
  const rules = gov?.ok ? gov.json?.state : undefined;
  if (rules) console.log(`GovernanceRules ${rules.contract_id}: threshold ${rules.threshold} of ${rules.members.length}`);
}
