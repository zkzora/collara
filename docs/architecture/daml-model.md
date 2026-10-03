# Collara Daml model

- Status: implemented and tested on the Daml Script IDE ledger (2026-10-02). Run on a Canton 3.5.19 sandbox with one participant, and witness-tested on five participants (2026-10-03, [`docs/privacy-verification.md`](../privacy-verification.md)); see §10. `collara-contracts` 0.2.0 (2026-10-03) adds the activation's ledger dependency on a live attestation disclosure (D15, §4.5, §8.2).
- Design source: `docs/_research/synthesis.md` §5 (this document records where the code deviates and why, §3).
- Code: `daml/collara/` (multi-package). Tests: `daml/collara/tests/`. Seeds: `daml/collara/scripts/`.

## 1. Packages, build and test

| Package (name, version 0.1.0 unless stated) | Path | Depends on | Uploaded to the ledger? |
|---|---|---|---|
| `collara-governance` | `daml/collara/governance` | data-dep `governance-action-v1` (vendored DM DAR) | Yes. Bundled inside the contracts DAR |
| `collara-contracts` (**0.2.0**) | `daml/collara/contracts` | data-dep `collara-governance` | **Yes**: `daml/collara/contracts/.daml/dist/collara-contracts-0.2.0.dar` (contains `collara-contracts`, `collara-governance` and `governance-action-v1`). 0.2.0 is not upgrade-compatible with 0.1.0 (D15): upload it to a fresh ledger only, never next to 0.1.0 (bootstrap uploads the highest version per package name) |
| `collara-scripts` | `daml/collara/scripts` | daml-script, both DM DARs, governance, contracts | No. It is used with `dpm script --dar daml/collara/scripts/.daml/dist/collara-scripts-0.1.0.dar` |
| `collara-tests` | `daml/collara/tests` | daml-script, everything above | Never (it defines a test-only attacker template) |

Also upload to the ledger: `daml/collara/vendor-dars/governance-core-v1-0.1.0.dar` (DM `GovernanceRules`; not a build dependency of the contracts).

- Every `daml.yaml` has `sdk-version: 3.5.12` and `--target=2.2`. governance and contracts also have `-Werror=template-interface-depends-on-daml-script`; tests have `-Wno-…` because they intentionally define one template next to daml-script. No contract keys anywhere.
- Vendored DM DARs (v1.12.0, `releases/v1/`, Apache-2.0, LICENSE + NOTICE copied). Their SHA-256 values in `vendor-dars/SHA256SUMS` match `research-dm.md` §1: `4fc7912d…e485` (governance-action-v1, package `48acd500…fd61`) and `b8d05903…9544` (governance-core-v1, package `361d1f28…d488`).
- Main package ids **of the current source** (any source change changes them; downstream code must use package-name references, never these ids):
  - `collara-governance` `16cb6e82174e020290c7eba779951d25309fd2a23009f09d1ef4154b9bac2d7b`
  - `collara-contracts` 0.2.0 `1c0e5e6235212312c10657e211accf55c459808b6401eefdb57a3800c340503c` (0.1.0 was `fce019fc…5fac4`)

Commands (from the repo root):

```bash
node daml/collara/check.mjs            # verify SHA256SUMS, dpm build --all, dpm test in tests/ and scripts/
# or by hand (Git Bash):
export PATH="$APPDATA/dpm/bin:$PATH"; export JDK_JAVA_OPTIONS=-Xmx1g
cd daml/collara && dpm.cmd build --all
(cd tests && dpm.cmd test) ; (cd scripts && dpm.cmd test)
```

`dpm test` must run inside a package directory; at the multi-package root it fails with `daml test: Not in package.` Result on 2026-10-03 (0.2.0): `tests: 68 ok, 0 failed`, `scripts: 4 ok, 0 failed` (the 4 in scripts are the seed scripts and two helpers run as scripts; 2026-10-02, 0.1.0: 60 and 4). The Daml Script service overflowed its stack on `Privacy.test_privacy_through_the_walkthrough` once the walkthrough read one more template per party; its checkpoint now reads each party's contracts once per stage (same assertions).

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
| D9 | `PackageShareProposal` lists **only the dealer's documents**. The owner shares its own documents with a separate owner-signed `PackageShare` | The dealer never sees metadata (doc refs, hashes) of the owner's documents. Permission matrix: dealer = "own contribution + granted". The verifier's evidence grants follow the same rule (§4.6, "Verification evidence grants") |
| D10 | `AssetRegistry` also keeps `issuedIdentityCommitments`. `AssetRegistrationRequest` enforces `identityCommitment == identityCommitmentOf equipment` (SHA-256 of `MANUFACTURER\|MODEL\|SERIAL`, trimmed and ASCII upper-cased, computed on-ledger) | On-ledger exact-match duplicate screening that cannot be fooled by a mismatched owner-supplied hash. It is not proof of global physical uniqueness. |
| D11 | `ReleaseRequest` `ensure requester ∈ {owner, lender}`; `Release_Authorize` requires status `REQUESTED` | Release request states per §1.5 #11. |
| D12 | Corrections: `VR_IssueAttestation{supersedes = Some Supersession}` consumes the old attestation (`Att_Supersede`) and withdraws its disclosures (`AttDisc_Withdraw`, verifier-controlled). `Att_Revoke` leaves a `RevokedAttestation` record | Issued records are never edited, and superseded copies stop being visible to recipients. |
| D13 | Package name `collara-governance` (synthesis: `collara-governance-v0`) | Task instruction. A breaking change ships as a new package name. |
| D14 | Terminal outcomes without a successor contract (verification decline/reject/cancel, registration decline/withdraw, proposal decline/withdraw, consent decline, share revoke, grant revoke, release withdraw) archive the contract | The projection reads them from the exercised event (choice name + argument) in `TRANSACTION_SHAPE_LEDGER_EFFECTS` updates. |
| D15 | `DisclosureValidity` (S owner; O recipient, verifier) is created with every `AttestationDisclosure` (`Att_DiscloseTo`) and archived by every choice that ends the disclosure; `Control_Activate` takes its `validityCid` and **fetches** it (§4.5 "Disclosure validity") | Closes the revocation race on the ledger (§8.2) without informing the verifier of the pledge. Not upgrade-compatible (a new `AttestationDisclosure` field and a new `Control_Activate` argument), so `collara-contracts` is **0.2.0** and is uploaded to a fresh ledger only. |

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
| `Control_Activate` (c) | **`lender` (argument)** | `lender, authorizationCid, validityCid, configCid, verifierStatusCid, lockRef` | consumes the control and the authorization; **fetches** the `DisclosureValidity` of the lender's disclosure (§4.5); creates `CollateralLock` with `controlVersion+1` | `Control is not shared with this lender`; `Authorization is for another lender or borrower` / `…another asset`; `Control version changed since authorization`; `Evidence package changed since authorization`; `Activation authorization expired`; `Attestation is outside its validity period`; archived validity marker, i.e. the disclosure was revoked, withdrawn or superseded (`CONTRACT_NOT_FOUND`); `Attestation disclosure is for another lender, owner, asset or case`; `Attestation disclosure does not match the reviewed attestation`; config/mirror of another registrar, namespace, verifier or governance; `Verifier suspended` (policy `REQUIRE_ACTIVE_VERIFIER`); archived control (`CONTRACT_NOT_FOUND`/contention on a node) |

`Control_Activate` deliberately **does not fetch** the verifier-signed attestation or disclosure or the governance-signed accreditation, which would inform the verifier or the governance members. It fetches only the lender+borrower authorization, the owner-signed `DisclosureValidity`, the registrar's config and the mirror.

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
| `Att_DiscloseTo` (nc) | owner | `recipient, purpose, disclosureCaseRef` | creates an owner-signed `DisclosureValidity` and a verifier-signed `AttestationDisclosure` copy for one recipient that points to it. Returns the disclosure cid |
| `Att_Revoke` (c) | verifier | `reason, disclosureCids` | withdraws the listed disclosures (and their validity markers); creates `RevokedAttestation` |
| `Att_Supersede` (c) | verifier | `disclosureCids, supersededByRef` (no actorRef) | withdraws disclosures (and their validity markers); archives (`SUPERSEDED`) |

**`AttestationDisclosure`**. S verifier, owner; O recipient. Fields: `verifier, owner, recipient, purpose, caseRef, attestationCid, attestation` (full copy), `disclosedAt`, `validityCid` (its `DisclosureValidity`). `AttDisc_Revoke` (c, owner) limits future visibility and archives `validityCid`. `AttDisc_Withdraw` (c, verifier) is used by supersede/revoke and archives `validityCid` too (the disclosure's signatories give it the owner's authority). **`RevokedAttestation`**: S verifier, O owner.

**`DisclosureValidity`**. S owner; O recipient, verifier. Fields: `owner, verifier, recipient, namespace, assetId, caseRef, attestationRef, evidence, validUntil` (copied from the attestation and the disclosure; no terms, no checks). No choices. Created by `Att_DiscloseTo` in the same transaction as the disclosure; archived by `AttDisc_Revoke`, `AttDisc_Withdraw` (so by `Att_Revoke` and `Att_Supersede`/supersession for every listed disclosure) or the owner's built-in `Archive`.

#### Disclosure validity: the activation's ledger dependency on a live disclosure (D15)

Goal: when the disclosure the lender relied on is revoked (owner `AttDisc_Revoke`), withdrawn (verifier `Att_Revoke`) or superseded (`VR_IssueAttestation{supersedes}` → `Att_Supersede`) and that commits before the activation, `Control_Activate` fails on the ledger, also for a submission that bypasses the API; an activation committed first is not undone. Constraint: the verifier must not take part in the activation. Under the ledger model a fetch informs the fetched contract's signatories and its acting parties (its stakeholders among the authorizers, here registrar, owner and lender); observers of a fetched contract are not informed (observed: privacy-verification F3). So `Control_Activate` cannot fetch the verifier-signed attestation or disclosure, but it can fetch an owner-signed contract.

| Decision | Reason |
|---|---|
| Signatory **owner** only | The owner already signs `AssetControl`, so the fetch adds no informee. A verifier signature would bring the verifier's participant into every activation. |
| Observer **recipient** | The lender's participant submits `Control_Activate` and must hold every input contract. The lender cannot create a marker (it does not sign). |
| Observer **verifier** | `Att_Revoke` and supersession are verifier submissions; its participant must hold the marker to archive it inside `AttDisc_Withdraw`, whose authority includes the owner's (the disclosure's signatories are verifier and owner). As an observer of a fetched contract the verifier is not an informee of the activation (five participants: its node receives nothing and assigns no offset at `Control_Activate`, as with 0.1.0). It learns nothing new: the marker repeats fields of the disclosure it signs. |
| `AttestationDisclosure.validityCid` links the pair | The disclosure-ending choices archive exactly that marker, so no path that ends the disclosure through its choices leaves the marker live. |
| `Control_Activate` takes `validityCid` and **fetches** it (non-consuming) | It checks recipient = lender, owner, namespace, asset and case ref = the authorization's, and attestation ref, verifier, evidence anchor and valid-until = the authorization's snapshot. Consuming it would make every later revocation of that disclosure fail (it would archive an archived contract) and tie the lock to the marker; the lock must be independent once created. |
| What the registrar learns | The marker's contract id, in the `Control_Activate` argument of its stream [OBSERVED, five participants]; no event of the marker. Its node validates the fetch, so the marker's fields (attestation ref, verifier, valid-until, anchor, refs) reach it inside the view, not through the Ledger API; the authorization it validates already carries the same snapshot [INFERRED]. |
| Contention | Only the activation (fetch) and the end of its disclosure (archive) use a marker. Revocation first → the activation is rejected [OBSERVED: deterministic and concurrent, five participants]. Activation first → the later revocation commits and the lock stays [OBSERVED sequentially, one participant]. Both in flight with the activation sequenced first was not observed; a fetch does not lock the contract for archival, so the revocation is expected to commit too [INFERRED]. |
| Replays | The activation still consumes the control and the authorization. A live marker can back a later activation only after a release, a new share and a new authorization (the disclosure is still live then). |

What the ledger still does not enforce (the API compensates where it can):

1. **The owner signs the marker alone**, so it can create one without a disclosure (for example after the verifier revoked) with matching fields; the ledger cannot tell it from one created by `Att_DiscloseTo`. The API takes the marker id only from the `validityCid` of the lender's **live, verifier-signed** disclosure, which the owner cannot forge. Using a minted marker therefore needs the lender to submit a marker that its disclosure does not link to, i.e. the owner and the lender acting together. A marker the owner cannot mint would need the lender's (or the verifier's) signature, which is not available when the owner discloses.
2. **`Att_Revoke` and supersession withdraw the disclosures the verifier lists.** An unlisted disclosure keeps its marker. The API lists every disclosure of the attestation from the verifier's ACS (the verifier signs all of them). On-ledger completeness would need an owner+verifier per-attestation disclosure index updated on every disclosure (not done).
3. **The built-in `Archive` of a disclosure** (verifier and owner together; no API path) leaves the marker live.
4. **An owner that archives its marker directly** blocks activation for that disclosure, and that disclosure's `AttDisc_Revoke`/`AttDisc_Withdraw` then fail. The API's supersession lists only disclosures whose marker is live, so a correction is not blocked; such a disclosure stays visible to its recipient but cannot back an activation.

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

**Verification evidence grants** (API, 2026-10-02; no template change). The assigned verifier receives exactly the documents the owner selects for one verification request, never the whole manifest:

| Field of the `PackageShare` | Value |
|---|---|
| `purpose` | `"VERIFICATION"` (lender shares use `"LENDER_REVIEW"`) |
| `recipient` | the request's `verifier` (from the governance-signed accreditation, never from the browser) |
| `shareRef` | `<requestRef>-G<manifestVersion>` (owner documents) or `<requestRef>-G<manifestVersion>-D<n>` (dealer n). It binds the grant to one request and one evidence version |
| `evidence` | the request's anchor (the manifest the documents come from) |
| `documents` | the selected **owner** documents with the exact `docVersion` and `sha256` of that manifest |
| `permission`, `expiresAt` | `VIEW_DOWNLOAD`; the request's `dueBy`, else 30 days (also when `dueBy` has passed at a resubmission) |
| `caseRef` | the request's case, or `""` for an asset-level request |

- **Same correlated sequence.** `POST /cases/:id/verification-requests` and `POST /assets/:id/verification-requests` run `manifest` → `request` (`Manifest_RequestVerification`) → `grant` (create the owner-signed `PackageShare`) under one parent command. `POST /verifications/:id/evidence-submissions` runs `manifest` → `submit` (`Manifest_SubmitToVerification`) → `grant` for the new version, then `revoke-<ref>` (`Share_Revoke`) / `withdraw-<ref>` (`ShareProposal_Withdraw`) for every other `VERIFICATION` grant of the package. The resubmission's selection is the request body's, else the documents granted for the previous version. Every selected document must be finalized (AVAILABLE with a server SHA-256, so it is an entry of the manifest the request points at), and at least one must be the owner's own (400 otherwise, before anything is submitted).
- **Dealer documents.** `validShare` forbids the owner from granting a dealer document alone. For a **case-linked** request the owner creates a `PackageShareProposal` (`-D<n>`, a consent request) for the dealer's selected documents, unless the dealer's `DealerContribution` of that exact version and hash records `verificationUseConsented = False` (a standing veto: the document is withheld). An asset-level request has no invited dealer, so dealer documents are withheld. The verifier receives a requested document only after the dealer's own `Consent_Grant` (API `POST /consent-requests/:id/decision`, one request at a time, or the bulk `POST /cases/:id/verification-consent`; invited dealer only). Changed 2026-10-03 (API only, no template change): before, the proposal also required a prior contribution with `verificationUseConsented = True`, which a freshly uploaded dealer document never had; the per-recipient `Consent_Grant` is the signature the ledger requires either way.
- **Dealer consent requests** (API + web, 2026-10-03; no template change). A consent request is a `PackageShareProposal` naming the dealer (lender review or verification); granted, it is the `PackageShare` the dealer co-signed. The read model reports them per case (`CaseFacts.consents`, latest contract per share reference): `PENDING` (active proposal), `DECLINED` (`Consent_Decline`), `CANCELLED` (`ShareProposal_Withdraw`, e.g. a resubmission), `GRANTED` (active share), `WITHDRAWN` (`Share_WithdrawConsent`), `REVOKED` (`Share_Revoke`), `EXPIRED` (past `expiresAt`). `GET /consent-requests` shows them to the dealer (its own documents only) and to the owner (status per dealer document); everyone else gets an empty list or the 404-shaped answer. `POST /consent-requests/:id/decision` (`GRANT`: `DealerContribution` of each listed document when missing, then `Consent_Grant`; `DECLINE`: `Consent_Decline` with a reason code, never free text) and `POST /consent-requests/:id/withdraw` (`Share_WithdrawConsent`) act for the dealer only, reading the request fresh from the dealer's ledger view. A former recipient whose grant ended (withdrawn, revoked or expired) gets 409 with the approved revocation copy at download, also when the document is no longer listed for it.
- **Download (API, at every request, on the verifier's fresh ACS).** An active `PackageShare` with purpose `VERIFICATION`, recipient = the caller's party, not expired, covering the exact version (and the stored file's SHA-256 must equal the grant's), the caller holds the `VERIFIER` role, and an **open** `VerificationRequest` names the caller as verifier, has the grant's owner, is the request the `shareRef` names, and has the grant's anchor. Access therefore ends at attestation, rejection, decline or cancellation, at expiry and at a resubmission (new anchor; the old grant is also revoked). Another verifier, the dealer (owner documents), Lender B and the auditor get the 404-shaped answer; the verifier gets 403 for a visible document's ungranted version.
- **Attestation.** `VR_IssueAttestation` copies the request's anchor (`evidence`). Before submitting it the API requires a live grant of that request for that anchor. The read model reports the attestation's supporting versions from the grants of its request and anchor (owner and verifier views; lender copies keep the package entries of the anchor). The attestation contract does **not** list document versions: disclosing the reviewed subset to lenders on-ledger would need a new `VerificationAttestation` field (not done).
- **Read model.** Verification grants are not case shares (`case.shares` lists lender shares only). The verifier's `VerificationFacts.documentRefs`/`documentVersions` are its live grants of that request for the request's current anchor (empty once declined or cancelled), and its document rows are limited to those versions. Requests seeded without a grant (the main fixture's VR-001) keep the owner-only manifest listing.

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

Three kinds of evidence back these rows:

- **[TESTED]**: active-contract visibility per party on the IDE ledger (`Collara.Tests.Privacy`).
- **[OBSERVED]**: per-party and per-participant `TRANSACTION_SHAPE_LEDGER_EFFECTS` update streams on a Canton 3.5.19 sandbox with five participants (registrar, governance and seats; borrower; Lender A; Lender B; verifier, dealer and auditor), 2026-10-03. Details in [`docs/privacy-verification.md`](../privacy-verification.md).
- **[INFERRED]**: Daml ledger-model informee rules, not observed. Under those rules, create informs stakeholders; a consuming exercise informs stakeholders + actors; a non-consuming exercise or a fetch informs signatories + actors; consequences go to the informees of the parent.

"Sees" means events in the party's Ledger API stream. A fetch produces no event: a party informed only through a fetch sees nothing in its stream, but its participant takes part in the transaction (§5 notes).

| Transaction (submitter) | Informed parties | What they learn |
|---|---|---|
| `Registry_Reserve` (registrar, top-level) | registrar; the owner only through the created `IssuanceTicket` | registry set: registrar only [TESTED] [OBSERVED: the owner's participant receives only the ticket] |
| `Request_Accept` (registrar) | owner, registrar | request, consumed ticket, control v1 and passport v1: both parties see all four, including the owner-only passport, which the registrar witnesses as a consequence of its own choice [OBSERVED] |
| Manifest create/anchor/new version (owner) | owner; registrar via `Control_AnchorEvidence` | owner: entries. Registrar: the `Control_AnchorEvidence` exercise and the new control, i.e. the anchor only (package ref, version, hash), never the `Manifest_*` root or entries [OBSERVED] |
| `VR_*` choices (verifier/owner) | owner, verifier (events); registrar (config fetch) and governance (accreditation fetch) as fetch informees only | request and attestation contents: owner and verifier only [OBSERVED]. Registrar and governance: no event in any stream; their participant takes part in the transaction (it assigns ledger offsets that no Ledger API user can read) [OBSERVED, `VR_AcceptAssignment` and `VR_IssueAttestation`]. Lender A and Lender B, observers of the config, are not informed [OBSERVED] |
| `Att_DiscloseTo` (owner) | owner, verifier, recipient | the attestation copy and its `DisclosureValidity` (same three stakeholders, fields repeat the copy). The verifier sees the exercise (recipient, purpose, case ref); the recipient only the created disclosure and marker [OBSERVED, 0.2.0] |
| `AttDisc_Revoke` (owner) | owner, verifier, recipient | that the disclosure was revoked, and the `Archive` of its marker [OBSERVED in the race worlds, 0.2.0] |
| `Att_Revoke` (verifier), listing the recipient's disclosure | owner, verifier (whole tree); recipient (`AttDisc_Withdraw` and the marker's `Archive` only) | revocation of the attestation; the recipient learns only that its copy was withdrawn. Submitted on the verifier's participant, which archives the owner-signed marker with the owner's authority from the disclosure [OBSERVED, 0.2.0 race world]. Supersession withdraws the same way [TESTED; not run on five participants] |
| Share proposal / consent / owner share | owner, dealer (its own documents only [TESTED]), recipient | doc refs and hashes in scope. Dealer consent reaches the recipient only as the created `PackageShare` [OBSERVED] |
| Verification grant (owner `PackageShare`, purpose `VERIFICATION`) | owner, assigned verifier; for a dealer document also that dealer (proposal and `Consent_Grant`) | refs, versions and hashes of the selected documents only. Never terms; the lender, Lender B and the auditor are not informed [INFERRED; not in the 5-participant run] |
| `Control_ShareWithLender` (owner) | owner, registrar (exercise and new control); lender (new control only) | minimal control fields [OBSERVED] |
| Assessment / notice / proposal / accept / authorize | assessment: lender only; notice, proposal, agreement, authorization: lender + borrower | terms, valuation and decisions never reach the verifier, dealer, registrar, Lender B, auditor or governance [TESTED at every step] [OBSERVED: no principal, term text or legal ref in any of their streams, nor on the participants that host only them]. The valuation stays with the lender (not the borrower) [OBSERVED] |
| `Control_Activate` (lender) | registrar, owner, lender | exercise argument (lender, authorization/validity/config/mirror cids, lockRef), **the `Archive` of the `PledgeActivationAuthorization`** (template, contract id, acting lender + borrower, empty argument, no terms), and the created lock (refs, no terms). The registrar learns "asset X locked to lender Y for case Z" [OBSERVED]. The fetch of the owner-signed `DisclosureValidity` produces no event. Lender B and the verifier, though observers of config/mirror (and the verifier of the marker), are not informed and their participants take no part [OBSERVED, 0.1.0 and 0.2.0: same nodes, events and ledger-end deltas] |
| `Release_Reject` / request / information round | owner, lender | decision. The registrar is not informed [TESTED] [OBSERVED for request and reject: its participant takes no part] |
| `Release_Authorize` (lender) | owner, lender (whole tree); registrar (lock signatory) the `Lock_Release` subtree only | owner, lender: root, `Lock_Release`, control v5, released record, `ReleaseDecision`. Registrar: `Lock_Release`, control v5 and the released record; not the root or the decision [OBSERVED] |
| Governance propose/confirm/execute | seats that act, governance party (+ operator for the registry and accreditation, verifier for its accreditation) | verifier registry changes. No case data. A seat that does not act sees nothing (seats read through `readAs` the governance party) [OBSERVED, bootstrap only] |
| `CollaraConfig` / `VerifierStatusMirror` (registrar) | registrar and every `directory` member (verifier, Lender A, Lender B) | directory party list, governance party, suspension policy, verifier status. Lender B receives exactly these two contracts and nothing about CL-001 [OBSERVED] |
| `AuditGrant` | grantor, auditor | grant scope. The auditor reads nothing before a grant and only grants afterwards [TESTED] [OBSERVED: its stream holds only the two `AuditGrant` creates; exports are off-ledger] |

Notes from the 5-participant run:

- **Mismatch with the earlier text:** the `Control_Activate` row did not list the registrar's view of the authorization's `Archive`. It carries no terms (refs only), but it is an event of `PledgeActivationAuthorization` in the registrar's stream.
- **Operator view.** A participant user with `CanReadAsAnyParty` sees, per event, every informee's party id, including parties hosted on other participants (a per-party reader sees only its own party). For a created contract these are the stakeholders already named in the payload.
- **Participation without events.** Per transaction, a participant hosting a signatory or actor assigned 3 ledger offsets and one hosting only observers 2; only one of them, if any, is readable. A participant whose parties are not informees assigned none.

A single-participant sandbox is not a privacy boundary: its operator sees everything. The 5-participant run is one operator's five nodes in one JVM, not independent infrastructure (§10).

## 6. Invariants: enforcement and proof

| Invariant (MP §6 / S §11.7) | Enforcement | Tests (`daml/collara/tests/daml/Collara/Tests/…`) |
|---|---|---|
| One active pledge per asset (#1) | exactly one token per asset (`AssetControl` xor `CollateralLock`), every transition consuming; unique issuance via the registrar-only `AssetRegistry` | `Pledge.test_second_activation_fails`, `test_competing_lenders_lender_a_first`, `test_competing_lenders_lender_b_first`; `Registration.test_duplicate_asset_id_rejected`, `test_duplicate_identity_rejected`, `test_identity_commitment_computed_on_ledger`, `test_issuance_ticket_single_use_and_bound` |
| Activation consumes the available control atomically (#2) | `Control_Activate` is consuming. On a node, contention gives `LOCAL_VERDICT_LOCKED_CONTRACTS` then `CONTRACT_NOT_FOUND` (research-canton §4) | Daml Script: the second activation finds the control archived. **Live parallel contention is not tested here** (needs a sandbox) |
| No replacement control (#3) | `AssetControl` needs registrar + owner; tickets and the registry are registrar-only; corrections consume the control | `Registration.test_no_replacement_control`; `Pledge.test_control_choices_impossible_while_locked` |
| Exact-version acceptance; evidence changes handled (#5) | `Proposal_Accept(expectedProposalRef, expectedVersion)`; revisions consume; activation compares the authorization's version and evidence with the control | `Financing.test_accept_wrong_version_fails`, `test_accept_stale_version_fails`, `test_expired_proposal_cannot_be_accepted`, `test_proposal_requires_current_eligibility`; `Pledge.test_activation_after_manifest_bump_fails`, `test_revoked_view_invalidates_authorization`, `test_authorization_for_another_asset_fails` |
| Only an active assigned verifier issues; expiry and suspension (#7, #8) | `VR_*` controller is the request's verifier; the accreditation is checked against `CollaraConfig.governanceParty`, status, expiry and scope at commit; activation checks `attestationValidUntil` and the mirror per policy | `Verification.test_unassigned_verifier_cannot_attest`, `test_suspended_verifier_cannot_attest`, `test_forged_accreditation_rejected`, `test_expired_accreditation_rejected`, `test_out_of_scope_verifier_rejected`, `test_owner_cannot_forge_attestation`, `test_attestation_requires_open_review`, `test_supersede_and_revoke`, `test_suspension_blocks_new_activation_by_policy`; `Pledge.test_activation_with_expired_attestation_fails`, `test_activation_with_expired_authorization_fails` |
| Activation needs the reviewed attestation to be still disclosed to the lender; a later revocation never undoes a lock (revocation race, §8.2) | `Control_Activate` fetches the owner-signed `DisclosureValidity` of the lender's disclosure and matches it with the authorization (lender, owner, asset, case, attestation ref, verifier, anchor, valid-until); `AttDisc_Revoke`, `AttDisc_Withdraw` (so `Att_Revoke` and supersession) archive it; the lock does not reference it | `Revocation.test_owner_revocation_before_activation_fails`, `test_verifier_revocation_before_activation_fails`, `test_supersession_before_activation_fails`, `test_race_interleaving_now_fails` (also: the lender cannot mint a marker; another lender's marker is invisible / rejected), `test_activation_then_owner_revocation_keeps_lock`, `test_activation_then_supersession_keeps_lock`; residuals pinned by `test_residual_owner_minted_marker_is_accepted` and `test_owner_archiving_its_marker_blocks_activation`; `Verification.test_supersede_and_revoke` (marker archived with the disclosure) |
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

The seed follows this table exactly and therefore creates **no** verification grant for VR-001 (it is attested in the fixture). The API adds the grant after M7 and after M11 (§4.6, "Verification evidence grants").

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
| M17 | owner | `Att_DiscloseTo` on attestationCid | `recipient=DemoLenderA, purpose="LENDER_REVIEW", disclosureCaseRef="CL-001", actorRef` | disclosureCid (the same transaction creates its `DisclosureValidity`, `disclosure.validityCid`). Review `SUBMITTED` |
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
| W8 | lenderA (approver) | `Control_Activate` on controlCid | `lender=DemoLenderA, authorizationCid, validityCid` (the `validityCid` of Lender A's live disclosure of ATT-001, read from its own ACS)`, configCid, verifierStatusCid=mirrorCid, lockRef="PL-001", actorRef` | lockCid (**v4**, `ACTIVE`) |
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
2. **Lender-asserted attestation facts; revocation enforced through the disclosure's validity marker.** The `ReviewSnapshot` is copied by the lender from its verifier-signed `AttestationDisclosure` and accepted by the borrower (agreement). The ledger cross-checks the evidence anchor against the registrar+owner-signed control. It does not fetch the attestation or the disclosure, because that would inform the verifier. **Revocation race: CLOSED on the ledger (0.2.0).** `Control_Activate` fetches the owner-signed `DisclosureValidity` that `Att_DiscloseTo` created with the lender's disclosure and that `AttDisc_Revoke`, `AttDisc_Withdraw`, `Att_Revoke` and supersession archive (§4.5). Evidence: Daml Script `Collara.Tests.Revocation` (owner revocation, verifier revocation, supersession and the old race interleaving each fail; activation followed by revocation or supersession keeps the lock); LocalNet one participant, `pledge.it.test.ts` (a direct ledger submission with a revoked disclosure's marker and the deterministic race are both `REJECTED` with `CONTRACT_NOT_FOUND` naming the marker; an activation committed first keeps its lock after the owner's revocation); five participants, two runs on 2026-10-03 (owner and verifier revocations committed between the API's precheck and the submission: activation rejected, 0 locks; the unsynchronised pair: revocation sequenced first and the activation rejected; the verifier's node is still not informed of the activation). Before 0.2.0 the same interleaving committed the activation (lender's participant: revocation at offset 202, activation at 204). The API keeps its precheck as a fast-fail and passes only the `validityCid` of the lender's live disclosure. **Residuals** (§4.5): the owner can mint a marker that no disclosure links to, so a lender that submits such a marker (owner + lender together) bypasses a verifier's revocation; `Att_Revoke` and supersession withdraw only the disclosures the verifier lists (the API lists all); a joint verifier+owner `Archive` of a disclosure leaves its marker; an owner that archives its own marker blocks that disclosure's revocation. See [`docs/privacy-verification.md`](../privacy-verification.md#revocation-race-daml-modelmd-82).
3. **Mirror latency.** Activation trusts the registrar's mirror, which may lag a governed suspension. Issuance always checks the real accreditation.
4. **Tier A governance.** The governance party is a local party; whoever holds its credential can sign registry contracts without quorum. Tier B (DM decentralized party) removes this.
5. **Mandates are off-ledger** (analyst vs approver). The ledger sees the organisation party and records `actorRef`.
6. **Ledger time.** Expiries use ledger time, with skew bounds. The UI computes `EXPIRED` from wall time.
7. **Single participant.** Not a privacy boundary between organisations; the participant operator sees all. The projection worker's read-all credential is a privileged operator credential. With one participant per organisation (the 5-participant run), each node stores only what its parties witness, but its operator still sees the informee party ids of those events and that (and when) transactions it confirms happened, including fetch-only ones (§5 notes).

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
#collara-contracts:Collara.Verification:DisclosureValidity
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

## 10. Verified on a node since, and still not verified

Run since this document was first written (Canton 3.5.19 `dpm sandbox`, **one participant**; details in [`docs/verification.md`](../verification.md)): DAR upload through `POST /v2/dars`; the §7 bootstrap and main sequence submitted through the API's workflow runner (seed, 24 steps, idempotent replay); JSON encodings of these arguments; parallel `Control_Activate` contention (5 rounds, exactly one lock each, the loser rejected by the ledger with `CONTRACT_NOT_FOUND`); `DUPLICATE_COMMAND` replay returning the original command; release request and rejection leaving the lock active; stale proposal version rejected on the ledger; Tier A governance 2-of-3 through the API and on the ledger.

Run on five participants (2026-10-03, [`docs/privacy-verification.md`](../privacy-verification.md)): the §7 bootstrap, main fixture and walkthrough, each command through the submitting organisation's own participant, with per-party and per-participant `TRANSACTION_SHAPE_LEDGER_EFFECTS` streams; informees of `Control_Activate`, `VR_AcceptAssignment`, `VR_IssueAttestation`, `Release_Reject`, `Release_Authorize`, `Proposal_Accept` and `Agreement_AuthorizeActivation` (§5); cross-participant input availability (every input contract was on the submitter's participant through observers; no explicit disclosure needed); the revocation race (§8.2): with 0.1.0 it committed the activation, with 0.2.0 (two re-runs) the owner's and the verifier's revocations made the ledger reject it, and the marker added no informee to any walkthrough transaction.

Run with 0.2.0 on one participant (2026-10-03): the LocalNet IT suite with in-memory evidence storage (the disk was below SeaweedFS's write threshold): 73 tests, 68 passed; the 5 failures are downloads through `memory://` presigned links that `fetch` cannot open (`cases`, `financing`, two in `verifier-evidence`) plus one `verifier-evidence` test that depends on the aborted one. `pledge.it.test.ts` (4) and `concurrency.it.test.ts` (6) were re-run and passed.

Still not verified:

- Witness-level privacy of the paths the 5-participant run did not take: share revocation, consent withdrawal, verification grants created by the API, supersession and revocation of attestations, governed add/suspend verifier and `Mirror_Sync`, declines and withdrawals, audit grant revocation.
- Independent operators: the five participants, the sequencer and the mediator ran in one JVM controlled by one person; what the sequencer and mediator learn was not examined, nor the participants' internal stores.
- Tier B (DM decentralized party) is exercised by `scripts/tierb/` on a separate local topology only (`docs/governance-tier-b.md`); the API does not use it. The Collara proposal templates are the same in both tiers. The Tier B scripts were not re-run with `collara-contracts` 0.2.0 (`scripts/tierb/onboard.mjs` now points at the 0.2.0 DAR).
- `collara-contracts` 0.2.0 next to a vetted 0.1.0 (not upgrade-compatible; only fresh ledgers were used).
