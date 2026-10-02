# Collara Daml model

- Status: implemented and tested on the Daml Script IDE ledger (2026-10-02). **Not yet run against a Canton node**, and not witness-tested across participants (see §10).
- Design source: `docs/_research/synthesis.md` §5 (this document records where the code deviates and why, §3).
- Code: `daml/collara/` (multi-package). Tests: `daml/collara/tests/`. Seeds: `daml/collara/scripts/`.

## 1. Packages, build and test

| Package (name 0.1.0) | Path | Depends on | Uploaded to the ledger? |
|---|---|---|---|
| `collara-governance` | `daml/collara/governance` | data-dep `governance-action-v1` (vendored DM DAR) | Yes. Bundled inside the contracts DAR |
| `collara-contracts` | `daml/collara/contracts` | data-dep `collara-governance` | **Yes**: `daml/collara/contracts/.daml/dist/collara-contracts-0.1.0.dar` (contains `collara-contracts`, `collara-governance` and `governance-action-v1`) |
| `collara-scripts` | `daml/collara/scripts` | daml-script, both DM DARs, governance, contracts | No. It is used with `dpm script --dar daml/collara/scripts/.daml/dist/collara-scripts-0.1.0.dar` |
| `collara-tests` | `daml/collara/tests` | daml-script, everything above | Never (it defines a test-only attacker template) |

Also upload to the ledger: `daml/collara/vendor-dars/governance-core-v1-0.1.0.dar` (DM `GovernanceRules`; not a build dependency of the contracts).

- Every `daml.yaml` has `sdk-version: 3.5.12` and `--target=2.2`. governance and contracts also have `-Werror=template-interface-depends-on-daml-script`; tests have `-Wno-…` because they intentionally define one template next to daml-script. No contract keys anywhere.
- Vendored DM DARs (v1.12.0, `releases/v1/`, Apache-2.0, LICENSE + NOTICE copied). Their SHA-256 values in `vendor-dars/SHA256SUMS` match `research-dm.md` §1: `4fc7912d…e485` (governance-action-v1, package `48acd500…fd61`) and `b8d05903…9544` (governance-core-v1, package `361d1f28…d488`).
- Main package ids **of the current source** (any source change changes them; downstream code must use package-name references, never these ids):
  - `collara-governance` `16cb6e82174e020290c7eba779951d25309fd2a23009f09d1ef4154b9bac2d7b`
  - `collara-contracts` `fce019fc48bde87cdc0be0b9a46418a285283eacf543d7e2676e72d83e05fac4`

Commands (from the repo root):

```bash
node daml/collara/check.mjs            # verify SHA256SUMS, dpm build --all, dpm test in tests/ and scripts/
# or by hand (Git Bash):
export PATH="$APPDATA/dpm/bin:$PATH"; export JDK_JAVA_OPTIONS=-Xmx1g
cd daml/collara && dpm.cmd build --all
(cd tests && dpm.cmd test) ; (cd scripts && dpm.cmd test)
```

`dpm test` must run inside a package directory; at the multi-package root it fails with `daml test: Not in package.` Result on 2026-10-02: `tests: 60 ok, 0 failed`, `scripts: 4 ok, 0 failed` (the 4 in scripts are the seed scripts and two helpers run as scripts).

## 2. Parties

One business party per organisation, plus governance. Party ids change on every sandbox restart, so they must be re-allocated and re-bound each start. Hints below are those used by `Collara.Scripts.Scenario.allocateParties`.

| Role | Party hint | Signs / controls |
|---|---|---|
| Collara registrar / operator | `CollaraRegistrar` | `AssetRegistry`, `IssuanceTicket`, `CollaraConfig`, `VerifierStatusMirror`. Co-signs `AssetControl`, `CollateralLock` and `RetiredControl`. Observer of `VerifierRegistry`/`VerifierAccreditation` (`operator`) |
| Governance party | `CollaraGovernance` (Tier A: local party; Tier B: the DM decentralized party) | `GovernanceRules`, `VerifierRegistry`, `VerifierAccreditation`, `GovernanceExecutionResult` |
| Governance seat 1 | `gov-seat-1` (Demo Lender A mandate) | Proposes, confirms and executes governed actions (`actAs seat, readAs governance`) |
| Governance seat 2 | `gov-seat-2` (Demo Lender B mandate) | same |
| Governance seat 3 | `gov-seat-3` (Demo Auditor mandate) | same |
| Demo Manufacturer (borrower / owner) | `DemoManufacturer` | Registration requests, passport, manifests, verification requests, shares, disclosures, acceptance, activation authorization, release requests, audit grants |
| Demo CNC Dealer | `DemoCNCDealer` | `DealerContribution`, consent to the onward sharing of its own documents |
| Demo Verifier (`VER-001`) | `DemoVerifier` | Assignment, change requests, attestations |
| Demo Lender A (selected) | `DemoLenderA` | Assessment, decision notices, proposals, activation, release decisions, audit grants |
| Demo Lender B (unrelated) | `DemoLenderB` | Nothing for CL-001. It is only an observer of the non-sensitive directory (`CollaraConfig`, `VerifierStatusMirror`) |
| Demo Auditor | `DemoAuditor` | Observer of `AuditGrant` only |

Analyst vs approver, and any other in-org mandate, are enforced by the API. Every decision choice carries an opaque `actorRef : Text` (for example `mbr:lender-a-approver`) that records who acted inside the organisation. Never put names or e-mail addresses in it.

## 3. Deviations from synthesis §5 (and why)

| # | Change | Why |
|---|---|---|
| D1 | `AssetControl.sharedLender : Optional Party` (not a `Set`) | "At most one shared lender" is enforced by the type as well as by the assert. |
| D2 | `AssetControl.evidence : Optional EvidenceAnchor` and a new `Control_AnchorEvidence`, exercised atomically by `Manifest_Anchor`/`Manifest_NewVersion` | Activation (lender-submitted) must compare the reviewed evidence with the owner's *current* package version. The owner-only `EvidenceManifest` is not on the lender's participant, and fetching it would need explicit disclosure. The registrar and the shared lender see only the opaque anchor (package ref, version, manifest hash). Consequence: evidence cannot change while the asset is locked (no `AssetControl` exists). |
| D3 | `Control_ShareWithLender` keeps `controlVersion`; `Control_RevokeLenderView`, evidence anchoring, correction, lock and release bump it | The version pins what an authorization relied on. Revocation bumps it, so it invalidates outstanding authorizations (tested). The fixture reproduces the prototype's `control v3 → v4 → v5`. |
| D4 | Verification requests are created and refreshed through manifest choices (`Manifest_RequestVerification`, `Manifest_SubmitToVerification`) | The request always references a real manifest version, and new evidence must be a newer version of the same package. |
| D5 | `ReviewSnapshot` (evidence anchor + attestation ref, verifier, validUntil) flows assessment → proposal → agreement → authorization. Proposals are issued only through `Assessment_IssueProposal` on an `ELIGIBLE` lender-signed assessment | Binds the terms to the exact reviewed evidence and attestation. A snapshot change returns the review to `NEEDS_INFORMATION`. |
| D6 | `Agreement_AuthorizeActivation` takes `authorizationRef, expectedControlVersion, expiresAt, actorRef`. Attestation and manifest data come from the agreement's snapshot | The borrower cannot mistype or alter what was reviewed. |
| D7 | `Control_Activate` also takes `configCid` | The suspension policy and the trusted governance party come from the registrar-signed config. |
| D8 | `Proposal_Accept` checks `expectedProposalRef` and `expectedVersion`; added `Proposal_Revise` (consumes vN, creates vN+1) | "A terms change means a new version and a new acceptance." |
| D9 | `PackageShareProposal` lists **only the dealer's documents**. The owner shares its own documents with a separate owner-signed `PackageShare` | The dealer never sees metadata (doc refs, hashes) of the owner's documents. Permission matrix: dealer = "own contribution + granted". |
| D10 | `AssetRegistry` also keeps `issuedIdentityCommitments`. `AssetRegistrationRequest` enforces `identityCommitment == identityCommitmentOf equipment` (SHA-256 of `MANUFACTURER\|MODEL\|SERIAL`, trimmed and ASCII upper-cased, computed on-ledger) | On-ledger exact-match duplicate screening that cannot be fooled by a mismatched owner-supplied hash. It is not proof of global physical uniqueness. |
| D11 | `ReleaseRequest` `ensure requester ∈ {owner, lender}`; `Release_Authorize` requires status `REQUESTED` | Release request states per §1.5 #11. |
| D12 | Corrections: `VR_IssueAttestation{supersedes = Some Supersession}` consumes the old attestation (`Att_Supersede`) and withdraws its disclosures (`AttDisc_Withdraw`, verifier-controlled). `Att_Revoke` leaves a `RevokedAttestation` record | Issued records are never edited, and superseded copies stop being visible to recipients. |
| D13 | Package name `collara-governance` (synthesis: `collara-governance-v0`) | Task instruction. A breaking change ships as a new package name. |
| D14 | Terminal outcomes without a successor contract (verification decline/reject/cancel, registration decline/withdraw, proposal decline/withdraw, consent decline, share revoke, grant revoke, release withdraw) archive the contract | The projection reads them from the exercised event (choice name + argument) in `TRANSACTION_SHAPE_LEDGER_EFFECTS` updates. |

## 4. Templates and choices

Legend: **S** signatories, **O** observers, **C** controller, (c) consuming, (nc) non-consuming. Every choice argument record also has `actorRef : Text` unless stated otherwise. Shared value types (`Collara.Types`): `Money {amount : Numeric 2, currency : Text}` (amount > 0, currency 3 upper-case letters); `EvidenceAnchor {packageRef, manifestVersion : Int, manifestHash}`; `ReviewSnapshot {evidence : EvidenceAnchor, attestationRef, attestationVerifier : Party, attestationValidUntil : Time}`.

### 4.1 `Collara.Config` (A)

**`CollaraConfig`**. S registrar, O `directory`. Fields: `registrar, namespace, governanceParty, suspensionPolicy (REQUIRE_ACTIVE_VERIFIER | ALLOW_ISSUED_ATTESTATIONS), configVersion, directory : [Party]` (verifiers and lenders that use the config and verifier status as inputs). This is the trust anchor that pins the governance party.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Config_Update` (c) | registrar | `newGovernanceParty, newSuspensionPolicy, newDirectory` | recreates with `configVersion+1` | — |
| `Config_PublishVerifierStatus` (nc) | registrar | `accreditationCid, sourceRef` | creates a `VerifierStatusMirror` from the accreditation | the accreditation is not signed by `governanceParty` |

**`VerifierStatusMirror`**. S registrar, O `directory`. Fields: `registrar, namespace, governanceParty, verifier, verifierRef, status, registryVersion, sourceRef, directory`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Mirror_Sync` (c) | registrar | `configCid, accreditationCid, newSourceRef` | recreates with the accreditation's status and version and the config's directory | wrong config, untrusted governance, another verifier, archived (stale) accreditation |

Publish exactly one mirror per verifier with `Config_PublishVerifierStatus`, then keep it current with `Mirror_Sync` after every governed change. This is registrar discipline; see §8.

### 4.2 `Collara.Registration` (B)

**`AssetRegistrationRequest`**. S owner, O registrar. Fields: `owner, registrar, namespace, requestRef, equipmentClass, equipment {manufacturer, model, serialNumber}, details {yearOfManufacture : Optional Int, locationScope}, identityCommitment, ownerClaimRef`. `ensure identityCommitment == identityCommitmentOf equipment`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Request_Accept` (c) | registrar | `ticketCid` | consumes the ticket; creates `AssetControl` v1 (no evidence, no lender) and `AssetPassport` v1. Returns `(controlCid, passportCid)` | ticket for another request, commitment, owner or namespace; ticket already used |
| `Request_Decline` (c) | registrar | `reasonCode` | archives. Use a generic code; never reveal another party's registration | — |
| `Request_Withdraw` (c) | owner | — | archives | — |

**`AssetRegistry`**. S registrar, O none. Fields: `registrar, namespace, issuedAssetIds : Set Text, issuedIdentityCommitments : Set Text, version`. Exercised top-level by the registrar only.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Registry_Reserve` (c) | registrar | `assetId, owner, requestRef, identityCommitment` | recreates with both ids added and `version+1`; creates an `IssuanceTicket`. Returns `(registryCid, ticketCid)` | `Asset id already issued`; `Identity already registered` |

**`IssuanceTicket`**. S registrar, O owner. Single use. Fields: `registrar, owner, namespace, assetId, requestRef, identityCommitment`.

**`AssetPassport`**. S owner. No valuation, no terms. Fields: `owner, registrar` (reference only), `namespace, assetId, passportVersion, equipmentClass, equipment, details, identityCommitment, documents [{docRef, sha256}], registeredAt`. Choice `Passport_NewVersion` (c, owner; `newDetails, newDocuments`). Archiving the passport does not affect control or lock (tested).

### 4.3 `Collara.Control` (B, C)

**`AssetControl`** is the canonical control token. S registrar, owner; O `sharedLender`. Fields: `registrar, owner, namespace, assetId, controlVersion, evidence : Optional EvidenceAnchor, sharedLender : Optional Party`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Control_ShareWithLender` (c) | owner | `lender` | recreates with `sharedLender = Some lender` (same version) | `Control is already shared with a lender; revoke that view first`; lender is owner/registrar |
| `Control_RevokeLenderView` (c) | owner | `lender` | recreates without the lender, version+1 | not the shared lender |
| `Control_AnchorEvidence` (c) | owner | `anchor` | recreates with the new anchor, version+1 (called from manifest choices) | invalid anchor; same package with a non-increasing version |
| `Control_Correct` (c) | owner | `reason` | version+1. Impossible while locked: no control exists | empty reason |
| `Control_Retire` (c) | owner | `reason` | creates `RetiredControl`. The id stays in the registry | — |
| `Control_Activate` (c) | **`lender` (argument)** | `lender, authorizationCid, configCid, verifierStatusCid, lockRef` | consumes the control and the authorization; creates `CollateralLock` with `controlVersion+1` | `Control is not shared with this lender`; `Authorization is for another lender or borrower` / `…another asset`; `Control version changed since authorization`; `Evidence package changed since authorization`; `Activation authorization expired`; `Attestation is outside its validity period`; config/mirror of another registrar, namespace, verifier or governance; `Verifier suspended` (policy `REQUIRE_ACTIVE_VERIFIER`); archived control (`CONTRACT_NOT_FOUND`/contention on a node) |

`Control_Activate` deliberately **does not fetch** the verifier-signed attestation or the governance-signed accreditation, which would inform the verifier or the governance members. It fetches only the lender+borrower authorization, the registrar's config and the mirror.

**`CollateralLock`** (pledge `ACTIVE`). S registrar, owner, lender; O none. Fields: `registrar, owner, lender, namespace, assetId, controlVersion, evidence, lockRef, caseRef, authorizationRef, agreementRef, attestationRef, activatedAt, activatedByRef`. **No terms.**

| Choice | C | Args | Effect |
|---|---|---|---|
| `Lock_Release` (c) — the only choice | lock `lender` | `releaseRequestRef` | creates `AssetControl` (`controlVersion+1`, same evidence, no lender) and `CollateralLockReleased`. Returns `(controlCid, releasedCid)` |

The built-in `Archive` needs registrar, owner **and** lender.

**`CollateralLockReleased`** (`RELEASED` history). S lender, owner; O registrar. Fields: `lockRef, caseRef, releaseRequestRef, lockControlVersion, releasedControlVersion, activatedAt, releasedAt, releasedByRef`, plus the parties, namespace and asset id. **`RetiredControl`**: S registrar, owner.

### 4.4 `Collara.Release` (C)

**`ReleaseRequest`**. S requester; O owner, lender. Fields: `requester` (owner or lender), `owner, lender, lockCid, lockRef, caseRef, namespace, assetId, releaseRequestRef, reason (EXTERNAL_LOAN_COMPLETION | REFINANCING | ADMINISTRATIVE_CORRECTION), noteRef, status (REQUESTED | INFORMATION_REQUESTED), version, requestedByRef`. Creating it never touches the lock.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Release_Authorize` (c) | `lender` | `decisionRef` | fetches the lock, exercises `Lock_Release`, creates `ReleaseDecision{AUTHORIZED}`. Returns `(controlCid, releasedCid, decisionCid)` | `Release request is waiting for information`; `Release requires the designated lender's authorization.` (lock lender differs); request/lock mismatch; lock already released |
| `Release_Reject` (c) | `lender` | `decisionRef, sharedReason` | creates `ReleaseDecision{REJECTED}`. **Lock untouched** | — |
| `Release_RequestInformation` (c) | `lender` | `questionRef` | status `INFORMATION_REQUESTED`, version+1 | not `REQUESTED` |
| `Release_Respond` (c) | owner | `responseNoteRef` | status `REQUESTED`, version+1 | no information requested |
| `Release_Withdraw` (c) | requester | — | archives | — |

**`ReleaseDecision`**. S lender, O owner. Fields: `decisionRef, releaseRequestRef, lockRef, caseRef, outcome (AUTHORIZED | REJECTED), sharedReason, decidedAt, decidedByRef`.

### 4.5 `Collara.Verification` (D)

**`VerificationRequest`**. S owner, O verifier. Fields: `owner, verifier, registrar, namespace, requestRef, assetId, passportVersion, caseRef : Optional Text, evidence : EvidenceAnchor, equipmentScope, checklist, dueBy : Optional Time, status (REQUESTED | IN_REVIEW | CHANGES_REQUESTED), version, changeNote`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `VR_AcceptAssignment` (c) | verifier | `configCid, accreditationCid` | `IN_REVIEW` | not `REQUESTED`; accreditation check (below) |
| `VR_DeclineAssignment` (c) | verifier | `reason` | archives (`DECLINED`) | not `REQUESTED` |
| `VR_RequestChanges` (c) | verifier | `note` | `CHANGES_REQUESTED` | not `IN_REVIEW` |
| `VR_SubmitNewEvidence` (c) | owner | `newEvidence` (via `Manifest_SubmitToVerification`) | `IN_REVIEW` with the new anchor | no changes requested; not a newer version of the same package |
| `VR_IssueAttestation` (c) | verifier | `configCid, accreditationCid, attestationRef, checks [{item, finding, result}], limitations, method, inspectedAt, validFrom, validUntil, supersedes : Optional {previousCid, previousDisclosureCids}` | creates `VerificationAttestation` (`ATTESTED`); optionally supersedes | `Request is not in review`; accreditation check |
| `VR_Reject` (c) | verifier | `reason` | archives (`REJECTED`) | not under review |
| `VR_Cancel` (c) | owner | — | archives (`CANCELLED`) | — |

Accreditation check (at accept and at issue, at commit time): config of the request's registrar and namespace; `Untrusted registry: accreditation is not signed by the Collara governance party`; `Accreditation is for another verifier`; `Verifier suspended`; `Accreditation expired`; `Out of accreditation scope`.

**`VerificationAttestation`** is immutable. S verifier, O owner. Fields: `verifier, owner, registrar, namespace, governanceParty, attestationRef, requestRef, verifierRef, assetId, passportVersion, caseRef, evidence, equipmentScope, checks, limitations, method, inspectedAt, validFrom, validUntil, supersedesRef, issuedAt, issuedByRef`. `CheckResult`: `CHECKED | CHECKED_NOTED | REVIEWED_DOCUMENTS | NOT_CHECKED`. `EXPIRED` is computed from `validUntil`.

| Choice | C | Args | Effect |
|---|---|---|---|
| `Att_DiscloseTo` (nc) | owner | `recipient, purpose, disclosureCaseRef` | creates a verifier-signed `AttestationDisclosure` copy for one recipient |
| `Att_Revoke` (c) | verifier | `reason, disclosureCids` | withdraws the listed disclosures; creates `RevokedAttestation` |
| `Att_Supersede` (c) | verifier | `disclosureCids, supersededByRef` (no actorRef) | withdraws disclosures; archives (`SUPERSEDED`) |

**`AttestationDisclosure`**. S verifier, owner; O recipient. Fields: `verifier, owner, recipient, purpose, caseRef, attestationCid, attestation` (full copy), `disclosedAt`. `AttDisc_Revoke` (c, owner) limits future visibility only. `AttDisc_Withdraw` (c, verifier) is used by supersede/revoke. **`RevokedAttestation`**: S verifier, O owner.

### 4.6 `Collara.Evidence` (E). Hashes and opaque refs only; bytes stay in private storage

**`EvidenceManifest`**. S owner. Fields: `owner, registrar, namespace, assetId, packageRef, version, manifestHash, entries [{docRef, docType, docVersion, sha256, source : Party, contributorRef}]`.

| Choice | C | Args | Effect |
|---|---|---|---|
| `Manifest_Anchor` (nc) | owner | `controlCid` | anchors this version on the control (version+1). Returns the new control cid |
| `Manifest_NewVersion` (c) | owner | `newEntries, newManifestHash, controlCid` | creates version+1 and moves the control anchor **atomically**. Returns `(manifestCid, controlCid)`. Impossible while locked |
| `Manifest_RequestVerification` (nc) | owner | `verifier, requestRef, passportVersion, caseRef, equipmentScope, checklist, dueBy` | creates a `VerificationRequest` for this version |
| `Manifest_SubmitToVerification` (nc) | owner | `requestCid` | `VR_SubmitNewEvidence` with this version |

**`DealerContribution`**. S dealer, O owner. Fields: `dealer, owner, caseRef, docRef, docType, docVersion, sha256, contributorRef, verificationUseConsented`. Choice `Contribution_Withdraw` (c, dealer).

**`PackageShareProposal`**. S owner, O dealer. Fields: `owner, dealer, recipient, shareRef, purpose, caseRef, evidence, documents [{docRef, docVersion, sha256, source}]` (**dealer documents only**), `permission (VIEW | VIEW_DOWNLOAD), expiresAt`. Choices: `Consent_Grant` (c, dealer; fails if expired) creates `PackageShare{consenters=[dealer]}`; `Consent_Decline` (c, dealer; `reason`); `ShareProposal_Withdraw` (c, owner).

**`PackageShare`**. S owner + `consenters`; O recipient. Same fields plus `consenters`. Every document's `source` must be the owner or a consenter, so the owner cannot share a dealer document without the dealer's signature (tested). Choices: `Share_Revoke` (c, owner) and `Share_WithdrawConsent` (c, a consenter; `consenter`). The API must check for an active, unexpired share covering the document at every download.

### 4.7 `Collara.Financing` (F). Terms exist only here

**`CollateralAssessment`**. S lender (borrower is a reference only). Fields: `lender, borrower, assessmentRef, caseRef, namespace, assetId, snapshot : ReviewSnapshot, valuation : Optional {value : Money, source, valuationDate : Date, limitations}, policyRef, status, version, lastActorRef`. Status: `SUBMITTED → IN_REVIEW → (NEEDS_INFORMATION ↔ IN_REVIEW) → PENDING_APPROVAL → ELIGIBLE | REJECTED`. Internal notes and the risk view stay off-ledger.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Assessment_StartReview` (c) | lender | — | `IN_REVIEW` | not `SUBMITTED`/`NEEDS_INFORMATION` |
| `Assessment_Save` (c) | lender | `newValuation, newPolicyRef` | saves the valuation | not `IN_REVIEW` |
| `Assessment_SubmitForApproval` (c) | lender | — | `PENDING_APPROVAL` | not `IN_REVIEW`; no valuation |
| `Assessment_Approve` (c) | lender | `noticeRef, sharedFeedback` | `ELIGIBLE` + `LenderDecisionNotice` | not `PENDING_APPROVAL` |
| `Assessment_Reject` (c) | lender | `noticeRef, sharedFeedback` | `REJECTED` + notice | not `IN_REVIEW`/`PENDING_APPROVAL` |
| `Assessment_RequestInformation` (c) | lender | `noticeRef, sharedFeedback` | `NEEDS_INFORMATION` + notice | not `IN_REVIEW`/`PENDING_APPROVAL` |
| `Assessment_UpdateSnapshot` (c) | lender | `newSnapshot` | `NEEDS_INFORMATION` (clears eligibility) | rejected; unchanged |
| `Assessment_IssueProposal` (nc) | lender | `proposalRef, principal : Money, termMetadata, externalLegalRef, expiresAt` | creates `FinancingProposal` v1 with the snapshot | `Assessment is not eligible`; attestation outside validity; expiry not in the future |

**`LenderDecisionNotice`**. S lender, O borrower. Outcome (`NEEDS_INFORMATION | ELIGIBLE | REJECTED`) and shared feedback only.

**`FinancingProposal`**. S lender, O borrower. Fields: `lender, borrower, proposalRef, version, caseRef, namespace, assetId, assessmentRef, snapshot, principal : Money, termMetadata, externalLegalRef, expiresAt, issuedAt, issuedByRef`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Proposal_Accept` (c) | borrower | `expectedProposalRef, expectedVersion` | creates `FinancingAgreement` (`ACCEPTED`, not funded) | `Proposal version mismatch`; `Proposal has expired`; old version (consumed) |
| `Proposal_Decline` (c) | borrower | `reason` | archives | — |
| `Proposal_Withdraw` (c) | lender | `reason` | archives (only before acceptance) | already accepted (consumed) |
| `Proposal_Revise` (c) | lender | `newPrincipal, newTermMetadata, newExternalLegalRef, newExpiresAt` | creates version+1 | expiry not in the future; invalid money |

**`FinancingAgreement`**. S lender, borrower; O none. Holds the terms. Fields: `agreementRef` (= proposalRef), `proposalVersion`, the proposal fields, `acceptedAt, acceptedByRef`.

| Choice | C | Args | Effect | Fails when |
|---|---|---|---|---|
| `Agreement_AuthorizeActivation` (nc) | **borrower** | `authorizationRef, expectedControlVersion, expiresAt` | creates `PledgeActivationAuthorization` | expiry not in the future; `Attestation is outside its validity period` |

**`PledgeActivationAuthorization`**. S lender, borrower. Single use (consumed by `Control_Activate`); **no principal, currency or terms**. Fields: `authorizationRef, caseRef, agreementRef, agreementVersion, namespace, assetId, expectedControlVersion, snapshot, expiresAt, authorizedAt, authorizedByRef`. `Auth_Withdraw` (c, borrower).

### 4.8 `Collara.Governance.*` (G, package `collara-governance`)

**`VerifierRegistry`**. S governanceParty, O operator. Fields: `governanceParty, operator, registryId, version, activeVerifiers : Set Party`. `Registry_Add` / `Registry_Remove` (c, governanceParty; `verifier`; no actorRef) recreate it with version+1 (`Verifier already active` / `Verifier not active`).

**`VerifierAccreditation`**. S governanceParty, O operator, verifier. Fields: `governanceParty, operator, verifier, verifierRef, orgName, scope : [Text], status (ACTIVE | SUSPENDED), validUntil : Optional Time, registryId, registryVersion, reason`. `Accreditation_Suspend` (c, governanceParty; `suspendReason, newRegistryVersion`).

Governed actions implement DM `GovernableAction` (S proposer, O governanceParty; the proposer must be a seat member or an additional proposer). Their permanent audit labels:

| Template | `actionLabel` | `executeImpl` |
|---|---|---|
| `BootstrapVerifierRegistryProposal {governanceParty, proposer, operator, registryId, genesisVerifiers [{verifier, verifierRef, orgName, scope, validUntil}], proposalDeadline, reason}` | `CollaraBootstrapVerifierRegistry` | deadline; creates registry v0 and one ACTIVE accreditation per genesis verifier |
| `AddVerifierProposal {governanceParty, proposer, registryCid, expectedVersion, verifier, verifierRef, orgName, scope, validUntil, proposalDeadline, reason}` | `CollaraAddVerifier` | deadline; pinned registry (`Stale registry version`, or archived cid); `Registry_Add`; creates the ACTIVE accreditation with `registryVersion = expectedVersion+1` |
| `SuspendVerifierProposal {governanceParty, proposer, registryCid, expectedVersion, accreditationCid, verifier, proposalDeadline, reason}` | `CollaraSuspendVerifier` | deadline; pinned registry; accreditation matches and is ACTIVE; `Registry_Remove`; `Accreditation_Suspend` |

DM's `GovernanceRules` (threshold 2 of seats 1–3, `actionConfirmationTimeout` 30 min) enforces: members only (`Confirmer is a governance member`, `Executor is a governance member`), an authorized proposer, `No duplicate confirmers`, `Enough confirmations to execute action`, and `Confirmation has expired`. Execute is consuming, so an executed proposal cannot run again.

### 4.9 `Collara.Audit` (H)

**`AuditGrant`**. S grantor (borrower for owner records, lender for lender records), O auditor. Fields: `grantor, auditor, grantRef, caseRef, scopes [EVIDENCE_MANIFEST | ATTESTATION | DECISION_OUTCOME | PROPOSAL_TERMS | PLEDGE_RELEASE_EVENTS], permission (VIEW | EXPORT), purpose, expiresAt`. `Grant_Revoke` (c, grantor). There is no global audit contract. Exports are produced off-ledger from the grantor's projection and filtered to the grant; expiry is checked at generation and at download.

## 5. Disclosure: who is informed of what

Two kinds of evidence back these rows: **[TESTED]** means active-contract visibility checked per party on the IDE ledger (`Collara.Tests.Privacy`), and **[INFERRED]** means Daml ledger-model informee rules. Under those rules, create informs stakeholders; a consuming exercise informs stakeholders + actors; a non-consuming exercise or a fetch informs signatories + actors; consequences go to the informees of the parent. The [INFERRED] rows still need a 3-participant witness test.

| Transaction (submitter) | Informed parties | What they learn |
|---|---|---|
| `Registry_Reserve` (registrar, top-level) | registrar | registry set (the owner never sees it [TESTED]) |
| `Request_Accept` (registrar) | owner, registrar | ticket, control v1, passport v1 |
| Manifest create/anchor/new version (owner) | owner; registrar and shared lender via the control | owner: entries. Registrar and lender: the anchor only (package ref, version, hash) |
| `VR_*` choices (verifier/owner) | owner, verifier; registrar (config fetch) and governance-party hosts (accreditation fetch) as informees of the fetch only [INFERRED] | request and attestation contents (owner, verifier). Fetch metadata (registrar, governance) |
| `Att_DiscloseTo` (owner) | owner, verifier, recipient | the attestation copy. The verifier learns *that* the owner disclosed to the recipient |
| Share proposal / consent / owner share | owner, dealer (its own documents only [TESTED]), recipient | doc refs and hashes in scope |
| `Control_ShareWithLender` (owner) | owner, registrar, lender | minimal control fields |
| Assessment / notice / proposal / accept / authorize | lender (+ borrower for notice, proposal, agreement, authorization) | terms, valuation and decisions are never visible to the verifier, dealer, registrar, Lender B, auditor or governance [TESTED at every step] |
| `Control_Activate` (lender) | registrar, owner, lender | control, authorization (no terms), lock, config/mirror fetch. The registrar learns "asset X locked to lender Y for case Z" [INFERRED]. Lender B and the verifier, though observers of config/mirror, are not informees of a fetch [INFERRED] |
| `Release_Reject` / request / information round | owner, lender | decision. The registrar is not informed and never sees requests or decisions [TESTED] |
| `Release_Authorize` (lender) | owner, lender, registrar (lock signatory) | release, recreated control, released record |
| Governance propose/confirm/execute | seats, governance party (+ operator for the registry and accreditation) | verifier registry changes. No case data |
| `AuditGrant` | grantor, auditor | grant scope. The auditor reads nothing before a grant and only grants afterwards [TESTED] |

A single-participant sandbox is not a privacy boundary: its operator sees everything. Claims about privacy between organisations need the 3-participant mode.

## 6. Invariants: enforcement and proof

| Invariant (MP §6 / S §11.7) | Enforcement | Tests (`daml/collara/tests/daml/Collara/Tests/…`) |
|---|---|---|
| One active pledge per asset (#1) | exactly one token per asset (`AssetControl` xor `CollateralLock`), every transition consuming; unique issuance via the registrar-only `AssetRegistry` | `Pledge.test_second_activation_fails`, `test_competing_lenders_lender_a_first`, `test_competing_lenders_lender_b_first`; `Registration.test_duplicate_asset_id_rejected`, `test_duplicate_identity_rejected`, `test_identity_commitment_computed_on_ledger`, `test_issuance_ticket_single_use_and_bound` |
| Activation consumes the available control atomically (#2) | `Control_Activate` is consuming. On a node, contention gives `LOCAL_VERDICT_LOCKED_CONTRACTS` then `CONTRACT_NOT_FOUND` (research-canton §4) | Daml Script: the second activation finds the control archived. **Live parallel contention is not tested here** (needs a sandbox) |
| No replacement control (#3) | `AssetControl` needs registrar + owner; tickets and the registry are registrar-only; corrections consume the control | `Registration.test_no_replacement_control`; `Pledge.test_control_choices_impossible_while_locked` |
| Exact-version acceptance; evidence changes handled (#5) | `Proposal_Accept(expectedProposalRef, expectedVersion)`; revisions consume; activation compares the authorization's version and evidence with the control | `Financing.test_accept_wrong_version_fails`, `test_accept_stale_version_fails`, `test_expired_proposal_cannot_be_accepted`, `test_proposal_requires_current_eligibility`; `Pledge.test_activation_after_manifest_bump_fails`, `test_revoked_view_invalidates_authorization`, `test_authorization_for_another_asset_fails` |
| Only an active assigned verifier issues; expiry and suspension (#7, #8) | `VR_*` controller is the request's verifier; the accreditation is checked against `CollaraConfig.governanceParty`, status, expiry and scope at commit; activation checks `attestationValidUntil` and the mirror per policy | `Verification.test_unassigned_verifier_cannot_attest`, `test_suspended_verifier_cannot_attest`, `test_forged_accreditation_rejected`, `test_expired_accreditation_rejected`, `test_out_of_scope_verifier_rejected`, `test_owner_cannot_forge_attestation`, `test_attestation_requires_open_review`, `test_supersede_and_revoke`, `test_suspension_blocks_new_activation_by_policy`; `Pledge.test_activation_with_expired_attestation_fails`, `test_activation_with_expired_authorization_fails` |
| Release requests and rejections leave the lock active (S §11.5) | `ReleaseRequest` never exercises the lock; `Release_Reject` does not fetch it | `Pledge.test_release_requests_leave_lock_active`; `HappyPath.test_happy_path` |
| Only the designated lender releases (#6) | `Lock_Release` C = `lock.lender`; `Archive` needs all three signatories; `Release_Authorize` checks the lock's lender | `Pledge.test_borrower_cannot_release`, `test_archive_of_lock_needs_lender`, `test_non_lenders_cannot_release` (governance, seats, verifier, auditor, dealer, Lender B), `test_release_request_cannot_redirect_authority`; `Governance.test_governance_cannot_release_lock` |
| Cancel/archive/correction/retry/expiry cannot bypass a lock (#4, #8) | no transfer choice; passport separate; no AssetControl while locked; consumed contracts cannot be replayed; expiry never touches the lock | `Pledge.test_passport_archive_keeps_lock`, `test_control_choices_impossible_while_locked`, `test_replays_of_consumed_contracts_fail`, `test_attestation_expiry_never_releases`. Command dedup (`DUPLICATE_COMMAND`) is a node property and is not tested here |
| Terms scoped to borrower and lender (#9) | terms only in `FinancingProposal`/`FinancingAgreement`; authorization, lock and release carry refs | `Privacy.test_privacy_through_the_walkthrough` (no third party reads terms, valuation or decisions after each of 10 steps; positive controls for borrower, Lender A and registrar) |
| Lender B unrelated; auditor explicit and scoped | Lender B is never a case stakeholder; `AuditGrant` per record owner | `Privacy.test_privacy_through_the_walkthrough`, `test_revocation_limits_future_visibility`, `test_dealer_consent_required_and_withdrawable` |
| Governance 2-of-3 | DM `GovernanceRules` + pinned registry, deadline and staleness in `executeImpl` | `Governance.test_one_confirmation_cannot_execute`, `test_duplicate_confirmations_do_not_count_twice`, `test_two_distinct_confirmations_execute_add_verifier` (+ replay), `test_stale_proposal_cannot_execute`, `test_deadline_passed_cannot_execute`, `test_expired_confirmations_cannot_execute`, `test_only_members_confirm_and_execute`, `test_registry_contracts_need_governance_authority`, `test_duplicate_active_verifier_rejected`, `test_proposer_can_cancel`, `test_suspend_verifier_governed` |

Every negative test asserts *why* it failed (`Collara.Tests.Util`: authorization error, `NotActive` archived contract, `NotVisible`, precondition, or a specific assertion message). The helpers were checked with a temporary module of seven deliberately wrong expectations (since removed). Six failed as intended. The seventh passed because the control itself was mis-specified: the contract it targeted was already archived, so `NotActive` was the correct report.

## 7. Happy-path command sequence (the API follows this exactly)

Every step has a single `actAs` party. Governance steps add `readAs` the governance party. "→" names the result to capture. Template ids use `#collara-contracts:<Module>:<Template>` (§9). Times are ledger time ("now") plus offsets; never hard-coded dates. Source of truth: `daml/collara/scripts/daml/Collara/Scripts/Scenario.daml` (`bootstrap`, `buildMainFixture`, `runHappyPath`).

**Bootstrap ("clean-start" seed)**

| # | actAs | Command | Arguments (Daml record fields) | → |
|---|---|---|---|---|
| B1 | registrar | create `Collara.Registration:AssetRegistry` | `registrar, namespace="collara-localnet", issuedAssetIds=∅, issuedIdentityCommitments=∅, version=0` | assetRegistryCid |
| B2 | governance (Tier A) | create `#governance-core-v1:Governance.Rules:GovernanceRules` | `governanceParty, members={seat1,seat2,seat3}, threshold=2, actionConfirmationTimeout=30 min, additionalProposers=None` | rulesCid (Tier B: DM `/contracts`) |
| B3 | seat1 | create `#collara-governance:Collara.Governance.Proposals:BootstrapVerifierRegistryProposal` | `proposer=seat1, operator=registrar, registryId="collara-localnet", genesisVerifiers=[{verifier=DemoVerifier, verifierRef="VER-001", orgName="Demo Verifier", scope=["CNC_MACHINERY"], validUntil=Some(now+365d)}], proposalDeadline=now+1d, reason` | proposalCid |
| B4–B5 | seat1, then seat2 (readAs governance) | exercise `GovernanceRules_ConfirmAction` on rulesCid | `confirmer=<seat>, actionProposalCid=proposalCid` | c1, c2 (`.confirmationCid`) |
| B6 | seat2 (readAs governance) | exercise `GovernanceRules_ExecuteConfirmedAction` | `executor=seat2, actionProposalCid, confirmations=[c1,c2]` | executionResultCid. Then query: registryCid (operator view), accreditationCid (VER-001) |
| B7 | registrar | create `Collara.Config:CollaraConfig` | `registrar, namespace, governanceParty, suspensionPolicy=REQUIRE_ACTIVE_VERIFIER, configVersion=1, directory=[DemoVerifier, DemoLenderA, DemoLenderB]` | configCid |
| B8 | registrar | exercise `Config_PublishVerifierStatus` on configCid | `accreditationCid, sourceRef="GP-000"` | mirrorCid |

**Main fixture ("main" seed): registered, ATT-001, PKG-001 v2 shared with Lender A, review SUBMITTED**

| # | actAs | Command | Arguments | → |
|---|---|---|---|---|
| M1 | owner | create `AssetRegistrationRequest` | `owner, registrar, namespace, requestRef="REG-001", equipmentClass="CNC machining center", equipment={manufacturer="Demo Machine Works (synthetic)", model="DEMO-CNC-500", serialNumber="SYNTH-CNC-001"}, details={yearOfManufacture=Some 2019, locationScope="Demo Manufacturer facility · Ohio, US (declared)"}, identityCommitment=identityCommitmentOf(equipment), ownerClaimRef` | requestCid |
| M2 | registrar | `Registry_Reserve` on assetRegistryCid | `assetId="ASSET-DEMO-001", owner, requestRef="REG-001", identityCommitment, actorRef` | (assetRegistryCid', ticketCid) |
| M3 | registrar | `Request_Accept` on requestCid | `ticketCid, actorRef` | (control **v1**, passportCid). Asset `REGISTERED` |
| M4 | dealer | create `DealerContribution` | `dealer, owner, caseRef="CL-001", docRef="DOC-001", docType="INVOICE", docVersion=1, sha256, contributorRef, verificationUseConsented=True` | contributionCid |
| M5 | owner | create `EvidenceManifest` | `packageRef="PKG-001", version=1, manifestHash, entries=[DOC-001 (dealer), DOC-002, DOC-003 v1, DOC-004 (owner)]` | manifest1 |
| M6 | owner | `Manifest_Anchor` on manifest1 | `controlCid, actorRef` | control **v2** |
| M7 | owner | `Manifest_RequestVerification` on manifest1 | `verifier=DemoVerifier, requestRef="VR-001", passportVersion=1, caseRef=Some "CL-001", equipmentScope="CNC_MACHINERY", checklist, dueBy=Some(now+10d), actorRef` | request (`REQUESTED`) |
| M8 | verifier | `VR_AcceptAssignment` | `configCid, accreditationCid, actorRef` | request (`IN_REVIEW`) |
| M9 | verifier | `VR_RequestChanges` | `note, actorRef` | request (`CHANGES_REQUESTED`) |
| M10 | owner | `Manifest_NewVersion` on manifest1 | `newEntries (DOC-003 v2), newManifestHash, controlCid (v2), actorRef` | (manifest2, control **v3**) |
| M11 | owner | `Manifest_SubmitToVerification` on manifest2 | `requestCid, actorRef` | request (`IN_REVIEW`, PKG-001 v2) |
| M12 | verifier | `VR_IssueAttestation` | `configCid, accreditationCid, attestationRef="ATT-001", checks, limitations, method, inspectedAt=now, validFrom=now, validUntil=now+180d, supersedes=None, actorRef` | attestationCid |
| M13 | owner | create `PackageShareProposal` | `dealer, recipient=DemoLenderA, shareRef="SHR-001", purpose="LENDER_REVIEW", caseRef, evidence=anchor(manifest2), documents=[DOC-001], permission=VIEW_DOWNLOAD, expiresAt=now+30d` | shareProposalCid |
| M14 | dealer | `Consent_Grant` | `actorRef` | dealerShareCid |
| M15 | owner | create `PackageShare` | `consenters=[], recipient=DemoLenderA, shareRef="SHR-002", documents=[DOC-002, DOC-003 v2, DOC-004]`, same purpose, case, anchor, permission and expiry | ownerShareCid |
| M16 | owner | `Control_ShareWithLender` on control v3 | `lender=DemoLenderA, actorRef` | controlCid (still **v3**, new cid) |
| M17 | owner | `Att_DiscloseTo` on attestationCid | `recipient=DemoLenderA, purpose="LENDER_REVIEW", disclosureCaseRef="CL-001", actorRef` | disclosureCid. Review `SUBMITTED` |
| M18 | lenderA | create `CollateralAssessment` | `borrower, assessmentRef="CA-001", caseRef, namespace, assetId, snapshot` (from the lender's disclosure: evidence, attestationRef, attestation.verifier, attestation.validUntil), `valuation=None, policyRef="CP-2026-CNC-01", status=SUBMITTED, version=1, lastActorRef` | assessmentCid |

**Walkthrough**

| # | actAs | Command | Arguments | → |
|---|---|---|---|---|
| W1 | lenderA (analyst) | `Assessment_StartReview` | `actorRef` | `IN_REVIEW` |
| W2 | lenderA (analyst) | `Assessment_Save` | `newValuation={value={amount=150000.00, currency="USD"}, source, valuationDate, limitations}, newPolicyRef, actorRef` | |
| W3 | lenderA (analyst) | `Assessment_SubmitForApproval` | `actorRef` | `PENDING_APPROVAL` |
| W4 | lenderA (approver) | `Assessment_Approve` | `noticeRef="LDN-001", sharedFeedback, actorRef` | (eligibleCid, noticeCid) |
| W5 | lenderA (approver) | `Assessment_IssueProposal` on eligibleCid | `proposalRef="FP-001", principal={100000.00, "USD"}, termMetadata, externalLegalRef, expiresAt=now+14d, actorRef` | proposalCid (v1) |
| W6 | owner | `Proposal_Accept` | `expectedProposalRef="FP-001", expectedVersion=1, actorRef` | agreementCid |
| W7 | owner | `Agreement_AuthorizeActivation` | `authorizationRef="AUTH-001", expectedControlVersion=3, expiresAt=now+7d, actorRef` | authorizationCid |
| W8 | lenderA (approver) | `Control_Activate` on controlCid | `lender=DemoLenderA, authorizationCid, configCid, verifierStatusCid=mirrorCid, lockRef="PL-001", actorRef` | lockCid (**v4**, `ACTIVE`) |
| W9 | owner | create `ReleaseRequest` | `requester=owner, owner, lender=DemoLenderA, lockCid, lockRef="PL-001", caseRef, namespace, assetId, releaseRequestRef="RR-001", reason=EXTERNAL_LOAN_COMPLETION, noteRef, status=REQUESTED, version=1, requestedByRef` | rr1 (lock still `ACTIVE`) |
| W10 | lenderA (approver) | `Release_Reject` on rr1 | `decisionRef="RD-001", sharedReason, actorRef` | decision `REJECTED` (lock still `ACTIVE`) |
| W11 | owner | create `ReleaseRequest` | as W9 with `releaseRequestRef="RR-002"` | rr2 |
| W12 | lenderA (approver) | `Release_Authorize` on rr2 | `decisionRef="RD-002", actorRef` | (control **v5** `AVAILABLE`, releasedCid, decisionCid) |
| W13 | owner | create `AuditGrant` | `auditor=DemoAuditor, grantRef="AG-001", caseRef, scopes=[EVIDENCE_MANIFEST, ATTESTATION], permission=EXPORT, purpose, expiresAt=now+30d` | |
| W14 | lenderA | create `AuditGrant` | `grantRef="AG-002", scopes=[DECISION_OUTCOME, PLEDGE_RELEASE_EVENTS]`, rest as W13 | |

**Governed verifier changes**: (1) a seat creates `AddVerifierProposal` / `SuspendVerifierProposal`, pinned to the live `registryCid` and its `version`; (2) two seats confirm; (3) a seat executes. After an Add, the registrar runs `Config_Update` (adds the verifier to `directory`) and `Config_PublishVerifierStatus`. After a Suspend, the registrar runs `Mirror_Sync{configCid, accreditationCid=<suspended>, newSourceRef}` on that verifier's mirror. Executed proposals expose no result contract ids (DM `executeImpl` returns `()`), so read the new registry and accreditation from the operator's or verifier's ACS.

JSON Ledger API v2 encoding of these arguments follows standard Daml-LF JSON, **not exercised against a node in this task**: Party, Text and ContractId are strings; `Numeric 2` is a decimal string (`"100000.00"`); `Int` is a string or number; `Time` is ISO-8601 UTC; `Date` is `YYYY-MM-DD`; `Optional` is `null` or the value; nullary enums are strings (`"REQUIRE_ACTIVE_VERIFIER"`); `DA.Set.Set` is `{"map": [[elem, {}], …]}`; tuple results are `{"_1": …, "_2": …}`; `RelTime` is `{"microseconds": "1800000000"}`. Interface choices (`GovernableAction_ProposerCancel`) use the interface id as `templateId`.

## 8. Trust assumptions (documented, not hidden)

1. **Registrar.** It is the sole signatory of `AssetRegistry`, `IssuanceTicket`, `CollaraConfig` and `VerifierStatusMirror`, so its credential could mint a ticket outside `Registry_Reserve`, create a second registry, repin the governance party or policy, or publish a stale or duplicate mirror. Registrar + owner collusion (or credential theft) could mint a second control. Mitigation: the registrar credential is used only by the registry service, through `Registry_Reserve` + `Request_Accept` and the mirror sync. The registrar learns asset ids, declared equipment identity, evidence anchors, lock and release existence (lender, lock/case/agreement/attestation refs) and fetch metadata of verification. It never learns terms, valuation or decisions.
2. **Lender-asserted attestation facts.** The `ReviewSnapshot` is copied by the lender from its verifier-signed `AttestationDisclosure` and accepted by the borrower (agreement). The ledger cross-checks the evidence anchor against the registrar+owner-signed control. It does not re-check the attestation itself, because that would inform the verifier. **Revocation of an attestation is enforced off-ledger:** before `Control_Activate`, the API must confirm that the lender still holds an active disclosure of `snapshot.attestationRef`. Revocation and supersession withdraw that disclosure.
3. **Mirror latency.** Activation trusts the registrar's mirror, which may lag a governed suspension. Issuance always checks the real accreditation.
4. **Tier A governance.** The governance party is a local party; whoever holds its credential can sign registry contracts without quorum. Tier B (DM decentralized party) removes this.
5. **Mandates are off-ledger** (analyst vs approver). The ledger sees the organisation party and records `actorRef`.
6. **Ledger time.** Expiries use ledger time, with skew bounds. The UI computes `EXPIRED` from wall time.
7. **Single participant.** Not a privacy boundary between organisations; the participant operator sees all. The projection worker's read-all credential is a privileged operator credential.

## 9. Template ids for downstream code

Use package-name references. `#collara-contracts:` resolves to the uploaded `collara-contracts` package.

```text
#collara-contracts:Collara.Config:CollaraConfig
#collara-contracts:Collara.Config:VerifierStatusMirror
#collara-contracts:Collara.Registration:AssetRegistrationRequest
#collara-contracts:Collara.Registration:AssetRegistry
#collara-contracts:Collara.Registration:IssuanceTicket
#collara-contracts:Collara.Registration:AssetPassport
#collara-contracts:Collara.Control:AssetControl
#collara-contracts:Collara.Control:RetiredControl
#collara-contracts:Collara.Control:CollateralLock
#collara-contracts:Collara.Control:CollateralLockReleased
#collara-contracts:Collara.Evidence:EvidenceManifest
#collara-contracts:Collara.Evidence:DealerContribution
#collara-contracts:Collara.Evidence:PackageShareProposal
#collara-contracts:Collara.Evidence:PackageShare
#collara-contracts:Collara.Verification:VerificationRequest
#collara-contracts:Collara.Verification:VerificationAttestation
#collara-contracts:Collara.Verification:AttestationDisclosure
#collara-contracts:Collara.Verification:RevokedAttestation
#collara-contracts:Collara.Financing:CollateralAssessment
#collara-contracts:Collara.Financing:LenderDecisionNotice
#collara-contracts:Collara.Financing:FinancingProposal
#collara-contracts:Collara.Financing:FinancingAgreement
#collara-contracts:Collara.Financing:PledgeActivationAuthorization
#collara-contracts:Collara.Release:ReleaseRequest
#collara-contracts:Collara.Release:ReleaseDecision
#collara-contracts:Collara.Audit:AuditGrant
#collara-governance:Collara.Governance.Registry:VerifierRegistry
#collara-governance:Collara.Governance.Registry:VerifierAccreditation
#collara-governance:Collara.Governance.Proposals:BootstrapVerifierRegistryProposal
#collara-governance:Collara.Governance.Proposals:AddVerifierProposal
#collara-governance:Collara.Governance.Proposals:SuspendVerifierProposal
#governance-core-v1:Governance.Rules:GovernanceRules
#governance-core-v1:Governance.Confirmation:GovernanceConfirmation
#governance-core-v1:Governance.ExecutionResult:GovernanceExecutionResult
#governance-action-v1:Governance.Action:GovernableAction          (interface)
```

Fixture hashes (synthetic): documents are SHA-256 of `synthetic:<docRef>:<slug>:v<N>`, manifests are SHA-256 of `synthetic:PKG-001:manifest:v<N>` (lowercase hex). The identity commitment is computed on-ledger (`identityCommitmentOf`; the demo value is `d0d834d9…7658`). Constants: `Collara.Scripts.Scenario`.

## 10. Not verified here (next steps)

- Nothing has been run on a Canton node in this task: DAR upload, `dpm script` seeds, JSON encodings, parallel activation contention, `DUPLICATE_COMMAND` replay.
- Witness-level privacy (who receives which transaction tree) is untested. It needs the 3-participant sandbox and per-party `TRANSACTION_SHAPE_LEDGER_EFFECTS` update streams, in particular for `Control_Activate` (Lender B, verifier), `VR_IssueAttestation` (registrar, governance) and `Release_Reject` (registrar).
- Cross-participant input availability (the lender's participant must hold config, mirror and control) follows from observers. It is untested across participants.
- Tier B (DM decentralized party) is not attempted. The Collara proposal templates are the same in both tiers.
