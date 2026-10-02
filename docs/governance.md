# Governance (verifier registry)

Status, 2026-10-02: **Tier A is implemented and tested on a local Canton 3.5.19 sandbox. Tier B (a real Decentralization Manager topology) was not attempted.** Everything here uses synthetic organizations and one local operator.

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

**Daml Script tests** (IDE ledger, `daml/collara/tests`, 60 tests passing as reported in `docs/PROGRESS.md`): one confirmation cannot execute; duplicate confirmations do not count twice; two distinct confirmations execute an Add (and a replay fails); a stale proposal cannot execute; a passed deadline or expired confirmations block execution; only members confirm and execute; registry contracts need governance authority; a duplicate active verifier is rejected; the proposer can cancel; a governed suspension works; governance cannot release a lock.

**LOCALNET integration tests** on the Canton 3.5.19 sandbox (`apps/api/test/localnet/governance.it.test.ts`, part of the 49/49 run at commit `e320c59`). Each claim is checked through the API **and** on the ledger (ACS of the seat, registrar or verifier user); direct ledger submissions bypass the API's pre-checks to prove the ledger itself rejects:

| Test | Result |
|---|---|
| Before any change | Seat holders read the Tier A state; `VER-001` is ACTIVE; every other persona gets 404. |
| One confirmation | A seat-1 proposal to suspend `VER-001` (auto-confirmed) cannot execute: API 409 and a ledger rejection. |
| Duplicate confirmation | A seat confirming twice does not count twice (API 409; the ledger accepts the duplicate contract but never counts it). |
| Non-members | Demo Lender B's **business** party cannot confirm (ledger rejection); users without a seat get 404 on every governance mutation. |
| Two distinct seats | Execution suspends the verifier: registry v1, accreditation `SUSPENDED`, mirror `SUSPENDED`, visible through `GET /api/verifiers`. |
| Effect | The suspended verifier cannot issue an attestation (new accreditation: `Verifier suspended`; old one: archived). |
| Stale proposal | After another proposal moved the registry (re-adding Demo Verifier as `VER-001`, registry v2), a competing proposal pinned to v1 fails to execute: API 409 and ledger rejection. |
| Cancel | Only the proposer withdraws its open proposal; a withdrawn proposal cannot be confirmed. |
| Reconciliation | Governance command records carry the seat submission context (ledger user, `actAs`), so an `UNKNOWN_OUTCOME` is reconciled against the right user's completions. |

## 3. Three different thresholds

These are often conflated. Collara's documentation keeps them apart (research notes: `docs/_research/research-dm.md` §2).

1. **Application governance threshold.** `GovernanceRules.threshold` in Daml: how many distinct member *parties* must confirm before a governed action executes. **Tier A: 2 of 3. Implemented and tested.**
2. **Decentralized-namespace (topology) threshold.** In a DM deployment, how many owner participants must sign topology changes of the decentralized party (namespace and hosting updates, member changes, threshold changes). **Not present in Tier A**: there is no decentralized namespace.
3. **Participant confirmation threshold (and party signing-key threshold).** In a DM deployment, the decentralized party is hosted on every member participant with confirmation permission; this threshold says how many hosting participants must confirm a transaction in which that party is a confirming party, and how many Daml signing keys must sign a submission that acts as it. It would make governance transactions (and, likely, accreditation fetches) depend on enough member nodes being online. **Not present in Tier A**: one participant hosts everything.

## 4. Tier A trust limits (stated, not hidden)

- **Whoever holds the `CollaraGovernance` credential can sign registry contracts without any quorum.** The 2-of-3 rule binds the seats, not the governance party's own key (daml-model.md §8, item 4). Tier B removes this by making the governance party a decentralized party.
- **One participant, one operator.** All seats, the governance party and every organization live on one local participant run by one operator, who sees every transaction. Seats are separate parties, which shows the authorization model, not operator independence. No local setup proves operator independence.
- **Registrar mirror.** Pledge activation trusts the registrar's `VerifierStatusMirror`, which can lag a governed suspension; attestation issuance always checks the real accreditation (daml-model.md §8, item 3).

## 5. Tier B: not attempted, and why

Tier B means the DLC-link Decentralization Manager (`dec-party-manager` v1.12.0) running one node per member participant, creating a decentralized governance party (`collara-gov::1220…`) and the `GovernanceRules` contract through its `/contracts` workflow, with members confirming and executing through DM or the Ledger API (synthesis §3, research-dm.md §10).

It was not attempted in this build because:

- **Topology.** DM needs one Canton participant per member (at least 3 for the `/contracts` workflow) with Admin API access to each; three DM nodes on one participant cannot form a decentralized party.
- **Environment.** The DM application is published as a Linux amd64 container image; the authoring machine has no Docker. The planned workaround (extracting the binary and running Canton OSS with 3 participants, a sequencer and a mediator inside WSL) needs several GB of RAM on a machine that is already memory-constrained, and DM itself was tested by its maintainers against Canton 3.5.8, not plain Canton OSS 3.5.19.
- **Schedule.** Tier A was the agreed floor (synthesis risk R-02); Tier B was time-boxed behind the LOCALNET journey and was not started.

The Collara proposal templates are the same in both tiers; only the governance party, its hosting and the confirm/execute path change.

## 6. What a real independent-operator deployment needs

- **Independent operators**: each seat holder runs (or contracts) its own Canton participant node, with its own keys and admin access. A single operator running all nodes, as in any local demo, does not demonstrate independence.
- **A decentralized governance party** created by DM onboarding across the member participants, with deliberately chosen namespace, confirmation and signing-key thresholds (§3), and an operational plan for members being offline (confirmations need enough member participants online).
- **`GovernanceRules` signed by the decentralized party** (DM `/contracts`), with the Collara governance DARs distributed and vetted on every member participant.
- **Per-member credentials** for the Ledger API through the operators' identity providers (JWKS-based auth; the current API and worker only mint HMAC tokens for the local sandbox: `packages/canton/src/auth.ts`).
- **Measured privacy and availability coupling**: whether the decentralized party becomes a confirming party when a verifier fetches a governance-signed accreditation (research-dm.md §7.3, open question Q4) and what that means for attestation availability.
- **Governance procedures off-ledger**: who may hold a seat, how seats are rotated, and how disputes are handled. None of this exists yet.

See also: [`docs/architecture/daml-model.md`](architecture/daml-model.md) §4.8 (templates and choices), [`docs/limitations.md`](limitations.md), [`docs/permissions.md`](permissions.md) (`governance.act`).
