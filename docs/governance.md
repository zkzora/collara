# Governance (verifier registry)

Status, 2026-10-03: **Tier A is implemented and tested on a local Canton 3.5.19 `dpm sandbox` with one participant (not Splice LocalNet); the Collara API and UI use it. Tier B (three Decentralization Manager nodes and a decentralized governance party on a separate local 3-participant Canton in WSL, one operator) now runs through scripts and its governance checks pass, but it is not wired into the API: see [governance-tier-b.md](governance-tier-b.md).** Everything here uses synthetic organizations and one local operator. Tier A uses DLC-link Decentralization Manager v1.12.0 `GovernanceRules` contracts with 2-of-3 seats, but the governance party is an ordinary local party: whoever holds its credential could act without the seat quorum (§4). Nothing here is a production-readiness or security claim.

Governance in Collara administers the **verifier registry only**: adding a verifier and suspending one. It never touches collateral. The domain copy states it (`packages/domain/src/copy.ts`, `BOUNDARY_COPY.GOVERNANCE_SCOPE`):

> Governance controls verifier-registry administration only. It never authorizes collateral release. Collateral decisions, financing proposals, pledge activation, and release remain under lender mandates and are not subject to governance votes.

On the ledger this is structural: governed actions create or change only `VerifierRegistry` and `VerifierAccreditation`; `CollateralLock` has a single choice, `Lock_Release`, controlled by the lock's lender, and the Daml test `Governance.test_governance_cannot_release_lock` checks that governance cannot release it (`docs/architecture/daml-model.md` §4.3, §6). The API's governance service has no code path that references collateral contracts (`apps/api/src/workflow/governance/service.ts`).

## 1. What Tier A is

| Element | Implementation |
|---|---|
| Rules contract | DM `GovernanceRules` from the vendored DLC-link Decentralization Manager **v1.12.0** DARs (`daml/collara/vendor-dars/`, SHA-256 pinned in `SHA256SUMS` and checked by `daml/collara/check.mjs`) |
| Threshold | 2 of 3 member parties; `actionConfirmationTimeout` 30 minutes; no additional proposers |
| Governance party | `CollaraGovernance`, an **ordinary local party** on the same participant (not a decentralized party) |
| Seats | Three **separate member parties** `GovSeat1`, `GovSeat2`, `GovSeat3`, each with its own ledger user (`gov-seat-N-svc`: `CanActAs` the seat, `CanReadAs` the governance party). A seat is never the organization's business party. |
| Seat holders (synthetic) | Seat 1: Demo Lender A (Morgan Hale's `GOVERNANCE_SEAT` mandate) · Seat 2: Demo Lender B · Seat 3: Demo Auditor |
| Governed actions | Collara templates implementing DM's `GovernableAction` interface (`collara-governance` package): `BootstrapVerifierRegistryProposal`, `AddVerifierProposal`, `SuspendVerifierProposal`. Each is pinned to the live registry contract and its version, and has a deadline. |
| API | `POST /api/governance/proposals` (propose; the proposer's confirmation is included, as DM's propose does), `…/{id}/confirmations`, `…/{id}/execute`, `…/{id}/cancel`; reads `GET /api/governance/state`, `GET /api/governance/proposals[/{id}]`, `GET /api/verifiers`. Every submission acts as the seat party. After an execute, the registrar service syncs `CollaraConfig.directory` and the `VerifierStatusMirror`. |
| UI integration label | `Partial — governance contracts on one local participant; decentralized party not demonstrated` (INFERRED copy, pending approval; `GOVERNANCE_INTEGRATION_LABELS.PARTIAL_TIER_A`) |

Bootstrap (daml-model.md §7, B2–B8): the governance party creates `GovernanceRules`; seat 1 proposes the genesis registry with Demo Verifier as `VER-001`; seats 1 and 2 confirm; seat 2 executes; the registrar creates `CollaraConfig` and publishes the verifier status mirror.

## 2. What the tests proved

**Daml Script tests** (IDE ledger, `daml/collara/tests`, 60 tests passing, last re-run recorded in [`verification.md`](verification.md)): one confirmation cannot execute; duplicate confirmations do not count twice; two distinct confirmations execute an Add (and a replay fails); a stale proposal cannot execute; a passed deadline or expired confirmations block execution; only members confirm and execute; registry contracts need governance authority; a duplicate active verifier is rejected; the proposer can cancel; a governed suspension works; governance cannot release a lock.

**LOCALNET integration tests** on the Canton 3.5.19 sandbox, one participant (`apps/api/test/localnet/governance.it.test.ts`, part of the 49/49 run at commit `c9337d3`, the same tree as `e320c59` before a history rewrite; later runs are recorded in [`verification.md`](verification.md)). Each claim is checked through the API **and** on the ledger (ACS of the seat, registrar or verifier user); direct ledger submissions bypass the API's pre-checks to prove the ledger itself rejects:

| Test | Result |
|---|---|
| Before any change | Seat holders read the Tier A state; `VER-001` is ACTIVE; every other persona gets 404. |
| One confirmation | A seat-1 proposal to suspend `VER-001` (auto-confirmed) cannot execute: API 409 and a ledger rejection. |
| Duplicate confirmation | A seat confirming twice does not count twice (API 409; the ledger accepts the duplicate contract but never counts it). |
| Non-members | Demo Lender B's **business** party cannot confirm (ledger rejection); users without a seat get 404 on every governance mutation. |
| Two distinct seats | Execution suspends the verifier: registry v1, accreditation `SUSPENDED`, mirror `SUSPENDED`, visible through `GET /api/verifiers`. |
| Effect | The suspended verifier cannot issue an attestation (new accreditation: `Verifier suspended`; old one: archived). The effect on pledge activation (below) is covered by the Daml Script test only, not by this suite. |
| Stale proposal | After another proposal moved the registry (re-adding Demo Verifier as `VER-001`, registry v2), a competing proposal pinned to v1 fails to execute: API 409 and ledger rejection. |
| Cancel | Only the proposer withdraws its open proposal; a withdrawn proposal cannot be confirmed. |
| Reconciliation | Governance command records carry the seat submission context (ledger user, `actAs`), so an `UNKNOWN_OUTCOME` is reconciled against the right user's completions. |

### Suspension policy (what a suspension changes)

`CollaraConfig.suspensionPolicy` (`daml/collara/contracts/daml/Collara/Config.daml`) is `REQUIRE_ACTIVE_VERIFIER` in the demo seed (the default in `apps/api/src/ledger/builders.ts`). Under it:

- **New work is blocked on the ledger.** `VR_AcceptAssignment` and `VR_IssueAttestation` (`Collara/Verification.daml`) check the verifier's governance-signed accreditation at commit (`Verifier suspended`). The API also refuses a new verification request to a verifier that is not active in the registry, before submitting (`apps/api/src/workflow/verification/ledger.ts`).
- **Issued attestations are not revoked or reopened**, but they cannot back a **new** pledge activation. `Control_Activate` (`Collara/Control.daml`) does not read the accreditation (that would inform the governance members of the pledge); it fetches the registrar-signed `VerifierStatusMirror` of the attestation's verifier and, under this policy, requires it to be `ACTIVE`. The registrar re-syncs the mirror after a governed execution; until it does, the mirror can lag the suspension, and an activation in that window is not blocked. The API applies the same check before submitting (`apps/api/src/workflow/pledge/activation.ts`).
- **Active locks are not affected.** A suspension never touches `CollateralLock`.
- Daml Script test `test_suspension_blocks_new_activation_by_policy` (`daml/collara/tests`) shows a new activation failing after the mirror sync under `REQUIRE_ACTIVE_VERIFIER`, and proceeding after the registrar switches to `ALLOW_ISSUED_ATTESTATIONS`. The policy is registrar-controlled (`Config_Update`), one more reason the registrar is a trust assumption ([limitations](limitations.md#trust-assumptions)).

## 3. Three different thresholds

These are often conflated. Collara's documentation keeps them apart (research notes: `docs/_research/research-dm.md` §2).

1. **Application governance threshold.** `GovernanceRules.threshold` in Daml: how many distinct member *parties* must confirm before a governed action executes. **Tier A: 2 of 3. Implemented and tested. Tier B: the same contract, signed by the decentralized party, tested through DM.**
2. **Decentralized-namespace (topology) threshold.** In a DM deployment, how many owner participants must sign topology changes of the decentralized party (namespace and hosting updates, member changes, threshold changes). **Not present in Tier A**: there is no decentralized namespace. Tier B: 2 of 3 owner keys; one owner's signature leaves a hosting change pending, two apply it (governance-tier-b.md §4.2).
3. **Participant confirmation threshold (and party signing-key threshold).** In a DM deployment, the decentralized party is hosted on every member participant with confirmation permission; this threshold says how many hosting participants must confirm a transaction in which that party is a confirming party, and how many Daml signing keys must sign a submission that acts as it. It would make governance transactions (and, likely, accreditation fetches) depend on enough member nodes being online. **Not present in Tier A**: one participant hosts everything. Tier B: confirmation threshold 2 of 3 participants and signing-key threshold 2 of 3 keys; with one member participant online a governance confirm and a verifier's accreditation fetch are rejected (`MEDIATOR_SAYS_TX_TIMED_OUT`), with two they commit (governance-tier-b.md §4.3, §4.4, §5).

## 4. Tier A trust limits (stated, not hidden)

- **Whoever holds the `CollaraGovernance` credential can sign registry contracts without any quorum.** The 2-of-3 rule binds the seats, not the governance party's own key (daml-model.md §8, item 4). Tier B removes this by making the governance party a decentralized party.
- **One participant, one operator.** All seats, the governance party and every organization live on one local participant run by one operator, who sees every transaction. Seats are separate parties, which shows the authorization model, not operator independence. No local setup proves operator independence.
- **Registrar mirror.** Pledge activation trusts the registrar's `VerifierStatusMirror`, which can lag a governed suspension; attestation issuance and assignment acceptance always check the real accreditation (daml-model.md §8, item 3). The registrar alone sets the suspension policy.

## 5. Tier B

Tier B ran on 2026-10-03; see [governance-tier-b.md](governance-tier-b.md).

The setup:

- DM `dec-party-manager` v1.12.0, one node per participant.
- Canton open-source 3.5.19 in WSL: one sequencer, one mediator and three participants, in one JVM.
- A decentralized governance party `collara-gov::1220…` onboarded by DM, with `GovernanceRules` created through DM `/contracts`.

What passed, with confirms and executes going through each member's own DM node:

- the same Collara proposal templates as Tier A;
- one-confirmation, duplicate, two-member Add and Suspend checks;
- the stale-proposal check;
- attestation blocked after suspension;
- the lock not releasable by governance;
- the one-member versus two-member topology check.

Limits:

- It is a separate topology run by one operator.
- The Collara API, worker and UI still run Tier A (governance-tier-b.md §9).
- The attestation workflow must share the governance party's synchronizer, and on Tier B an accreditation fetch needs two governance member participants online.

## 6. What a real independent-operator deployment needs

- **Independent operators**: each seat holder runs (or contracts) its own Canton participant node, with its own keys and admin access. A single operator running all nodes, as in any local demo, does not demonstrate independence.
- **A decentralized governance party** created by DM onboarding across the member participants, with deliberately chosen namespace, confirmation and signing-key thresholds (§3), and an operational plan for members being offline (confirmations need enough member participants online).
- **`GovernanceRules` signed by the decentralized party** (DM `/contracts`), with the Collara governance DARs distributed and vetted on every member participant.
- **Per-member credentials** for the Ledger API through the operators' identity providers (JWKS-based auth; the current API and worker only mint HMAC tokens for the local sandbox: `packages/canton/src/auth.ts`).
- **Measured privacy and availability coupling**: whether the decentralized party becomes a confirming party when a verifier fetches a governance-signed accreditation (research-dm.md §7.3, open question Q4) and what that means for attestation availability.
- **Governance procedures off-ledger**: who may hold a seat, how seats are rotated, and how disputes are handled. None of this exists yet.

See also: [`docs/architecture/daml-model.md`](architecture/daml-model.md) §4.8 (templates and choices), [`docs/limitations.md`](limitations.md), [`docs/permissions.md`](permissions.md) (`governance.act`).
