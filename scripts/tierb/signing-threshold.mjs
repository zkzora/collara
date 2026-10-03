#!/usr/bin/env node
// Party signing-key threshold check (separate from the governance and confirmation thresholds). A DM /contracts
// workflow is an interactive submission that acts AS the decentralized party and must carry `threshold` (2) of the
// party's 3 signing keys. With p3's DM node stopped, p1 + p2 sign a GenericVoteProposal whose proposer (signatory)
// is the decentralized party itself, and Canton accepts it. A request naming a single signer is refused by DM
// before any submission (DM-side guard; Canton's own rejection of a 1-signature submission is not exercised).
//   node scripts/tierb/signing-threshold.mjs
import { dm, must } from "./clients.mjs";
import { fail, readState, sleep, writeReceipt, wslScript } from "./lib.mjs";

const S = readState();
if (!S.decParty) fail("not onboarded");
const out = { run: new Date().toISOString(), decParty: S.decParty, steps: [] };
const rec = (step, res, extra = {}) => out.steps.push({ step, status: res?.status, response: res?.json ?? res?.text?.slice(0, 2000), ...extra });
const uid = (name) => S.decPartyEntry.participants.find((p) => p.participant_uid.startsWith(`${name}::`)).participant_uid;
const body = (names, baseId) => {
  const id = `${baseId}-${Date.now()}`; // DM derives the command id from the request; keep reruns distinct
  return {
    decentralized_party_id: S.decParty,
    participant_ids: names.map(uid),
    participant_parties: names.map((n) => S.members[n]),
    operator_party: S.members.p1,
    contracts: [{
      id,
      name: "GenericVoteProposal",
      package_id: "#governance-core-v1",
      module_name: "Governance.GenericVote",
      entity_name: "GenericVoteProposal",
      fields: [{ type: "decentralized_party" }, { type: "decentralized_party" }, { type: "text", value: `Signing-key threshold probe (${id}, synthetic)` }],
    }],
  };
};

function ctl(...args) {
  const r = wslScript("infra/tierb/ctl.sh", { args, capture: true, timeoutMs: 180_000 });
  out.steps.push({ step: `ctl ${args.join(" ")}`, exit: r.status, out: (r.stdout || "").trim() });
  if (r.status !== 0) throw new Error(`ctl ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
}

async function main() {
  ctl("dm-stop", "p3");
  // 1 signer. Observed with v1.12.0: DM accepts the request (202) and the run then stays at WaitingForPeers with
  // zero peers, so no submission reaches Canton; it is cancelled after 30 s.
  const one = await dm("p1", "POST", "/contracts", body(["p1"], "signing-probe-one"));
  rec("contracts with one signer (p1)", one);
  await sleep(30_000);
  const oneStatus = await dm("p1", "GET", "/workflows");
  const oneRun = oneStatus.json?.runs?.find((r) => r.instance_name === one.json?.instance_name);
  rec("one-signer run after 30 s", { status: oneStatus.status, json: oneRun });
  rec("cancel one-signer run", await dm("p1", "POST", "/contracts/cancel", {}));
  await sleep(2000);
  // 2 signers (= threshold) while p3's DM node is down.
  const two = await dm("p1", "POST", "/contracts", body(["p1", "p2"], "signing-probe-two"));
  rec("contracts with two signers (p1, p2), p3 DM stopped", two);
  must(two, "contracts p1+p2");
  let inv;
  for (let i = 0; i < 60 && !inv; i++) {
    inv = (await dm("p2", "GET", "/invitations")).json?.invitations?.find((x) => x.invitation_type === "Contracts");
    if (!inv) await sleep(1000);
  }
  if (!inv) throw new Error("no Contracts invitation on p2");
  rec("p2 accept", await dm("p2", "POST", "/invitations/accept", { id: inv.id }));
  let status;
  for (let i = 0; i < 120; i++) {
    status = (await dm("p1", "GET", "/contracts/status")).json;
    if (/^(completed|failed)$/i.test(status?.status ?? "")) break;
    await sleep(1500);
  }
  rec("contracts status", { status: 200, json: status });
  const feed = (await dm("p1", "GET", `/governance/confirmations?party_id=${encodeURIComponent(S.decParty)}`)).json;
  const probe = feed?.domain_actions?.filter((a) => a.action_label === "GenericVote" && a.proposer === S.decParty).sort((a, b) => b.created_at - a.created_at)[0];
  out.result = {
    oneSigner: { http: one.status, response: one.json ?? one.text.slice(0, 400), after30s: oneRun ? { status: oneRun.status, step: oneRun.current_step, expectedPeers: oneRun.expected_peers } : null },
    twoSigners: { workflow: status?.status, error: status?.error, contractCid: probe?.proposal_cid ?? null, proposer: probe?.proposer ?? null },
  };
  console.log(JSON.stringify(out.result, null, 2));
}

main()
  .catch((e) => {
    out.error = e.stack || e.message;
    console.error(out.error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      ctl("dm-start", "p3");
    } catch (e) {
      console.error(e.message);
    }
    console.log(`receipts: ${writeReceipt(`signing-${out.run.replaceAll(":", "-")}`, out)}`);
  });
