# BitSafe challenge, Contribution Pool entry: governed verifier registry on Decentralization Manager

Draft entry, 2026-10-04. Sentences outside backticks are INFERRED copy, pending the team's approval. Every fact cites a file in this repository. Synthetic data only. Nothing here is a production-readiness or security claim.

## 1. What the entry is

The entry has two parts:

1. **Custom `GovernableAction` modules for DLC-link Decentralization Manager v1.12.0.** The `collara-governance` Daml package ([`daml/collara/governance/daml/Collara/Governance/Proposals.daml`](../../daml/collara/governance/daml/Collara/Governance/Proposals.daml)) defines three templates that implement DM's `GovernableAction` interface from `governance-action-v1`: `BootstrapVerifierRegistryProposal`, `AddVerifierProposal` and `SuspendVerifierProposal`. Each one:
   - is pinned to the live `VerifierRegistry` contract and its version;
   - carries a deadline;
   - executes through DM's `GovernanceRules` (`governance-core-v1`) after the confirmation threshold is met.

   DM lists these proposals through the interface, with their `actionLabel` and `description`. Confirm and execute go through each member's own DM node ([`docs/governance-tier-b.md`](../governance-tier-b.md) §3, "DM behaviour notes").
2. **A reproducible LocalNet demo (Tier B).** It runs one Canton open-source 3.5.19 synchronizer with three participants and three `dec-party-manager` v1.12.0 nodes, one per participant. DM onboards a **Decentralized Party** `collara-gov::…` hosted on all three participants, distributes the DARs and creates `GovernanceRules` signed by that party through DM `/contracts`. The scripted scenario then runs the governed actions and the threshold checks ([`scripts/tierb/`](../../scripts/tierb/), [`infra/tierb/`](../../infra/tierb/)).

Governance scope: **verifier-registry administration only.** No governed action can name `CollateralLock`, because `collara-governance` does not depend on `collara-contracts`. Release stays with the lender: `Governance controls verifier-registry administration only. It never authorizes collateral release. Collateral decisions, financing proposals, pledge activation, and release remain under lender mandates and are not subject to governance votes.`

## 2. The risk addressed

Collara's verifiers issue the attestations that lenders rely on, and a suspended verifier must not be able to keep issuing them. The question is who may add or suspend a verifier.

- **Before (Tier A, what the Collara app uses today).** The rules are DM `GovernanceRules` with 2 of 3 seats, but the governance party is an **ordinary local party** on one participant. Whoever holds its credential can sign `VerifierRegistry` and `VerifierAccreditation` contracts **without the seat quorum**. Seats are separate parties, but one participant and one operator host everything ([`docs/governance.md`](../governance.md) §4).
- **After (Tier B, this entry).** The governance party is a **Decentralized Party**. No participant can submit as it: in check 9, such a submission was refused with `NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT`. It can act only in two ways:
  - through a governed execute that consumes **2 distinct member confirmations**;
  - through DM `/contracts` with **2 of its 3 party signing keys**.

  Its topology changes need **2 of 3 owner keys** ([`docs/governance-tier-b.md`](../governance-tier-b.md) §8).

## 3. Architecture

```text
BEFORE (Tier A, in the app)                         AFTER (Tier B, this entry; scripted, not in the app)

one Canton participant (dpm sandbox)                 one synchronizer (sequencer1, mediator1)
 ├─ CollaraGovernance  (ordinary party; its          ├─ p1 ── DM node p1 ── member gov-member-p1
 │   credential can act alone)                       ├─ p2 ── DM node p2 ── member gov-member-p2
 ├─ GovSeat1..3 (member parties)                     └─ p3 ── DM node p3 ── member gov-member-p3
 ├─ GovernanceRules 2-of-3                           collara-gov::… Decentralized Party, hosted on p1+p2+p3
 └─ every Collara organisation party                  with Confirmation permission (no participant submits as it)
                                                     GovernanceRules 2-of-3, signed by collara-gov via DM /contracts
                                                     Collara proposals → confirm/execute on each member's own DM node
```

## 4. Nodes, operators and thresholds

| Node | Runs | Operator |
|---|---|---|
| `sequencer1`, `mediator1` | Canton OSS 3.5.19, the same JVM as the participants | the Collara author (one person) |
| `p1` (ledger 5001, admin 5002, JSON 7585) + DM p1 (HTTP 8081, Noise 9001) | Canton participant + `dec-party-manager` v1.12.0 | the same person |
| `p2` (5011 / 5012 / 7586) + DM p2 (8082 / 9002) | same | the same person |
| `p3` (5021 / 5022 / 7587) + DM p3 (8083 / 9003) | same | the same person |

**Independent operators: none.** All nodes run on one laptop, in one WSL distribution, under one operator. The thresholds below are real Canton and Daml mechanisms, but nothing makes the holders of the keys independent. The run shows the mechanism, not decentralization between organisations ([`docs/governance-tier-b.md`](../governance-tier-b.md) §6, §8).

| # | Threshold | Value | Where |
|---|---|---|---|
| 1 | Application governance threshold (`GovernanceRules.threshold`): distinct member parties that must confirm | 2 of 3 | Daml, DM `governance-core-v1` |
| 2 | Decentralized-namespace threshold: owner-key signatures on the party's topology changes | 2 of 3 | `DecentralizedNamespaceDefinition` |
| 3 | Participant confirmation threshold: hosting participants that must confirm | 2 of 3 | `PartyToParticipant.threshold` |
| 4 | Party signing-key threshold: signatures on a submission acting as the party | 2 of 3 | `PartyToParticipant.partySigningKeys` |

Source: [`docs/evidence/tierb-summary.json`](../evidence/tierb-summary.json) `thresholds`, read from Canton on all three participants.

## 5. Evidence required by the challenge, mapped to receipts

The final clean run was on 2026-10-03 and exited 0. The summary is [`docs/evidence/tierb-summary.json`](../evidence/tierb-summary.json), generated by `scripts/tierb/summary.mjs`. The full DM responses and ledger receipts are in `.local/tierb/receipts/` on the authoring machine; that directory is gitignored and not in the repository.

| Challenge requirement | Result | Receipt (`checks.<key>` in the summary; governance-tier-b.md section) |
|---|---|---|
| **Governed action fails below the threshold** | One confirmation: DM shows `confirmation_count 1, can_execute false`. Execute through DM → HTTP 500. The ledger rejects it with `DAML_FAILURE … 'Enough confirmations to execute action' was not met`, and the same execute sent straight to the JSON API is rejected the same way. No execute transaction is on the ledger. | `one_confirmation_cannot_execute`; §5 check 2 |
| Below the threshold, by duplication | The same member confirms twice. DM still counts 1, and the execute is rejected: `'No duplicate confirmers' was not met`. | `duplicate_confirmation_does_not_count`; §5 check 3 |
| **Governed action succeeds once the threshold is met** | Two distinct members, each through its own DM node: AddVerifier executed (registry v1, VER-001 ACTIVE, `GovernanceExecutionResult` `CollaraAddVerifier`, update `1220ec2b9781…`), and SuspendVerifier executed (update `1220ac79a33d…`). | `two_confirmations_execute_add(_result)`, `two_confirmations_execute_suspend(_result)`; §5 checks 4, 7 |
| Stale proposal | Pinned to an archived registry version: DM shows `can_execute true`, and the ledger rejects it with `CONTRACT_NOT_FOUND`. | `stale_proposal_fails`; §5 check 5 |
| Effect of the governed action | After the suspension, the verifier cannot issue an attestation (`Verifier suspended`). | `suspension_blocks_attestation`; §5 check 8 |
| Governance cannot touch collateral | `Lock_Release` acting as the decentralized party is refused (`NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT`). Acting as a member is refused with `CONTRACT_NOT_FOUND`. | `governance_cannot_release_lock`; §5 check 9 |
| **Hosting node offline** | With p2 and p3 disconnected and their DM nodes stopped, a governance confirm through DM p1 is rejected after about 34 s with `MEDIATOR_SAYS_TX_TIMED_OUT`; the Canton log names `collara-gov` as unresponsive. With p2 back (p3 still offline), two confirmations and the execute commit (update `122028fac3f3…`). | `topology_threshold_one_vs_two`; §4.3, §5 check 10 |
| Node offline and application availability | A verifier's accreditation fetch with only p1 online is rejected (`MEDIATOR_SAYS_TX_TIMED_OUT`). It commits once p2 and p3 are back. **Finding:** on this topology, attestation acceptance and issuance need 2 governance participants online. | `accreditation_fetch_needs_governance_threshold`; §5 "Finding" |
| Topology shared control | p1's owner key alone leaves a hosting change pending; p2's signature applies it. | `dns_threshold`; §4.2 |
| Signing-key threshold | 2 of 3 signing keys: Canton accepted the submission. With 1 signer, DM never submitted it (it stayed `WaitingForPeers`, cancelled after 30 s). **Canton rejecting a 1-of-3 signature set is not demonstrated.** | `party_signing_key_threshold`; §4.4 |

## 6. Reproduction

### 6.1 Tested path: Windows 11 + WSL2 Ubuntu 24.04 (no Docker)

This is the path that produced the receipts above.

Prerequisites:

- Windows 11 with WSL2 and the distribution named `Ubuntu` (24.04). To use another name, set `COLLARA_WSL_DISTRO`.
- About 4 GB of free RAM for WSL: Canton uses about 2.3 GB RSS and each DM node 110–200 MB.
- Internet access to GitHub releases and `public.ecr.aws`.
- On Windows: Node.js 24 (`>=24.15 <25`), pnpm 11, and Git.
- The Daml SDK 3.5.12 through `dpm`, to build the Collara DARs ([README](../../README.md), "Prerequisites").

```sh
git clone <repository URL> collara && cd collara     # keep the path short on Windows (MAX_PATH)
pnpm install
# Build the DARs the onboarding distributes (daml/collara/*/.daml/dist), and run the Daml tests.
#   PowerShell: $env:Path = "$env:APPDATA\dpm\bin;$env:Path"
#   Git Bash:   export PATH="$APPDATA/dpm/bin:$PATH"
pnpm daml:check

pnpm tierb:install     # inside WSL as root: JRE 21 (apt), Canton OSS 3.5.19 (sha256 checked),
                       # dec-party-manager v1.12.0 pulled from public ECR with curl (index, manifest and layer
                       # digests checked); runtime under /opt/collara-tierb
pnpm tierb:up          # fresh in-memory Canton + 3 DM nodes (+ a WSL keepalive), about 1 min
pnpm tierb:onboard     # peers → /onboarding (threshold 2) → members + rights → /dars/distribute → /contracts, 1–2 min
pnpm tierb:scenario    # the governance checks of §5, including the node-offline step, about 3 min
pnpm tierb:topology    # thresholds read from Canton + the decentralized-namespace check, about 1 min
pnpm tierb:signing     # party signing-key threshold, about 1 min
pnpm tierb:summary     # writes docs/evidence/tierb-summary.json from the newest receipts
pnpm tierb:status
pnpm tierb:down        # stops everything; Canton state is in memory and is discarded
```

Expected result: every command exits 0. `scenario` prints a `PASS <check>` line for each check (any `FAIL` sets a non-zero exit code), and the regenerated `docs/evidence/tierb-summary.json` has `"ok": true` on every check. Ledger ids differ on every run: party ids, contract ids, update ids and offsets are fresh after each `up`.

Development-only settings this needs are documented with the error each one fixes ([`docs/governance-tier-b.md`](../governance-tier-b.md) §3):

- `ledger-api.max-token-lifetime = Inf`;
- `enable-preview-commands`;
- `preferIPv4Stack`;
- backdated dev tokens;
- a DM restart after peering.

### 6.2 Native Linux without Docker (untested)

The scripts run the same bash files directly when they are not on Windows (`scripts/tierb/lib.mjs`, `wslScript`), but as the current user, not as root. This has not been run. To try it on Ubuntu 24.04 amd64:

```sh
sudo apt-get install -y openjdk-21-jre-headless curl python3          # install.sh skips apt when java exists
sudo install -d -o "$USER" /opt/collara-tierb                          # runtime dir writable by your user
curl -sSLf https://get.digitalasset.com/install/install.sh | sh -s 3.5.12   # dpm + Daml SDK, as in CI
export PATH="$HOME/.dpm/bin:$PATH" JDK_JAVA_OPTIONS=-Xmx1g
pnpm install && pnpm daml:check
pnpm tierb:install && pnpm tierb:up && pnpm tierb:onboard && pnpm tierb:scenario \
  && pnpm tierb:topology && pnpm tierb:signing && pnpm tierb:summary && pnpm tierb:down
```

### 6.3 Docker Compose (DRAFT, UNTESTED: there is no Docker on the authoring machine)

The challenge's local path expects Docker and Docker Compose. This repository has a draft:

- [`infra/tierb/compose.yaml`](../../infra/tierb/compose.yaml): a `canton` service (`eclipse-temurin:21-jre` running the sha256-verified Canton 3.5.19 jar with the same `tierb.conf` and `bootstrap.canton`), plus `dm-p1..dm-p3` from `public.ecr.aws/dlc-link/decentralization-manager:v1.12.0@sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d` with the same environment as `ctl.sh`. All services use host networking.
- [`infra/tierb/compose-ctl.sh`](../../infra/tierb/compose-ctl.sh): the same interface as `ctl.sh` (`up`, `down`, `status`, `dm-stop`, `dm-start`, `dm-restart`, `console`). `ctl.sh` and `manifest.sh` hand over to it only when `TIERB_BACKEND=compose`; the tested WSL path is unchanged.

To try it on a Linux amd64 host with Docker Engine and Compose v2, after `pnpm install` and `pnpm daml:check` as in 6.2:

```sh
export TIERB_BACKEND=compose
pnpm tierb:up && pnpm tierb:onboard && pnpm tierb:scenario && pnpm tierb:topology \
  && pnpm tierb:signing && pnpm tierb:summary && pnpm tierb:status && pnpm tierb:down
```

**What remains unverified on this path** (none of it has been run):

1. That `docker compose` accepts the file as written: YAML merge keys, `up --wait` with the health check, and the bash process substitution in the `canton` command.
2. The DM image's entrypoint, user and writable `/data`. The draft overrides the entrypoint to `/usr/local/bin/dec-party-manager` (the binary's path in the image layer) and assumes the image user can write a fresh named volume.
3. That DM in a container reaches Canton and its peers on `127.0.0.1` with `network_mode: host`. This works only on a Linux host; Docker Desktop on macOS or Windows is not a target.
4. `docker compose stop` and `restart` of a DM node: DM ignores SIGTERM, and the draft relies on Compose's SIGKILL after 3 s. Also, whether DM keeps its keys across a restart on the named volume.
5. The Canton remote console through `docker compose exec`. The scenario's node-offline step and the topology checks depend on it.
6. That `eclipse-temurin:21-jre` is a suitable base. It is referenced **by tag, not by digest**: pin a digest before relying on it.
7. That `scripts/tierb/*.mjs` behave the same when the bash scripts run as a non-root user outside WSL.

### 6.4 Contract version: Tier B was not re-run with `collara-contracts` 0.2.0

The recorded run distributed `collara-contracts` **0.1.0** (package `66efe1ca…`, `onboarding.darsVetted` in the summary). Since then, the Collara contracts moved to **0.2.0** (package `1c0e5e62…`): pledge activation now checks a live disclosure-validity marker. `scripts/tierb/onboard.mjs` now distributes the 0.2.0 DAR. **Tier B has not been re-run with 0.2.0**, so the reproduction above uses a contract version that differs from the receipts.

The governance packages are unchanged: `collara-governance` `16cb6e82…`, `governance-core-v1` `361d1f28…` and `governance-action-v1` `48acd500…` are the same package ids in both runs. The checks that use `collara-contracts` (attestation before and after the suspension, and the lock fixture) are the ones that could behave differently.

## 7. Limits (stated, not hidden)

- **One operator, one machine.** This is not evidence of independent operators. "Several containers on the same laptop are not independent operators" (challenge notes, spec-content.md §e.1) applies equally to WSL processes.
- **Not in the Collara app.** The API, worker and UI use Tier A. Wiring Tier B in would need the whole Collara deployment on the Tier B synchronizer, plus a DM REST adapter ([`docs/governance-tier-b.md`](../governance-tier-b.md) §9).
- **Not on DevNet or MainNet.** The shared HackCanton DevNet participant is not set up to host teams' Decentralized Parties, so this entry is LocalNet only. That is the Contribution Pool, not Gold ([`docs/hackcanton-submission.md`](../hackcanton-submission.md)).
- **DM in `--insecure` mode** with unsafe HMAC Canton tokens. Real authentication, TLS, DM database encryption and the DM web UI were not used.
- **Not exercised:**
  - proposal-deadline and confirmation-timeout expiry on Tier B (covered only by Tier A Daml Script tests with simulated time);
  - DM's kick, add-party and change-threshold workflows;
  - persistence across restarts;
  - Canton rejecting a 1-of-3 signature set.
