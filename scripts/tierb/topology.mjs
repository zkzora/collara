#!/usr/bin/env node
// Reads the decentralized governance party's topology straight from Canton (remote console against each
// participant's Admin API) and, with --dns-threshold, runs the decentralized-namespace threshold check
// (infra/tierb/canton/dns-threshold.canton). Output lines are saved under .local/tierb/receipts/topology-*.json.
//   node scripts/tierb/topology.mjs [--dns-threshold]
import { REPO_WSL, fail, readState, writeReceipt, wslScript } from "./lib.mjs";

const state = readState();
if (!state.decParty) fail("no decentralized party yet (run scripts/tierb/onboard.mjs)");

function consoleRun(script, env) {
  const r = wslScript("infra/tierb/ctl.sh", {
    args: ["console", `${REPO_WSL}/infra/tierb/canton/${script}`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)],
    capture: true,
    timeoutMs: 600_000,
  });
  const lines = (r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("TIERB_JSON ")).map((l) => JSON.parse(l.slice(11)));
  if (r.status !== 0) {
    console.error((r.stdout || "").slice(-3000), r.stderr);
    fail(`${script} failed (exit ${r.status})`);
  }
  return lines;
}

const run = new Date().toISOString().replaceAll(":", "-");
const topology = consoleRun("topology.canton", { DEC_PARTY: state.decParty });
const out = { run, decParty: state.decParty, topology };
for (const t of topology.filter((x) => x.kind !== "connection")) {
  console.log(`${t.seenBy}: ${t.kind} threshold ${t.threshold}${t.partySigningKeys ? `, party signing keys ${t.partySigningKeys.keys.length} (threshold ${t.partySigningKeys.threshold})` : ""}${t.owners ? `, owners ${t.owners.length}` : ""}${t.participants ? `, hosts ${t.participants.map((p) => `${p.participant.split("::")[0]}:${p.permission}`).join(" ")}` : ""}`);
}

if (process.argv.includes("--dns-threshold")) {
  const owners = Object.fromEntries(state.decPartyEntry.participants.map((p) => [p.participant_uid.split("::")[0], p.owner_key]));
  out.dnsThreshold = consoleRun("dns-threshold.canton", { DEC_PARTY: state.decParty, OWNER_P1: owners.p1, OWNER_P2: owners.p2, OWNER_P3: owners.p3 });
  out.ownerKeys = owners;
  for (const s of out.dnsThreshold) console.log(`${s.step}: effective threshold ${s.effectiveThreshold} (serial ${s.effectiveSerial}), pending proposals ${s.pendingProposals.length}`);
}
console.log(`receipts: ${writeReceipt(`topology-${run}`, out)}`);
