# Governance Tier B: Decentralization Manager on a local 3-node topology

Status, 2026-10-03: **Tier B runs locally and the checks below passed. One operator runs every node.** The setup is one Canton open-source 3.5.19 JVM inside WSL Ubuntu 24.04, holding one sequencer, one mediator and three participants. Three DLC-link Decentralization Manager (`dec-party-manager` v1.12.0) processes run beside it, one per participant. DM onboarded a **decentralized governance party** hosted on all three participants, distributed the DARs and created `GovernanceRules` signed by that party. Collara's `AddVerifierProposal` and `SuspendVerifierProposal` then went through confirm and execute on the members' DM nodes.

This shows how the mechanism works. It does not show independent operators, and it is not a production or security claim. All data is synthetic. **The Collara API and UI still use Tier A** (§9).

Integration label for this topology (synthesis §1.1; INFERRED copy, pending approval): `Decentralization Manager · local 3-node topology · one operator` (`GOVERNANCE_INTEGRATION_LABELS.DM_TIER_B`). No API path sets this label yet.

Evidence: [`docs/evidence/tierb-summary.json`](evidence/tierb-summary.json). Full DM responses and ledger receipts are in `.local/tierb/receipts/` (git-ignored).

**Where this ran, and where it did not.** This document is `EVIDENCE.governance.tierB.localnet` in [`packages/domain/src/evidence.ts`](../packages/domain/src/evidence.ts): local WSL only. **Tier B has not run on Canton DevNet and was not attempted there** (`tierB.devnet`): the shared HackCanton DevNet participant is not set up to host teams' Decentralized Parties ([hackcanton-submission.md](hackcanton-submission.md)). The planned DevNet bootstrap would create **Tier A** governance only (`tierA.devnet`, not run yet; [devnet-evidence.md](devnet-evidence.md)).

**Contract version.** The run used `collara-contracts` **0.1.0** (package `66efe1ca…`, `onboarding.darsVetted` in the summary). The repository has since moved to `collara-contracts` **0.2.0** (package `1c0e5e62…`, [devnet/upload-manifest.md](devnet/upload-manifest.md)), and `scripts/tierb/onboard.mjs` now distributes the 0.2.0 DAR. **Tier B was not re-run with 0.2.0.**

## 1. Topology

```
WSL Ubuntu 24.04 (one operator, one machine)
├─ Canton OSS 3.5.19, one JVM (-Xmx2g, RSS ≈ 2.3 GB), in-memory storage, protocol version 35
│   ├─ sequencer1 (reference sequencer)  public 5031, admin 5032
│   ├─ mediator1                          admin 5042
│   ├─ p1  ledger 5001  admin 5002  JSON 7585
│   ├─ p2  ledger 5011  admin 5012  JSON 7586
│   └─ p3  ledger 5021  admin 5022  JSON 7587       (synchronizer alias "global", the DM default)
└─ dec-party-manager v1.12.0 × 3, `serve --insecure` (RSS ≈ 110–200 MB each)
    ├─ DM p1 → p1   HTTP 8081  Noise 9001  metrics 9464
    ├─ DM p2 → p2   HTTP 8082  Noise 9002  metrics 9465
    └─ DM p3 → p3   HTTP 8083  Noise 9003  metrics 9466
```

The ports follow synthesis §4.2. The sequencer and mediator ports (5031, 5032, 5042) are not in that table; they sit in the unused 50xx block. Everything binds `127.0.0.1` inside WSL. Windows reaches the JSON API and DM HTTP ports through WSL localhost forwarding.

Parties:

| Party | Hosted on | Role |
|---|---|---|
| `collara-gov::1220…` | p1, p2, p3 with **Confirmation** permission (no participant may submit as it) | Decentralized governance party. Signs `GovernanceRules`, `VerifierRegistry`, `VerifierAccreditation`. |
| `gov-member-p1/p2/p3::…` | one per participant (local) | Governance members (seats). Confirm and execute with `readAs` the governance party, as DM does. |
| `tierb-CollaraRegistrar`, `tierb-DemoManufacturer`, `tierb-DemoVerifier`, `tierb-DemoLenderA` | p1 | Synthetic business parties for the attestation and lock checks. |

## 2. Versions and digests (all verified by `infra/tierb/install.sh`)

| Component | Pin | Verification |
|---|---|---|
| Canton | open-source **3.5.19** release tarball | sha256 `d5798f9dd41e6b1226c8579b40df9694839df72884c69efb309b52ed2ba09494` (GitHub release asset digest). Its jar (sha256 `1d760bbe8266c5336c975db3124986ab95408334986e539ad142759b4e1f5430`) is byte-identical to the Canton 3.5.19 jar of the Windows `dpm` SDK. |
| Java (WSL) | OpenJDK **21.0.12.1** (`openjdk-21-jre-headless` 21.0.12.1+1-1~24.04.4, apt) | |
| DM | `public.ecr.aws/dlc-link/decentralization-manager:v1.12.0@sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d` | The installer checks the image index digest, the linux/amd64 manifest `sha256:563f1ae14b0d779270813dffee4bcc23c8a899ef4546a75a131d4047629eb030` and the binary layer `sha256:4f06a12e7e9663f30b8472fcdf77a504064e9606b777e6502c186d23bc024e6b`. Pulled anonymously with `curl`; no Docker. The extracted binary's sha256 is `971f9e51b003682a8dddef603e32df7c9926897db9133c08f197cb1f401329c7`, and `ldd` finds every library on Ubuntu 24.04. |
| DM governance DARs | `governance-action-v1` `48acd500…`, `governance-core-v1` `361d1f28…` | The same vendored files as Tier A (`daml/collara/vendor-dars/SHA256SUMS`). |
| Collara DARs | `collara-governance` `16cb6e82…`, `collara-contracts` `66efe1ca…` (0.1.0, before the 0.2.0 change) | Built by `dpm build --all` (`daml/collara/*/.daml/dist/`). Not re-run with `collara-contracts` 0.2.0. |

Vetted on all three participants after `/dars/distribute`: `governance-action-v1`, `governance-core-v1`, `collara-governance`, `collara-contracts` (`onboarding.darsVetted` in the summary).

## 3. Commands

From the repo root, in any shell (Node 24 drives WSL through `wsl.exe`):

```
pnpm tierb:install     # JRE 21 (apt), Canton 3.5.19 tarball, DM v1.12.0 from ECR; every digest checked
pnpm tierb:up          # fresh Canton (bootstrap.canton) + 3 DM nodes; also a WSL keepalive
pnpm tierb:onboard     # peers -> /onboarding -> members + rights + /party-config -> /dars/distribute -> /contracts
pnpm tierb:scenario    # governance checks (§5); receipts in .local/tierb/receipts/scenario-*.json
pnpm tierb:topology    # topology read from Canton + decentralized-namespace threshold check (§4.2)
pnpm tierb:signing     # party signing-key threshold check (§4.4)
pnpm tierb:summary     # writes docs/evidence/tierb-summary.json from the newest receipts
pnpm tierb:status      # processes, ports, DM view of the party and rules
pnpm tierb:down        # stops DM nodes, Canton and the keepalive (state is in-memory and is discarded)
```

Files:

- `scripts/tierb/`: `install`, `up`, `onboard`, `scenario`, `topology`, `signing-threshold`, `summary`, `status`, `down` (`.mjs`); `lib.mjs` (WSL runner, ports, state); `clients.mjs` (DM REST, JSON Ledger API, HS256 dev tokens).
- `infra/tierb/`:
  - `install.sh`, `ctl.sh` (`up | down | status | dm-start | dm-stop | dm-restart | console`), `manifest.sh`;
  - `canton/tierb.conf`, `canton/bootstrap.canton`, `canton/remote.conf`;
  - `canton/topology.canton`, `canton/connectivity.canton`, `canton/dns-threshold.canton`.
- Runtime lives on the WSL ext4 disk under `/opt/collara-tierb`: the Canton install, the DM binary, DM data dirs (`dm/p1..p3`, SQLite + Noise key) and logs. Downloads go to `.local/tierb/downloads`. The tarball and image layers are deleted after extraction unless `--keep-downloads` is given.

A fresh run takes about 1 minute for `up`, 1–2 minutes for `onboard` and about 3 minutes for `scenario` (the topology part waits for mediator timeouts). `topology` and `signing` each take about 1 minute. The final clean run was `pnpm tierb:down && pnpm tierb:up && pnpm tierb:onboard && pnpm tierb:scenario && pnpm tierb:topology && pnpm tierb:signing && pnpm tierb:summary && pnpm tierb:status`; it exited 0.

### Configuration this setup needed (observed, all DEV ONLY)

1. **`ledger-api.max-token-lifetime = Inf`.** DM v1.12.0 mints its insecure-mode Canton token without `exp` (`crates/decman/src/auth/mock.rs`). Canton 3.5.19 rejected it: `Authorization error: Could not verify JWT token: token has no expiration time`. The `/contracts` workflow then failed with "The request does not have valid authentication credentials".
2. **`canton.features.enable-preview-commands = yes`.** DM signs the decentralized party's interactive submissions with keys it exports from each participant's vault. Without the flag, `/contracts` failed: `vault RPC failed: … "Remote export of private keys only allowed when preview is enabled"`. Production consequence: on this DM version, the DM node needs a participant that allows remote private-key export.
3. **`-Djava.net.preferIPv4Stack=true`.** Without it, Java bound `[::ffff:127.0.0.1]` and WSL did not forward the ports to Windows.
4. **Backdated dev tokens.** The WSL clock trailed Windows by about a second, and Canton rejected a fresh token with `The Token can't be used before …`. `clients.mjs` backdates `iat` by 30 s.
5. **Peers need a DM restart.** After `POST /network-config`, DM only loads peer keys at startup, as DM's own `configure_peers` does. DM ignores SIGTERM, so `ctl.sh` falls back to SIGKILL.

### DM behaviour notes (v1.12.0 binary)

- `GET /governance/confirmations` does **not** return `executable_confirmation_cids` for domain actions. (The vendored source is a later commit that adds the field.) `scenario.mjs` derives the list the way DM's e2e helper does: the newest unexpired confirmation per current member.
- `POST /governance/confirm|execute` require an `action` object even for `governance_type: "core_domain"`, where it is ignored. The scripts send DM's own e2e placeholder `{"type":"governance_set_threshold","new_threshold":1}`. DM's local SQLite audit log therefore records that placeholder as the action summary; the on-ledger `GovernanceExecutionResult` carries Collara's real `actionLabel` and `description`.
- DM responses carry no update id or offset. Receipts come from each participant's `/v2/updates` stream. Offsets are per participant.
- Proposals are created through the Ledger API ("Path B", DM `CUSTOM_DAML_TEMPLATES.md`). DM's `/governance/propose` only builds its own proposal types. DM lists Collara's proposals automatically through the `GovernableAction` interface, with their `actionLabel` and `description`.

## 4. The thresholds, kept apart

In this deployment all four values are 2. They are four different mechanisms:

| # | Threshold | Where it lives | What it counts | Value | Verified by |
|---|---|---|---|---|---|
| 1 | **Application governance threshold** | `GovernanceRules.threshold` (Daml, DM `governance-core-v1`) | distinct **member parties** whose `GovernanceConfirmation` is consumed by an execute | 2 of 3 | §5 checks 2–5: one confirmation fails, a duplicate does not count, two distinct members execute |
| 2 | **Decentralized-namespace (topology) threshold** | `DecentralizedNamespaceDefinition` of the party's namespace | **owner-key signatures** on topology changes for the party (its hosting mapping, the namespace itself) | 2 of 3 owner keys (one per participant vault, generated by DM onboarding) | §4.2 |
| 3 | **Participant confirmation threshold** | `PartyToParticipant.threshold` | **hosting participants** that must confirm a transaction in which the party is a confirming party | 2 of 3 participants | §4.3 and the accreditation-fetch finding in §5 |
| 4 | **Party signing-key threshold** | `PartyToParticipant.partySigningKeys.threshold` | **signatures by the party's Daml signing keys** on an interactive submission that acts *as* the party (DM `/contracts`) | 2 of 3 keys | §4.4 |

### 4.1 Read from Canton

`topology.canton` runs through the remote console against each participant's Admin API. All three participants report the same mapping:

- PartyToParticipant: threshold 2; hosts p1, p2 and p3 with `Confirmation`; party signing keys threshold 2 with 3 keys.
- DecentralizedNamespaceDefinition: threshold 2 with 3 owners.

DM's `/decentralized-parties` agrees (`threshold: 2`, 3 owners, `permission: "confirmation"`).

### 4.2 Decentralized-namespace threshold (`dns-threshold.canton`)

The check proposes a change to the party's hosting mapping: confirmation threshold 2 → 3.

| Step | Effective threshold (serial) | Pending proposals |
|---|---|---|
| initial | 2 (1) | 0 |
| p1's owner key signs the change (1 of 2 required) | **2 (1)**: not applied | 1, signed only by p1's owner key `1220005140b6…` |
| p2's owner key signs the same change | **3 (2)**: applied | 0 |
| restored by p1 + p3 owner keys | 2 (3) | 0 |

One owner cannot change the party's topology; two can. The change runs through Canton's topology manager directly. DM's own kick, add-party and change-threshold workflows were not run.

### 4.3 Participant confirmation threshold (scenario step 7)

With participants p2 and p3 disconnected from the synchronizer and their DM nodes stopped (only one member participant up), a governance confirm through DM p1 failed after about 34 s:

`MEDIATOR_SAYS_TX_TIMED_OUT(2,0): Rejected transaction as the mediator did not receive sufficient confirmations within the expected timeframe.`

The Canton log names `unresponsiveParties=>collara-gov::…` (excerpt: `.local/tierb/receipts/canton-log-excerpts-final.txt`). After p2 reconnected (two up, p3 still offline), m1 and m2 confirmed and m1 executed. The execute committed: update `122028fac3f3…`, p1 offset 159. See the summary, `checks.topology_threshold_one_vs_two`.

### 4.4 Party signing-key threshold (`signing-threshold.mjs`)

With DM p3 stopped, a DM `/contracts` run signed by p1 and p2 only created a `GenericVoteProposal` whose proposer and sole signatory is the decentralized party. This was an interactive submission acting as the party with exactly 2 of its 3 signing keys, and Canton accepted it (`twoSigners.workflow: completed`).

A run naming a single signer was accepted by DM (HTTP 202) but stayed at `WaitingForPeers` with zero peers. It was cancelled after 30 s, so **no single-signature submission ever reached Canton**. Canton's own rejection of a 1-of-3 signature set is therefore **not** demonstrated. The receipt is `.local/tierb/receipts/signing-*.json`.

## 5. Governance checks (`scenario.mjs`, all passed)

Proposals are pinned to the live registry contract and its version, and carry a 2 h deadline. Every confirm and execute went through the acting member's **own** DM node (`POST /governance/confirm|execute`, `core_domain`). The ids below are from the final clean run in the summary (2026-10-03, `pnpm tierb:down && … && pnpm tierb:status`, exit 0). Earlier runs on fresh topologies gave the same results.

| # | Check | Result (receipt) |
|---|---|---|
| 1 | Bootstrap (governed) | m1 (DM p1) and m2 (DM p2) confirmed; m2 executed. Registry v0 created. Execute update `122065fd6bdb…` (p2 offset 75). |
| 2 | **One confirmation cannot execute** | m1 confirmed proposal A. DM showed `confirmation_count 1, can_execute false`. Execute through DM returned HTTP 500 with the ledger's `DAML_FAILURE … The requirement 'Enough confirmations to execute action' was not met`. The same execute sent straight to the JSON API was rejected with the same error. No execute transaction appeared on the ledger. |
| 3 | **Duplicate confirmation does not count twice** | m1 confirmed A a second time, and the ledger accepted a second `GovernanceConfirmation`. DM still counted 1 (`can_execute false`). Executing with both m1 confirmations was rejected: `The requirement 'No duplicate confirmers' was not met`. |
| 4 | **Two distinct members execute AddVerifier** | m2 confirmed (DM p2) and m2 executed with m1 + m2. Registry v1, `VerifierAccreditation` VER-001 ACTIVE. `GovernanceExecutionResult`: `actionLabel CollaraAddVerifier`, `confirmers [m2, m1]`, executor m2. Update `1220ec2b9781…` (p2 offset 91). |
| 5 | **Stale proposal fails** | Proposal B was pinned to registry v0. m2 and m3 confirmed it, and DM showed `can_execute true`. The execute was rejected: `CONTRACT_NOT_FOUND` for the archived v0 registry. Nothing was executed. |
| 6 | Attestation before suspension | The verifier accepted request VR-TIERB-001 and issued ATT-TIERB-001 against the ACTIVE accreditation. Update `12200737b311…` (p1 offset 123). |
| 7 | **Two distinct members execute SuspendVerifier** | m2 proposed on p2; m2 and m3 confirmed through their own nodes; m1 executed through DM p1. Registry v2, accreditation SUSPENDED. Result `CollaraSuspendVerifier`, confirmers [m3, m2]. Update `1220ac79a33d…` (p1 offset 140). |
| 8 | **Suspension blocks attestation issuance** | Issuing ATT-TIERB-002 on a request accepted before the suspension failed. With the current accreditation: `DAML_FAILURE … Verifier suspended`. With the old ACTIVE accreditation id: `CONTRACT_NOT_FOUND` (archived). This ran on Collara's real `collara-contracts` package on the Tier B topology. `CollaraConfig` pins the decentralized party. |
| 9 | **Governance cannot release a collateral lock** | A `CollateralLock` (signed by registrar, owner and lender; created directly as a fixture, not through `Control_Activate`) stayed active. `Lock_Release` acting as the decentralized party was rejected: `NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT`, because no participant may submit as it. Acting as member m1 (readAs the party) was rejected: `CONTRACT_NOT_FOUND`, because the governance side is not a stakeholder. No code path exists either: `collara-governance` does not depend on `collara-contracts`, so no governed action can name `CollateralLock`, and `Lock_Release` is controlled by the lender only. |
| 10 | One member participant vs two | §4.3. |

Confirm and execute calls through DM took about 0.4–0.7 s each on this machine. Rejected executes returned in under 0.2 s.

### Finding: an accreditation fetch needs the governance quorum online (research-dm.md Q4)

In scenario step 8, a new verification request was created. With only p1 connected, `VR_AcceptAssignment` was submitted; it fetches the governance-signed accreditation. The command completed with `MEDIATOR_SAYS_TX_TIMED_OUT` after about 36 s, and the log names the decentralized party as unresponsive. The same command committed once p2 and p3 were back.

Consequences:

- **Availability.** On this topology, Collara attestation acceptance and issuance need at least 2 governance member participants online, not just the verifier's own node.
- **Privacy.** The governance member participants receive and validate the part of every such transaction that fetches the accreditation; two of the three must confirm it. In an earlier run, the Canton log shows p3 validating the verifier's request (`Phase 3: Validating Transaction`) after it reconnected. The attestation transaction did **not** show up in the governance party's Ledger API update stream on p2 or p3: a fetch is not an event there. That is a statement about the API stream, not about what the participants process.

Tier A pledge activation avoids this coupling by reading the registrar's `VerifierStatusMirror` instead (governance.md §2). Issuance and acceptance do not.

## 6. What was not verified

- **Independent operators.** One person runs one Canton JVM and three DM processes on one laptop. No local setup can show operator independence.
- **Canton rejecting a 1-of-3 signature set** for the decentralized party (§4.4). DM never submitted one.
- **Proposal deadline and confirmation-timeout expiry on Tier B.** Not exercised here; that would need short deadlines and waiting them out. Tier A Daml Script tests cover them, with simulated time.
- **DM with real authentication.** Only `--insecure` mode ran: any inbound bearer is accepted and Canton tokens are unsafe HMAC. Keycloak or Auth0, TLS, `DECPM_DB_ENCRYPTION_KEY` and an admin role were not configured. The DM web UI was not used.
- **DM's kick, add-party and change-threshold workflows**, restart-resume, and reward automation (its interval was set to 1 h, effectively off).
- **Persistence.** Canton runs in memory; `down` discards the topology. Restarts with existing state were not tried.
- **Canton 3.5.8** (DM's CI target). It was not needed, because 3.5.19 worked.
- **Collara API, worker and UI on Tier B** (§9).
- **`collara-contracts` 0.2.0 on Tier B.** The recorded run used 0.1.0; the scripts now point at 0.2.0 and have not been run with it.
- **Any network other than this local one.** Tier B was not attempted on DevNet (the shared participant cannot host Decentralized Parties) or anywhere else.
- **Docker / Docker Compose.** The run used WSL processes, no containers. A Compose path is drafted in [`infra/tierb/compose.yaml`](../infra/tierb/compose.yaml) and is **untested** ([submission/bitsafe-contribution-pool.md](submission/bitsafe-contribution-pool.md) §6).
- **Mediator and participant timeouts.** Canton defaults were used. The about 30 s failure time is a consequence of those defaults, not a tuned value.

## 7. Resource use and cleanup

- Memory: Canton about 2.3 GB RSS; DM nodes about 110–200 MB each; a remote-console run (`ctl.sh console`) adds a short-lived JVM (`-Xmx768m`).
- Disk: Canton install about 300 MB on the WSL disk; the DM binary about 50 MB.
- `pnpm tierb:down` stops everything. Receipts stay in `.local/tierb/receipts/`. Remove `/opt/collara-tierb` inside WSL to uninstall.

## 8. Trust model on this topology (compared with Tier A)

- Tier A's main limit is gone here: in Tier A, whoever holds the governance party's credential can sign registry contracts alone. Here **no participant can submit as the governance party**; in check 9 the participant refused such a submission. It can only act through a governed execute, or through DM's interactive `/contracts` with 2 of 3 party signing keys. Its topology changes need 2 of 3 owner keys.
- Every key, vault and process still belongs to one operator, so in practice that operator can do anything. The thresholds are real, but nothing makes the parties holding them independent.
- In `--insecure` mode, anyone who can reach a DM node's HTTP port can drive that member's confirms and executes. The ports bind to loopback only.

## 9. Collara API integration: not done

The API, worker and UI still use Tier A, with the label `Partial — governance contracts on one local participant; decentralized party not demonstrated`.

Tier B was not wired into the API. An API adapter that only forwarded confirm and execute to the DM nodes would not be enough, for two reasons:

- **One synchronizer.** The ledger only enforces "suspension blocks attestation" when the verifier's transaction can fetch the governance-signed accreditation (§5 check 8). The Collara business workflow (cases, verification, attestations) must therefore run on the same synchronizer as the decentralized governance party. Wiring the API means moving the whole LOCALNET deployment onto the Tier B topology: a Tier B bootstrap of the Collara namespace, party bindings for seats on three WSL participants, the registrar, and the seed. It also means accepting the availability coupling in §5.
- **Time.** That port, plus a DM REST adapter for confirm and execute (DTOs as in `scripts/tierb/scenario.mjs`), its tests and a LOCALNET re-run, did not fit this time-box.

Until then, the label `DM_TIER_B` must not be shown by the API.

See also: [governance.md](governance.md) (Tier A), [`_research/research-dm.md`](_research/research-dm.md) §10 (plan), [`architecture/daml-model.md`](architecture/daml-model.md) §4.8.
