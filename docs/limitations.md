# Limitations

What Collara does **not** do or prove, as of 2026-10-02. This list is deliberately blunt; read it before describing the demo to anyone. Collara is an MVP with synthetic data only. It is not production-ready and carries no security assurance.

## What the workflow proves, and what it does not

- **Verification is not proof of title or of value.** An attestation records the checks a verifier listed, at a point in time, against a specific evidence package version. The approved dialog copy says so: `This attestation records the checks listed above. It does not approve financing or establish legal lien priority.` A valuation recorded by a lender is that lender's figure for its own review. Valuation is not principal, and neither is a market price.
- **A hash match is not authenticity.** SHA-256 integrity checks confirm the bytes match the committed reference; they do not establish that a document is original, genuine or legally enforceable (`BOUNDARY_COPY.HASH_MATCH`).
- **Internal pledge prevention is not external pledge detection.** The ledger guarantees at most one active Collara lock per registered asset id (one consuming `AssetControl` token per asset, registrar-only issuance). It knows nothing about liens, pledges or sales recorded outside Collara, in public registries or with lenders that do not use it.
- **Duplicate screening is exact-match only.** `AssetRegistry` rejects a second registration with the same normalized manufacturer, model and serial commitment. A typo, a different serial format or a re-plated machine defeats it; it is not proof of global physical uniqueness.
- **The Collara lock is not a legal lien, and release is not lien termination.** The release dialog says so: `This releases the Collara workflow lock. Any required legal lien termination must be completed separately.` Accepting a proposal does not move money: `Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.` Reports are labelled `Case workflow report — not a legal title or lien certificate.` Cash settlement, transfers, lien registration and ownership transfer are out of scope (ADR-0001).

## Ledger topology

- **LocalNet here means a Canton 3.5.19 `dpm sandbox`**, with 1 (or optionally 3) participants in one JVM, in-memory storage and unsafe HMAC JWT auth. It is **not Splice LocalNet** (the Docker-based Canton Network quickstart with validators, super-validator and wallet apps), and neither is **DevNet, TestNet or MainNet**. Nothing has been deployed to a Canton Network.
- **State is lost on restart.** Party ids, contract ids and offsets are new after every sandbox start; bootstrap, binding and seed must run again. The worker detects the reset and refuses to mix histories.
- **A single participant is not a privacy boundary.** Every organization's party is hosted on the same node, whose operator sees every transaction. Stakeholder-scoped reads in the API and read model show the intended disclosure; they do not prove ledger-level isolation between organizations.
- **Witness-level privacy across participants has not been tested.** The 3-participant mode exists (`pnpm localnet:up:3`), but the per-party update-stream tests that would confirm who receives which transaction (priority: `Control_Activate`, `VR_IssueAttestation`, `Release_Reject`) have not been run. The disclosure table in `docs/architecture/daml-model.md` §5 marks the untested rows `[INFERRED]`.
- **The projection worker's credential reads every party** on its participant (`projector-svc`). It is a privileged operator credential.
- **Ledger auth is HMAC only.** The API and worker mint HS256 tokens for the sandbox's `unsafe-jwt-hmac-256` auth. A JWKS/OAuth client-credentials token provider for a real participant is not implemented (`packages/canton/src/auth.ts`).

## Trust assumptions

- **Registrar trust.** The Collara registrar is the sole signatory of the asset registry, issuance tickets, the config (which pins the governance party and suspension policy) and the verifier status mirror. Its credential could mint a ticket outside the normal path, repin governance or publish a stale mirror; registrar plus owner collusion could mint a second control token. The registrar also learns asset ids, declared equipment identity, evidence anchors and lock/release existence (never terms, valuation or decisions). Details: `docs/architecture/daml-model.md` §8.
- **Governance Tier A.** The governance party is a local party: whoever holds its credential can sign registry contracts without the 2-of-3 quorum. See [`docs/governance.md`](governance.md).
- **Verifier status mirror lag.** Activation trusts the registrar's mirror, which can lag a governed suspension.
- **Attestation revocation is checked off-ledger at activation.** To keep the verifier unaware of pledges, `Control_Activate` does not fetch the attestation; the API checks that the lender still holds an active disclosure before submitting (tested in `pledge.it.test.ts`). A direct ledger submission that bypasses the API is not stopped by that check.
- **Lender-asserted snapshot.** The review snapshot (attestation ref, verifier, validity) is copied by the lender from its verifier-signed disclosure and accepted by the borrower; the ledger cross-checks the evidence anchor, not the attestation itself.

## Authority

- **Mandates are off-ledger.** Analyst vs approver, borrower and seat mandates live in PostgreSQL and are enforced by the API. The ledger sees only the organization party and records an opaque `actorRef`. A holder of the organization's ledger credential could exercise approver-only choices directly.
- **Demo sessions are not authentication.** `POST /api/demo/sessions` binds a browser to a seeded persona without a password. It is for local demos only and must be disabled (`DEMO_SESSIONS_ENABLED=false`) anywhere reachable; the API does not refuse it in production mode.
- **Not exercised end to end** (`docs/PROGRESS.md`): an OIDC code exchange through the API against Keycloak (only against a fake OIDC service), and Secure-cookie mode behind HTTPS.

## Data handling

- **Synthetic data only.** Every organization, person, asset and document in the repository is synthetic. Do not upload real documents or personal data.
- **No virus scanning.** Uploads are type-checked by magic bytes, size-capped (20 MB) and hashed, but not scanned; every document reports `NOT_SCANNED`. The UI copy (`Uploads are not virus-scanned in this synthetic-only demo.`) is INFERRED and pending approval.
- **Free-text notes are not stored in LOCALNET.** The lender's internal assessment notes are accepted by the API but not persisted (the read model returns `internalNotes: null`). A release request's note goes on the ledger as an empty `noteRef`; release information requests and responses carry only opaque references (`RR-…-Q<n>`, `RR-…-R<n>`). Shared lender feedback **is** recorded on the ledger (`LenderDecisionNotice.sharedFeedback`).
- **Revocation limits future access only.** Revoking a share or an audit grant stops future reads and downloads; copies already downloaded may still exist (`STATUS_COPY.ACCESS_REVOKED`).
- **Object storage keys.** Locally the API's S3 key pair is SeaweedFS's admin identity; per-identity least-privilege keys were not tested.

## Product gaps (from `docs/PROGRESS.md` "Known gaps")

- The dealer consent step `PARTIALLY_CONSENTED` is not modelled in the API or the mock.
- There is no `/app/cases/new` route.
- Overview per-currency totals have no endpoint (they show "Not available"). Amounts are never summed across currencies.
- The projection checkpoint is only reported per case.
- Accessibility: input, select and checkbox borders are 1.21:1 against the surface, below WCAG 1.4.11's 3:1; this needs a design decision.

## Copy and legal

- **Legal pages are pending (BPD-1).** The privacy notice, terms, pilot consent text, retention period and notification inbox are not written; `/privacy` and `/terms` say "pending legal review". No public URL that collects personal data (for example the pilot form) may go live until BPD-1 is resolved.
- **Strings marked INFERRED are not approved copy.** They exist in `packages/domain/src/copy.ts` and in web screens (login, dialogs, error states, governance notices, pilot form errors, docs footnotes) because a screen needed a string. They need approval before any public use.

## Engineering and operations

- **Continuous integration has not run.** `.github/workflows/ci.yml` and `localnet-it.yml` were written and linted with actionlint, but have not run on GitHub.
- **Container images and Compose files are untested.** No Docker on the authoring machine: the Dockerfiles, `infra/compose/compose.yaml` and its `app` and `canton` profiles have never been built or run. See [`infra/deploy/README.md`](../infra/deploy/README.md).
- **No compiled build of the API and worker.** Both run TypeScript through `tsx` in development and in the images.
- **Node 24** enters maintenance on 2026-10-20; ESLint 9 is end-of-life (ESLint 10 breaks `eslint-config-next`). See ADR-0001 §3.
- **Not measured:** load, latency, memory limits beyond the authoring machine, backup and restore, disaster recovery.
