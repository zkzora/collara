# Research: BitSafe / DLC-link Decentralization Manager (DecMan) for Collara verifier-registry governance

Author: research subagent, 2026-10-01. Scope: implementing Collara's 2-of-3 governed **Add Verifier** and **Suspend Verifier** actions on top of the DLC-link Decentralization Manager ("DecMan", "DM").

Legend: **[READ]** = read directly in the source/doc cited. **[INFERRED]** = my reasoning or general Canton/Daml knowledge, not verified against this repo or a running node. **[VERIFY]** = must be checked on a running node before relying on it.

---

## 0. TL;DR

1. **The governance engine is plain Daml and fully reusable.** It is `GovernanceRules` (package `governance-core-v1`) plus the `GovernableAction` interface (package `governance-action-v1`). Collara plugs in by writing templates that implement `GovernableAction`. Collara gets 2-of-3 quorum, duplicate-confirmer rejection, member-only voting, confirmation expiry and an on-ledger audit record (`GovernanceExecutionResult`) without changing any DM code. [READ: `daml/governance-core/daml/Governance/Rules.daml`, `docs/CUSTOM_DAML_TEMPLATES.md`]
2. **DecMan itself (the Rust app) is the topology and ceremony layer.** It creates a *decentralized party* jointly owned by N participants (DNS + PartyToParticipant topology), distributes DARs, creates the `GovernanceRules` contract with threshold signatures from the decentralized party, and offers a UI/REST surface for confirm/execute. It needs **one Canton participant per member** (≥3 for the `/contracts` workflow), with **Admin API** access to each. [READ: `docs/ARCHITECTURE.md` §Workflows, §Participant Minimums]
3. **Custom actions cannot be proposed through `POST /governance/propose`** without Rust changes. Collara must create its proposal contracts itself through the Ledger API ("Path B"). Confirm and execute then work through DM's generic `core_domain` endpoints, or directly through the Ledger API, because they are the same Daml choices. [READ: CUSTOM_DAML_TEMPLATES.md lines 13-21, 448-460]
4. **Proposals have no expiry in the DM engine.** Only *confirmations* expire. To show that "stale proposals cannot execute", Collara's `executeImpl` must enforce staleness itself, for example by pinning the registry contract id and version and checking a proposal deadline. Recipe in §7. [READ: Rules.daml; INFERRED design]
5. **Feasibility on this machine (Windows, no Docker):**
   - DM's own dev and test path (Splice LocalNet 0.6.12 in Docker) is **blocked**.
   - A **real 2-of-3 DM demo is feasible without Docker** if run inside **WSL2 Ubuntu**:
     - Canton open-source **3.5.8** (Java 17+) runs as one process with 1 sequencer, 1 mediator and 3 participants, using unsafe-HMAC auth.
     - 3 × `dec-party-manager` v1.12.0 run with `--insecure`. The Linux binary can be pulled from the public ECR image with plain `curl` (no Docker), or built from source in WSL.
   - DM's maintainers have **not** tested DM against plain Canton OSS (they test against Splice LocalNet and DevNet), so treat that path as [VERIFY]. §10 lists the exact blockers.
   - The cheapest fallback is the DM governance DARs on a single-participant sandbox, with the governance party as an ordinary local party. Quorum is enforced on-ledger, but no decentralized party and no DecMan. It must be labelled "partial / not the DM topology".

---

## 1. Provenance and pinning

| Item | Value | Source |
|---|---|---|
| Repo | https://github.com/DLC-link/decentralization-manager | |
| Description | "A web application for managing decentralized parties in Canton blockchain networks." License Apache-2.0, © 2026 BitSafe Finance (`NOTICE`) | GitHub API, NOTICE [READ] |
| HEAD (`main`) at research time | `63a7898aa7b7ac18103e12759e53c4ec1f2bd220`. Committed 2026-10-01T15:43:09Z, author "Shronk", message "Label wallet signatures by the party key's spec (#507)" | `git ls-remote`, GitHub API [READ] |
| Latest tag / release | **v1.12.0**: tag object `45d1b1db…`, commit **`4d650edbbf851852311a4921af8f5df608450a6b`**, published 2026-09-22T16:11:25Z. Earlier: v1.11.0 (2026-09-18), v1.10.0 (2026-09-17), v1.9.0 (2026-09-16), v1.8.0 (2026-09-10) | GitHub releases API [READ] |
| HEAD vs v1.12.0 | 20 commits ahead. Among governance-relevant files, only `crates/decman/src/server/handlers/governance.rs` changed (the confirmations feed now passes the `GovernanceRules` member set into the domain-action count; `propose` returns 404 instead of 401 when credentials are missing) and `docs/CUSTOM_DAML_TEMPLATES.md` changed (new "Require business sign-offs at execute time" section). **No changes under `daml/` or `releases/`.** | GitHub compare API [READ] |
| Crate version | `crates/decman/Cargo.toml` `version = "1.12.0"`, binary `dec-party-manager` | [READ] |
| Container image | `public.ecr.aws/dlc-link/decentralization-manager:v1.12.0`. Index digest `sha256:54ec6ce6783d7bc32f765f40e541b9584d32dd737a12434c8f426df381d7039d`. linux/amd64 manifest `sha256:563f1ae14b0d779270813dffee4bcc23c8a899ef4546a75a131d4047629eb030`. Last layer `sha256:4f06a12e7e9663f30b8472fcdf77a504064e9606b777e6502c186d23bc024e6b` (19.7 MB gz) holds `/usr/local/bin/dec-party-manager`. Tags also exist for `-nonroot`, v1.10.0 and v1.11.0. **amd64 only.** | public ECR registry API (anonymous) [READ] |
| GitHub release assets | **None.** Binaries ship only inside the container image. | GitHub API [READ] |
| Audit | Quantstamp, report dated 2026-05-22, commit `c3f578b` (`docs/audits/QS-Bitsafe-dec-manager-final-audit-report.pdf`). Acknowledged-but-unfixed items: DLC-5 (1-of-1 rules allowed), S3 (`executeImpl` cannot return artefacts), S4 (no generic archive action) | `docs/audit-acknowledgements.md` [READ] |

**Local copy:** `C:\Collara\.vendor\decentralization-manager\`. It is *not* a git checkout. `git clone` failed because the sandbox denied writing `.git/config` ("could not write config file … Permission denied"). I extracted the codeload tarball of commit `63a7898aa7b7ac18103e12759e53c4ec1f2bd220` instead, so there is no `.git` directory. Re-vendor with `git clone` outside the sandbox if a real checkout is wanted.

**Recommended pin for Collara:** DM **v1.12.0** (commit `4d650ed…`, image digest above). Use the Daml DARs from `releases/v1/`. They are byte-identical at v1.12.0 and HEAD, and CI enforces that they match a fresh `dpm build` of the source.

Key DAR identities (from each DAR's `META-INF/MANIFEST.MF` [READ]; sha256 computed locally):

| DAR (`releases/v1/`) | Main package id | SDK | sha256 |
|---|---|---|---|
| `governance-action-v1-0.1.0.dar` | `48acd500fc0bc9e4f00d52270122a104a68157f6d5561328f059f5eb6a63fd61` | 3.4.11 | `4fc7912df4a0aeea3cfcc6ba07c880192a5fa88f7c75ed04b922602461b1e485` |
| `governance-core-v1-0.1.0.dar` | `361d1f2857f833f8094caf86ecdd5daaa3e2075c22dafe2bf18cde63ee98d488`. Depends on `governance-action-v1` `48acd500…` and `splice-util-0.1.4` `b7356fbb…` (bundled in the DAR; no running Splice needed) | 3.4.11 | `b8d05903e63288d4114632f41386491cea215e177183514ea032fe35d24a9544` |

Every other `governance-*-v1` DAR in `releases/v1` depends on the same `governance-action-v1` id `48acd500…`. That id is the interface identity Collara must implement against.

---

## 2. What DecMan is

### 2.1 Components and stack [READ: README.md, ARCHITECTURE.md, Cargo.toml]

- **Language: Rust** (edition 2024, Rust ≥ 1.85). Cargo workspace crates:
  - `decman`: server; binary `dec-party-manager`.
  - `common`: wire DTOs.
  - `decman-lib`: Daml command builders and proposal catalogue.
  - `decman-cli`: ratatui TUI.
  - `decman-wallet`: client for the tenant API.
- HTTP server is **actix-web**. It embeds a **React 19 + MUI 9 + Vite** SPA (`crates/decman/frontend`, Node `^20.19.0 || >=22.12.0`, keycloak-js, @auth0/auth0-react). `build.rs` runs `npm install` and `npm run build`. `DECMAN_SKIP_FRONTEND=1` skips the frontend build.
- **State**: SQLite at `{DECPM_DIR}/data/decpm.db` (sqlx; peers, party credentials, workflow runs, audit log). Optional `DECPM_DB_ENCRYPTION_KEY`. Noise key at `data/noise.key`.
- **Canton access: native gRPC (tonic)** to both the **Admin API** and the **Ledger API v2**. Protobuf bindings come from `canton-proto-rs` in https://github.com/DLC-link/canton-lib at rev `651ea5221b4794f55bd152e9f3e762a92af69afd`.
  - The repo is public. Cargo fetches it over **https** (`Cargo.toml` `[workspace.dependencies]`).
  - The SSH-key requirement in README applies only to the Docker build (`CARGO_NET_GIT_FETCH_WITH_CLI=true` + `--mount=type=ssh`).
  - `.github/actions/setup-build-env/action.yml` says "Every git dependency is public today".
- Admin API services used: `TopologyManagerReadService`, `TopologyManagerWriteService`, `VaultService`, `IdentityInitializationService`, `SynchronizerConnectivityService`, `PackageService`, `PartyManagementService` (v30, offline party replication).
- Ledger API services used: `CommandService`, `StateService`, `UserManagementService`, `PartyManagementService`, `InteractiveSubmissionService`, `UpdateService`, `EventQueryService`. [READ ARCHITECTURE.md §Canton gRPC Client]
- **Peer-to-peer: Noise protocol.** Pattern `NN_PSK2`. PSK comes from secp256k1 ECDH. Transport is HTTP-over-Noise (`hyper-noise`). Heartbeat every 5 s. Peers are allow-listed through `POST /network-config`. Ports: HTTP 8080 and Noise 9000 by default; metrics on 9464.
- **Coordinator/peer model.** Whoever starts a workflow coordinates it. Peers get an *invitation*, an operator accepts it in the UI (`POST /invitations/accept`), and the peer then signs topology proposals or prepared transactions after validating them locally. [READ ARCHITECTURE.md §Coordinator / Peer Trust Model]
- **Auth.**
  - Admin UI is gated by **Keycloak or Auth0**: Authorization Code + PKCE with a public SPA client. Optional `DECPM_ADMIN_ROLE`.
  - Outbound Canton tokens are fetched **per decentralized party** through the OAuth `client_credentials` grant: Keycloak confidential client or Auth0 M2M, stored through `PUT /party-config`.
  - `--insecure` / `DECPM_INSECURE=true`: accepts any inbound token, admin by default (`auth/validators/mock.rs`). It mints an **HS256** Canton token with secret `DECPM_CANTON_HMAC_SECRET` (default `unsafe`), aud `DECPM_CANTON_HMAC_AUDIENCE` (default `https://canton.network.global`) and sub `DECPM_CANTON_HMAC_SUBJECT` (default `ledger-api-user`) (`auth/mock.rs`).
  - Swagger UI at `/swagger-ui/` is mounted **only in insecure mode**.
- Workflows (state machines, persisted, resumable):
  - Onboarding (create decentralized party; min 2 participants)
  - Kick
  - Add Party
  - Change Threshold
  - DARs (distribute; min 2)
  - **Contracts** (DAR upload + creation of contracts signed by the decentralized party through `InteractiveSubmissionService`; **min 3 participants**)
  - External-party tenant API (`/v0/tenant/*`)
- Also: CIP-104 reward automation loop, token-standard / Canton Coin helpers, DA Utility (registrar) onboarding. Only the token-standard / Canton Coin flows use Splice/DSO endpoints; `dso_url()` in `config.rs` covers devnet/testnet/mainnet only. **None of that is needed for core governance.** [READ config.rs:401-406; INFERRED that the reward loop only logs errors on a non-Splice ledger — VERIFY]

### 2.2 Party / topology model [READ ARCHITECTURE.md §Core Concepts; `workflow/onboarding/steps/proposals/create.rs` lines 143-240]

- **Decentralized party** id = `<prefix>::<decentralized-namespace>`. The namespace is `"1220" + hex(SHA-256(purpose 37 ‖ sorted owner namespaces))` and never changes.
- **DecentralizedNamespaceDefinition (DNS)**: owners are the per-participant namespace keys that DM generates in each participant's vault during onboarding. Its `threshold` is the topology signing threshold.
- **PartyToParticipant (P2P)**:
  - Each member participant hosts the decentralized party with **`ParticipantPermission::Confirmation`** (not Submission).
  - The mapping has a `threshold`, the **participant confirmation threshold**.
  - It embeds **`party_signing_keys` with their own threshold**. These are Daml signing keys, one per participant (Canton 3.4+). DM uses them to sign *interactive submissions that act as the decentralized party*; the `/contracts` workflow uses them, for example, to create `GovernanceRules`.
- At onboarding the **same `threshold` value** is used for the DNS threshold, the P2P threshold and the signing-key threshold. The default is `ceil(n/2)`, so 2 for n=3. It can be set in `POST /onboarding {threshold}` and changed later with the change-threshold workflow.
- **Governance members are separate, ordinary local parties**, one per member participant (e.g. `gov-member-p1`). They submit governance commands with **`act_as = member`, `read_as = decentralized party`** (`decman-lib/src/framework/commands.rs::commands_envelope`). `GovernanceRules` deliberately does not list members as observers: "visibility as a topology concern" (Rules.daml lines 161-163).
- **Three distinct thresholds Collara must document separately** (brief §8):
  1. **Application governance threshold**: `GovernanceRules.threshold`, Daml. 2-of-3 member *parties* must confirm.
  2. **Decentralized-namespace (topology) threshold**: how many owner participants must sign topology changes (DNS/P2P updates, kick, add-party, threshold change).
  3. **Participant confirmation threshold and party-signing-key threshold** (P2P mapping):
     - How many hosting participants must confirm any transaction in which the decentralized party is a confirming party. This applies to every governance confirm/execute [INFERRED from Canton semantics], so *at least `threshold` member participants must be online* for governance transactions to commit.
     - How many Daml signing keys must sign a submission that acts *as* the decentralized party.

---

## 3. Daml governance engine (exact code)

Packages [READ `daml/*/daml.yaml`]: every package uses `sdk-version: 3.4.11` and `build-options: --target=2.2`, plus `--ghc-option=-Wunused-binds` and `--ghc-option=-Wunused-matches`.
- `governance-action-v1` (version 0.1.0): interface only, no data-dependencies.
- `governance-core-v1` (version 0.1.0): data-dependencies `../governance-action-v1/.daml/dist/governance-action-v1-0.1.0.dar` and `../dars/splice-util-0.1.4.dar` (for `Splice.Util.require`).

### 3.1 `GovernableAction` interface: `daml/governance-action-v1/daml/Governance/Action.daml` (54 lines) [READ, verbatim minus comments]

```daml
module Governance.Action where

data GovernableActionView = GovernableActionView
  with
    governanceParty : Party   -- governance party whose authority is required to execute
    proposer : Party          -- must be a member or additional proposer of the targeted GovernanceRules
    actionLabel : Text        -- e.g. "PauseTrading"; grouping key in UI + audit
    description : Text        -- recorded in GovernanceExecutionResult
  deriving (Show, Eq)

interface GovernableAction where
  viewtype GovernableActionView

  executeImpl : Update ()

  choice GovernableAction_Execute : ()          -- consuming (default)
    controller (view this).governanceParty
    do
      executeImpl this

  choice GovernableAction_Cancel : ()           -- consuming
    controller (view this).governanceParty
    do pure ()

  choice GovernableAction_ProposerCancel : ()   -- consuming
    controller (view this).proposer
    do pure ()
```

All three choices are *consuming*, because no `nonconsuming` keyword is given. A successful execute therefore archives the proposal, and it can never execute twice. [READ + Daml semantics]

### 3.2 `GovernanceRules`: `daml/governance-core/daml/Governance/Rules.daml` (459 lines) [READ]

```daml
template GovernanceRules
  with
    governanceParty : Party
    members : Set Party
    threshold : Int
    actionConfirmationTimeout : RelTime
    additionalProposers : Optional (Set Party)
  where
    signatory governanceParty
    ensure not (Set.null members) && threshold >= 1 && threshold <= Set.size members
        && actionConfirmationTimeout >= seconds 10
```

Domain-action choices. These are the ones Collara uses. Excerpt from lines 375-441:

```daml
    nonconsuming choice GovernanceRules_ConfirmAction : GovernanceRules_ConfirmActionResult
      with confirmer : Party; actionProposalCid : ContractId GovernableAction
      controller confirmer
      do
        require "Confirmer is a governance member" (confirmer `Set.member` members)
        actionView <- view <$> fetch actionProposalCid
        require "Proposal targets this governance" (actionView.governanceParty == governanceParty)
        require "Proposer is authorized (member or additional proposer)"
          (actionView.proposer `Set.member` members
            || optional False (Set.member actionView.proposer) additionalProposers)
        now <- getTime
        confirmationCid <- create GovernanceConfirmation with
          governanceParty; confirmer; actionProposalCid
          actionLabel = actionView.actionLabel
          expiresAt = now `addRelTime` actionConfirmationTimeout
        pure GovernanceRules_ConfirmActionResult with ..

    nonconsuming choice GovernanceRules_ExecuteConfirmedAction : ExecuteConfirmedActionResult
      with executor : Party; actionProposalCid : ContractId GovernableAction
           confirmations : [ContractId GovernanceConfirmation]
      controller executor
      do
        require "Executor is a governance member" (executor `Set.member` members)
        now <- getTime
        fetched <- mapA (\cid -> exercise cid GovernanceConfirmation_Consume) confirmations
        let valid = filter (\c -> c.expiresAt > now) fetched
        require "All confirmations must reference the same proposal"
          (all (\c -> c.actionProposalCid == actionProposalCid) valid)
        require "All confirmers must be current governance members"
          (all (\c -> c.confirmer `Set.member` members) valid)
        require "No duplicate confirmers" (unique $ map (.confirmer) valid)
        require "Enough confirmations to execute action" (length valid >= threshold)
        actionView <- view <$> fetch actionProposalCid
        exercise actionProposalCid GovernableAction_Execute   -- governanceParty authority flows here
        executionResultCid <- create GovernanceExecutionResult with
          governanceParty; actionLabel = actionView.actionLabel; description = actionView.description
          executor; confirmers = map (.confirmer) valid; executedAt = now
        pure ExecuteConfirmedActionResult with ..

    nonconsuming choice GovernanceRules_ExpireConfirmation : ()
      with member : Party; staleConfirmationCid : ContractId GovernanceConfirmation
      controller member
      do
        require "Only governance members can expire confirmations" (member `Set.member` members)
        exercise staleConfirmationCid GovernanceConfirmation_Expire
```

Self-management path. This is a closed enum `GovernanceSelfAction` with confirmations held in `GovernanceSelfConfirmation` (lines 27-83, 277-366). Variants:
- `SelfAction_AddMemberAndSetThreshold {newMember, newThresholdAfterAdd}`
- `SelfAction_RemoveMemberAndSetThreshold {removedMember, newThresholdAfterRemove}`
- `SelfAction_SetThreshold {updatedThreshold}`
- `SelfAction_SetTimeout {updatedTimeout}`
- `SelfAction_AddAdditionalProposer {additionalProposer}`
- `SelfAction_RemoveAdditionalProposer {additionalProposer}`

They are executed by `GovernanceRules_ExecuteGovernanceAction`. This path *filters out* non-member confirmations before counting; the domain path does not filter, it aborts. Collara can use `SelfAction_AddAdditionalProposer` to let the Collara operator party propose without voting.

### 3.3 `GovernanceConfirmation` (`Confirmation.daml`, 50 lines) and `GovernanceExecutionResult` (`ExecutionResult.daml`, 33 lines) [READ]

```daml
template GovernanceConfirmation
  with governanceParty : Party; confirmer : Party
       actionProposalCid : ContractId GovernableAction; actionLabel : Text; expiresAt : Time
  where
    ensure actionLabel /= ""
    signatory confirmer, governanceParty
    choice GovernanceConfirmation_Consume : GovernanceConfirmation   -- controller governanceParty
      -- require "Confirmation has expired" (now < expiresAt)
    choice GovernanceConfirmation_Expire : ()                        -- controller governanceParty; requires now > expiresAt
    choice GovernanceConfirmation_Cancel : ()                        -- controller confirmer

data ExecuteConfirmedActionResult = ExecuteConfirmedActionResult with executionResultCid : ContractId GovernanceExecutionResult

template GovernanceExecutionResult
  with governanceParty : Party; actionLabel : Text; description : Text
       executor : Party; confirmers : [Party]; executedAt : Time
  where signatory governanceParty
```

`GenericVoteProposal` (`GenericVote.daml`) is the reference implementation: `signatory proposer`, `observer governanceParty`, `actionLabel = "GenericVote"`, `executeImpl = pure ()`.

### 3.4 How each required property is enforced (with citations)

| Brief requirement | Enforced where | Mechanism | Notes |
|---|---|---|---|
| **One approval fails** (threshold 2) | Rules.daml L424-425 | `require "Enough confirmations to execute action" (length valid >= threshold)` | DM's UI hides Execute while `can_execute = false` (`decman-lib/src/catalog/interpret.rs` L643). To *prove* the on-ledger rejection, submit the execute directly (Ledger API or `POST /governance/execute` with one confirmation cid). |
| **Two distinct approvals permit execution** | Rules.daml L412-441 | Executor must be a member; each confirmation is consumed; all must match the proposal; confirmers must be current members; then `GovernableAction_Execute` runs and a `GovernanceExecutionResult` is created | Evidence: `executionResultCid`, the transaction's update id and offset, and `confirmers` in the result contract. |
| **Duplicates do not count twice** | Rules.daml L422-423 | `require "No duplicate confirmers" (unique $ map (.confirmer) valid)` | Confirming twice is **allowed** at confirm time and creates a second `GovernanceConfirmation`. The duplicate is caught at execute time, which **aborts the whole execute**; it is not silently deduplicated. DM's read path dedupes newest-per-party (`interpret::dedupe_newest_per_party`) before building `executable_confirmation_cids`, so the DM UI never sends duplicates. Daml test: `governance-core-test/.../AuthorizationTest.daml::testDuplicateConfirmationsRejected` (L112-140). |
| **Stale confirmations cannot be used** | Confirmation.daml `GovernanceConfirmation_Consume` | `require "Confirmation has expired" (now < expiresAt)`. The expiry is `actionConfirmationTimeout` after confirm. | An expired confirmation in the list **aborts** execution; the executor must leave it out. Test: `ExecutionTest.daml::testExpiredConfirmationsDontCount` (L143-178). Clean-up: `GovernanceRules_ExpireConfirmation` (any member, only after expiry). |
| **Stale proposals cannot execute** | **Not enforced by DM for the proposal itself** | `GovernableAction` has no expiry or version. Only the confirmations expire. | Collara must implement it in `executeImpl` (deadline plus pinned registry cid/version; §7). An already-executed proposal cannot re-execute because `GovernableAction_Execute` is consuming. A proposal whose referenced contracts were consumed fails at execute ("UTXO drift", CUSTOM_DAML_TEMPLATES.md L662). |
| Only members vote / execute | Rules.daml L382, L412, L420-421 | `confirmer ∈ members`, `executor ∈ members`, `confirmer ∈ members` at execute time | `additionalProposers` may only propose (CUSTOM_DAML_TEMPLATES.md L556). |
| Proposer authorised | Rules.daml L390-392 | `proposer ∈ members ∪ additionalProposers`, checked at **confirm** time, not at creation | Gotcha: an unauthorised proposal can be *created*; the first confirm fails. |
| Proposal belongs to this governance | Rules.daml L384-385 | `actionView.governanceParty == governanceParty` | |
| Failed `executeImpl` | Daml transaction semantics | The whole execute rolls back; the proposal and confirmations stay active | CUSTOM_DAML_TEMPLATES.md L664 |

---

## 4. DecMan REST API relevant to governance

All endpoints sit behind a Bearer JWT. In `--insecure` mode any token is accepted. Mutating endpoints also call `require_admin`. [READ `server/handlers/governance.rs`, `server/middleware/auth.rs`]

| Endpoint | Purpose / shape (wire DTOs in `crates/common/src/api.rs`) |
|---|---|
| `GET /governance/state?party_id=<dec>` | Active `GovernanceRules` (contract id, members, threshold, timeout, `out_of_date`, package ref) |
| `GET /governance/confirmations?party_id=<dec>` | `{actions:[…self…], domain_actions:[{proposal_cid, action_label, description, confirmations[], confirmation_count, executable_confirmation_cids, can_execute, orphaned, proposer, created_at, …}], threshold}`. Proposals are discovered through an **interface filter on `#governance-action-v1:Governance.Action:GovernableAction`** (`server/queries.rs::page_proposal_infos` L853-887), so **Collara's custom proposals appear automatically** with their `actionLabel` and `description`. |
| `GET /governance/proposals`, `/governance/audit`, `/governance/chain-audit`, `/governance/known-members` | Paged proposals, local audit log (SQLite), on-chain audit (`ChainAuditEntry {offset, timestamp, event_type, contract_id, template_id, package_id, governance_type, action_summary, choice, acting_parties, update_id, details}`) |
| `POST /governance/propose` | **Only for built-in `ProposalType` variants** (generic_vote, transfer, utility…). Creates the proposal (`act_as` proposer, `read_as` dec party), then immediately submits the proposer's confirmation as a second command (L1006-1060). **Cannot create Collara templates** without adding a Rust `ProposalType` (CUSTOM_DAML_TEMPLATES.md L21). |
| `POST /governance/confirm` | `{party_id, rules_contract_id, action, governance_type: "core_domain", proposal_cid}`. `action` is required by the schema but **ignored for `core_domain`**; send `{"type":"generic_vote","description":"placeholder"}`. **`governance_type` defaults to `core_self`**, so always send `"core_domain"` (`common/src/api.rs` L1192-1198). |
| `POST /governance/execute` | `{party_id, rules_contract_id, action, confirmation_cids:[…], disclosed_contracts:[], governance_type:"core_domain", proposal_cid}` |
| `POST /governance/cancel` | Member revokes their own confirmation `{party_id, confirmation_cid, governance_type}` |
| `POST /governance/expire` | Any member clears an *expired* confirmation `{party_id, rules_contract_id, confirmation_cid, governance_type}` |
| `POST /governance/cancel-proposal` | Proposer retracts `{party_id, proposal_cid, confirmation_cid?}`. Exercises `GovernableAction_ProposerCancel` and the proposer's own confirmation cancel in one transaction. |
| `POST /dars/distribute` (+ `/status`) | `{dar_files:[{filename, data:<base64>}], peer_ids:[…non-empty…]}`. Multi-party workflow; peers verify filename **and SHA-256** from the invitation. `POST /dars/upload` uploads to this node only. `GET /packages/vetted`, `GET /packages/compare-peers` (admin). |
| `POST /contracts` (+ `/status`) | Creates contracts **signed by the decentralized party** using the field-type system (`decentralized_party`, `operator_party`, `participant_party`, `text`, `int64`, `bool`, `party_set`, `rel_time`, `optional`, `none`, `record`, `governance_threshold`, `instrument`, `attestors_set`). Serializer: `crates/decman/src/workflow/contracts/steps/prepare.rs`. **Field order must match the Daml template.** Needs ≥ 3 participants. |
| `POST /onboarding`, `GET /onboarding/status` | `{party_id_prefix, peer_ids:[…], threshold?}` |
| `GET/POST /network-config`, `GET /keys/status`, `GET /node-config` | Peer mesh setup (public key, participant id) |
| `PUT /party-config`, `GET /party-config/{dec}` | `{dec_party_id, member_party_id, user_id, keycloak_url, keycloak_realm, keycloak_client_id, keycloak_client_secret, packages:{…}}` or the Auth0 equivalents. **Required on every node** before governance endpoints work: they return 404 "No credentials configured for party" otherwise. |
| `GET /invitations`, `POST /invitations/accept {id}`, `POST /invitations/decline` | Peers accept workflow runs |
| `GET /contracts/query?party_id&package_id&module_name&entity_name&interface=true|false&include_payload=true` | Generic ACS query, e.g. for `GovernanceExecutionResult` |

How commands reach Canton [READ `decman-lib/src/catalog/commands.rs` L87-158, `framework/commands.rs` L15-40]:
- DM uses gRPC `CommandService.SubmitAndWait` with `Authorization: Bearer <party token>`.
- `Commands.act_as = [member_party]` and `read_as = [decentralized_party]`. `user_id` is left empty, so it comes from the token's `sub`.
- Template ids use **package-name references**. The defaults are hard-coded in `config.rs::default_package_config()` L456-468: `"#governance-action-v1"`, `"#governance-core-v1"`, …
- `resolve_contract_package_ref` then rewrites the reference to the actual package of the live `GovernanceRules`.

---

## 5. How a third-party package plugs in (DM's documented contract)

Source: `docs/CUSTOM_DAML_TEMPLATES.md` (717 lines at HEAD) [READ].

"Fully supported" means:
1. The package implements `GovernableAction` from `governance-action-v1`.
2. Its DAR is distributable through `POST /dars/distribute`.
3. Its proposal is created through `POST /contracts` (field types), or **by an external app/script that the governance party can read**.
4. It is confirmable through `POST /governance/confirm` with `core_domain`.
5. It is executable through `POST /governance/execute` with `core_domain`, producing a `GovernanceExecutionResult`.

One `GovernanceRules` per governance party serves every custom template; no new rules contract is needed per template (L23).

Conventions table (L85-93):

| Concern | Convention |
|---|---|
| Signatory | `proposer` only |
| Observer | `governanceParty`, plus any party that needs to read the proposal |
| `governanceParty` field | Must equal `GovernanceRules.governanceParty` |
| `proposer` field | Must be in `members ∪ additionalProposers`; the submitting participant must `actAs` it |
| `actionLabel` | Stable, distinct PascalCase string; it is the audit grouping key forever. Do not reuse `"GenericVote"`. |
| `description` | Self-explanatory permanent record. Embed the salient parameters, as the audit's DLC-3 enrichment did. |
| Preconditions | `ensure` clauses, so bad proposals fail at creation |

`executeImpl` may exercise or create anything whose required authority is a subset of `{proposer, governanceParty}`. It may **not** require any other party's authority (L95-100).

Package layout and build (L230-298):
- Own package, `daml.yaml` with `sdk-version: 3.4.11`, versioned name (e.g. `collara-governance-v0`).
- `data-dependencies: [<governance-action-v1-0.1.0.dar>]`. This is the only required dependency; `governance-core` is **not** a build dependency of the custom package. Use `data-dependencies`, not `dependencies`.
- Build options: `--target=2.2` plus the warnings flags.
- Build with `daml build --all` / `dpm build`.

Package-id registration: not needed. For `core_domain`, only `governance_core` is resolved by name; the proposal's package is implied by its contract id (L331-341).

Versioning (L636-642):
- Live proposals execute against the package version that created them.
- A breaking change ships as a *new* package name (`-v1`).
- Never mutate the semantics of a template version in place.

Self-management changes while proposals are in flight (L644-656):
- Confirmations survive member and threshold changes.
- Execute requires all passed confirmations to come from *current* members, and aborts otherwise.
- A lowered threshold can unlock a stalled proposal.
- `actionConfirmationTimeout` changes are not retroactive.
- Removed additional proposers can no longer gather new confirmations.
- Recommendation: short timeouts (minutes to hours) for proposals that touch mutable state.

Gotchas (L658-666):
- Missing `observer governanceParty` makes confirm fail.
- `ContractId` fields are resolved at execute time ("UTXO drift").
- A failed `executeImpl` leaves everything open.
- Non-member proposers fail at confirm, not at creation.
- **"Every member's node sees what the governance party sees"**: all contracts with `governanceParty` as stakeholder, and the consequences of every action it is informed of, land on every member participant. Keep private data out of governance-visible contracts.

---

## 6. Lifecycle as actually invoked

### 6.1 One-time setup (DM UI or REST; mirrors `integration-tests/common.sh` and `crates/decman/tests/common/phases/{create_dec_party,distribute_dars,deploy_gov_core}.rs`) [READ]

1. Start 3 DM nodes, one per participant.
2. Exchange peers. On each node, read `GET /keys/status` (`.public_key`) and `GET /node-config` (`.node.participant_id`), then `POST /network-config` with the *other* nodes' `{participant_id, name, address, port, public_key, party:null}`. Alternatively use the UI's "Share my data" / "Paste from Clipboard".
3. On P1, `POST /onboarding {party_id_prefix:"collara-gov", peer_ids:[p2,p3], threshold:2}`. P2 and P3 accept the `Onboarding` invitation. Poll `/onboarding/status` until `completed`. The decentralized party appears in `GET /decentralized-parties`.
4. Allocate member parties, one local party per participant. LocalNet tests use the JSON Ledger API `POST /v2/parties {"party_id_hint":"gov-member-p1",…}`.
5. Grant user rights. LocalNet tests grant `ledger-api-user` `CanActAs` + `CanReadAs` on **both** the member party and the decentralized party, on every participant, through `POST /v2/users/ledger-api-user/rights`. DevNet uses DM's `POST /auth/grant-rights` with participant-admin Keycloak credentials.
6. `PUT /party-config` on each node: `dec_party_id`, that node's `member_party_id`, `user_id`, IdP fields, and `packages` (`governance_action:"#governance-action-v1"`, `governance_core:"#governance-core-v1"`, …).
7. On P1, `POST /dars/distribute` with `governance-action-v1-0.1.0.dar`, `governance-core-v1-0.1.0.dar` and Collara's DAR. Peers accept the `Dars` invitation.
8. On P1, `POST /contracts` to create `GovernanceRules`. Peers accept the `Contracts` invitation. Exact body used in `deploy_gov_core.rs` L254-271:
   ```json
   {"decentralized_party_id": "<dec>", "participant_ids": ["<p1 uid>","<p2 uid>","<p3 uid>"],
    "participant_parties": ["<m1>","<m2>","<m3>"], "operator_party": "<m1 or operator>",
    "contracts": [{"id":"governance-rules","name":"GovernanceRules","package_id":"#governance-core-v1",
      "module_name":"Governance.Rules","entity_name":"GovernanceRules",
      "fields":[{"type":"decentralized_party"},
                {"type":"party_set","parties":["<m1>","<m2>","<m3>"]},
                {"type":"int64","value":2},
                {"type":"rel_time","microseconds":1800000000},
                {"type":"none"}]}]}
   ```
   Do **not** use `attestors_set` for `members`. The fifth field (`none`) is mandatory in the JSON.
9. Read the rules contract id with `GET /governance/state?party_id=<dec>`.

### 6.2 Per action

1. **Propose (Path B).** A Ledger API `CreateCommand` for the Collara proposal template, `actAs [proposer]`, optionally `readAs [dec]`. The proposer must be a member or an additional proposer. DM does not auto-confirm Path-B proposals.
2. **Confirm**, once per member, on that member's node or credentials:
   - via DM: `POST /governance/confirm` (`core_domain` + `proposal_cid`);
   - or directly: exercise `GovernanceRules_ConfirmAction {confirmer=<member>, actionProposalCid=<cid>}` with `actAs [member]`, `readAs [dec]`.
3. **Execute** by any member:
   - via DM: `POST /governance/execute` with `confirmation_cids` taken from `executable_confirmation_cids`;
   - or directly: exercise `GovernanceRules_ExecuteConfirmedAction {executor, actionProposalCid, confirmations}`.
4. **Evidence:** the `ExecuteConfirmedActionResult.executionResultCid`, the transaction update id and offset, and the `GovernanceExecutionResult` payload (`actionLabel`, `description`, `executor`, `confirmers`, `executedAt`), readable through `GET /contracts/query?...entity_name=GovernanceExecutionResult&include_payload=true` or `GET /governance/chain-audit`. Also Collara's own side effects, such as the new `VerifierAccreditation` contract id.

Daml-script simulation used by DM's own tests (single ledger, no topology) [READ `governance-core-test/daml/Governance/TestUtils.daml`]:
- `governanceParty <- allocateParty "GovernanceParty"`.
- Members submit with `actAs member <> readAs gp`.
- `GovernanceRules` is created by `submit governanceParty $ createCmd GovernanceRules with … threshold = 2; actionConfirmationTimeout = minutes 30; additionalProposers = None`.

This is exactly the fallback pattern for a single sandbox (§10, Tier A).

---

## 7. Integration recipe for Collara: AddVerifier / SuspendVerifier

Everything in this section is a **design proposal [INFERRED]** built on the verified DM contract. Compile and test it before trusting it.

### 7.1 Package

```
daml/collara-governance/            # separate package so its LF/SDK match DM exactly
  daml.yaml
  daml/Collara/Governance/Registry.daml
  daml/Collara/Governance/Proposals.daml
daml/collara-governance-test/       # Daml Script tests, data-depends on governance-core-v1 DAR too
vendor-dars/governance-action-v1-0.1.0.dar   # copied from DM releases/v1 (sha256 4fc7912d…)
vendor-dars/governance-core-v1-0.1.0.dar     # test + deployment only (sha256 b8d05903…)
```

```yaml
sdk-version: 3.4.11            # match DM exactly
name: collara-governance-v0
version: 0.1.0
source: daml
dependencies: [daml-prim, daml-stdlib]
data-dependencies:
  - ../../vendor-dars/governance-action-v1-0.1.0.dar
build-options:
  - --target=2.2
```

The core Collara package (attestations) must data-depend on `collara-governance-v0` to fetch `VerifierAccreditation`. The simplest option is to build the whole Collara model with SDK 3.4.11 / LF 2.2; see §8.

### 7.2 Templates (sketch)

```daml
module Collara.Governance.Registry where
import DA.Set (Set)
import qualified DA.Set as Set

data VerifierStatus = Active | Suspended deriving (Eq, Show)

-- Anchor: one per deployment. Every governed change archives and recreates it with version+1.
-- That makes any proposal pinned to an older registry cid stale by construction.
template VerifierRegistry
  with
    governanceParty : Party        -- the DM decentralized party
    operator        : Party        -- Collara app/operator party (read-model visibility)
    registryId      : Text
    version         : Int
    activeVerifiers : Set Party    -- authoritative on-ledger set, used for duplicate checks
  where
    signatory governanceParty
    observer operator
    ensure registryId /= "" && version >= 0

    choice Registry_Add : ContractId VerifierRegistry
      with verifier : Party
      controller governanceParty
      do assertMsg "Verifier already active" (not (Set.member verifier activeVerifiers))
         create this with version = version + 1; activeVerifiers = Set.insert verifier activeVerifiers

    choice Registry_Remove : ContractId VerifierRegistry
      with verifier : Party
      controller governanceParty
      do assertMsg "Verifier not active" (Set.member verifier activeVerifiers)
         create this with version = version + 1; activeVerifiers = Set.delete verifier activeVerifiers

-- Per-verifier capability. Attestation issuance must present (fetch) the current one.
template VerifierAccreditation
  with
    governanceParty : Party
    operator        : Party
    verifier        : Party
    orgName         : Text
    scope           : [Text]          -- e.g. ["CNC_MACHINERY"]
    status          : VerifierStatus
    validUntil      : Optional Time
    registryVersion : Int
    reason          : Text
  where
    signatory governanceParty
    observer operator, verifier

    choice Accreditation_Suspend : ContractId VerifierAccreditation
      with suspendReason : Text; newRegistryVersion : Int
      controller governanceParty
      do assertMsg "Not active" (status == Active)
         create this with status = Suspended; reason = suspendReason; registryVersion = newRegistryVersion
```

```daml
module Collara.Governance.Proposals where
import Governance.Action
import Collara.Governance.Registry

template AddVerifierProposal
  with
    governanceParty  : Party
    proposer         : Party            -- governance member, or Collara operator added as additionalProposer
    registryCid      : ContractId VerifierRegistry
    expectedVersion  : Int
    verifier         : Party
    orgName          : Text
    scope            : [Text]
    validUntil       : Optional Time
    proposalDeadline : Time             -- proposal-level staleness (DM has none)
    reason           : Text
  where
    signatory proposer
    observer governanceParty
    ensure orgName /= "" && not (null scope)

    interface instance GovernableAction for AddVerifierProposal where
      view = GovernableActionView with
        governanceParty
        proposer
        actionLabel = "CollaraAddVerifier"
        description = "Add verifier " <> show verifier <> " (" <> orgName <> "), scope "
                      <> show scope <> ", registry v" <> show expectedVersion <> ": " <> reason
      executeImpl = do
        now <- getTime
        assertMsg "Proposal deadline passed" (now <= proposalDeadline)
        reg <- fetch registryCid                       -- fails if registry changed (archived) => stale
        assertMsg "Registry of another governance" (reg.governanceParty == governanceParty)
        assertMsg "Stale registry version" (reg.version == expectedVersion)
        _ <- exercise registryCid Registry_Add with verifier   -- on-ledger duplicate check
        _ <- create VerifierAccreditation with
               governanceParty; operator = reg.operator; verifier; orgName; scope
               status = Active; validUntil; registryVersion = expectedVersion + 1; reason
        pure ()

template SuspendVerifierProposal
  with
    governanceParty  : Party
    proposer         : Party
    registryCid      : ContractId VerifierRegistry
    expectedVersion  : Int
    accreditationCid : ContractId VerifierAccreditation
    verifier         : Party
    proposalDeadline : Time
    reason           : Text
  where
    signatory proposer
    observer governanceParty
    ensure reason /= ""

    interface instance GovernableAction for SuspendVerifierProposal where
      view = GovernableActionView with
        governanceParty
        proposer
        actionLabel = "CollaraSuspendVerifier"
        description = "Suspend verifier " <> show verifier <> ", registry v" <> show expectedVersion <> ": " <> reason
      executeImpl = do
        now <- getTime
        assertMsg "Proposal deadline passed" (now <= proposalDeadline)
        reg <- fetch registryCid
        assertMsg "Registry of another governance" (reg.governanceParty == governanceParty)
        assertMsg "Stale registry version" (reg.version == expectedVersion)
        acc <- fetch accreditationCid
        assertMsg "Accreditation mismatch"
          (acc.verifier == verifier && acc.governanceParty == governanceParty && acc.status == Active)
        _ <- exercise registryCid Registry_Remove with verifier
        _ <- exercise accreditationCid Accreditation_Suspend with
               suspendReason = reason; newRegistryVersion = expectedVersion + 1
        pure ()
```

Design choices and why:
- **Signatories.**
  - Proposals: `proposer` only, `observer governanceParty`, as the DM convention requires.
  - Registry and accreditation: `signatory governanceParty`. Only a governed execute can create or change them, because `executeImpl` runs with the decentralized party's authority flowing from `GovernanceRules`.
  - `executeImpl` needs no other party's authority. Observers (`operator`, `verifier`) do not need to authorise.
- **Stale proposals.** There are three independent layers:
  1. The pinned `registryCid` / `expectedVersion`. Any intervening governed change archives the registry, so a later execute of an older proposal fails on `fetch` or on the version check.
  2. `proposalDeadline`, checked in `executeImpl`.
  3. DM's confirmation expiry (`actionConfirmationTimeout`).

  **Trade-off:** pinning the registry serialises all registry actions; concurrent proposals must be re-filed after one executes. That is acceptable for rare admin actions and makes "stale cannot execute" trivially demonstrable. A looser alternative: do not pin the cid, and have the backend pass the current registry through a fresh proposal. Without contract keys (not available on Canton 3.x / LF 2.x [INFERRED]) there is no on-ledger lookup by key.
- **Duplicates.**
  - Member-level: DM's `No duplicate confirmers`.
  - Domain-level: `Registry_Add` rejects an already-active verifier and `Registry_Remove` rejects a non-active one.
- **Proposer.** Either a member party (the Collara backend must hold that member's ledger credentials), or, cleaner, the **Collara operator party added as an additional proposer** through a `core_self` vote (`governance_add_additional_proposer`, CUSTOM_DAML_TEMPLATES.md L521-556). That vote is itself a nice first 2-of-3 demo.
- **Bootstrap of `VerifierRegistry`.** There are two options:
  - (a) Include it in the same `POST /contracts` call as `GovernanceRules`. Fields in order: `decentralized_party`, `operator_party`, `text`, `int64 0`, `party_set []`. [VERIFY that an empty `party_set` serialises correctly.]
  - (b) A `BootstrapVerifierRegistryProposal` `GovernableAction` whose `executeImpl` creates the registry. This puts bootstrap on the governance audit trail and avoids the `/contracts` serializer. Recommended: (b), or (a) for speed.

### 7.3 "Suspension blocks new attestations": the attestation-side check (Collara core package)

In the verifier-controlled choice that issues an attestation (or activates one):

```daml
acc <- fetch accreditationCid                -- current accreditation presented by the verifier
now <- getTime
assertMsg "Untrusted registry" (acc.governanceParty == request.collaraGovernanceParty) -- MUST pin the trusted gov party
assertMsg "Wrong verifier"     (acc.verifier == verifier)
assertMsg "Verifier suspended" (acc.status == Active)
assertMsg "Accreditation expired" (optional True (now <) acc.validUntil)
assertMsg "Out of scope"       ("CNC_MACHINERY" `elem` acc.scope)
```

- **Security point.** Anyone can create a `VerifierAccreditation` naming a party they control as `governanceParty`. The check must compare it to the Collara governance party stored on an operator-signed workflow contract, such as the verification request or the deployment configuration.
- Suspension archives the Active accreditation and replaces it with a `Suspended` copy. An old cid then fails the fetch (inactive), and the new cid fails the status check.
- Policy choice for the docs:
  - Previously issued attestations remain historical records.
  - New issuance is blocked.
  - Optionally, a *new activation* that relies on an attestation, such as a pledge activation, can re-check the verifier's *current* accreditation (brief line 116: "expiry and suspension policy are checked for new activation").
- **Privacy and availability caveat [INFERRED, VERIFY].**
  - A `fetch` informs the fetched contract's signatories. Here that is the decentralized party, which is hosted on all three member participants.
  - So every attestation transaction leaks at least the fetch of the accreditation to all governance member nodes. It also probably makes the decentralized party a *confirming* party, so issuing an attestation would need ≥ P2P-threshold member participants online.
  - Keep attestation payloads free of `governanceParty` as a stakeholder; fetch, do not exercise a nonconsuming choice, so only the fetch node is visible.
  - Measure on LocalNet whether governance participants must confirm.
  - If that coupling is unacceptable, an alternative is an operator-signed status mirror updated by a worker that reacts to `GovernanceExecutionResult`. It adds a trust assumption that must be documented.

### 7.4 Backend wiring (Fastify API + worker)

- Put a port interface in `packages/canton` (or `governance` module):
  - `proposeAddVerifier`, `proposeSuspendVerifier`
  - `confirm(memberSeat, proposalCid)`
  - `execute(memberSeat, proposalCid)`
  - `listPending()`, `getRulesState()`, `getExecutionEvidence(proposalCid)`
- Two adapters:
  1. **`DmRestGovernanceAdapter`.** Calls each member's DM node (`/governance/confirm|execute|confirmations|state`, `/contracts/query`). This proves the "actual DM lifecycle" and reuses DM's dedupe and expiry filtering. It needs one DM node URL and token per member seat; any bearer in `--insecure` mode, Keycloak tokens otherwise.
  2. **`LedgerGovernanceAdapter`.** Uses the JSON Ledger API v2 against each member's participant:
     - Create proposals (always this path; DM cannot).
     - Exercise `#governance-core-v1:Governance.Rules:GovernanceRules` choices with `actAs [member]` and `readAs [decParty]`.
     - Envelope shape: `POST /v2/commands/submit-and-wait-for-transaction` with `commands: {commandId, userId, actAs, readAs, commands:[{ExerciseCommand:{templateId, contractId, choice, choiceArgument}}]}`. [VERIFY against the node's OpenAPI.]
- Executable confirmations: replicate DM's rule (`interpret.rs::counts_toward_threshold` and `dedupe_newest_per_party`):
  - newest live confirmation per member;
  - not expired;
  - confirmer ∈ current `members`.

  Never send duplicates or expired confirmations; they abort the execute.
- Worker: subscribe to `GovernanceExecutionResult`, `VerifierRegistry` and `VerifierAccreditation` creates and archives (visible to the operator, or to the decentralized party with readAs). Project them into PostgreSQL. Show evidence: update id, offset, `executionResultCid`, confirmers, executor, new accreditation cid.
- UI: Governance page with 3 member "seats". The demo session switcher selects which member's credentials confirm. Show threshold 2/3, per-member confirmation status, expiry countdown, and Execute only when executable. Clearly separate:
  - (1) app governance threshold,
  - (2) DNS threshold,
  - (3) participant confirmation threshold.

### 7.5 Verification matrix (maps brief §8 to tests)

| Brief check | Daml Script test (single ledger) | LocalNet / DM demo evidence |
|---|---|---|
| One approval fails | Confirm by m1 only, then `submitMustFail` execute | `POST /governance/execute` with 1 cid gives 500 with "Enough confirmations to execute action" |
| Two distinct approvals execute | m1 + m2 confirm; execute succeeds; assert `GovernanceExecutionResult.actionLabel == "CollaraAddVerifier"`, accreditation exists, registry version + 1 | `executionResultCid`, update id, `/governance/chain-audit` entry |
| Duplicates don't count twice | m1 confirms twice; execute with both gives "No duplicate confirmers"; execute with one m1 cid gives "Enough confirmations" | Same, through the Ledger adapter. DM UI shows count 1. |
| Stale proposal cannot execute | (a) two Add proposals pinned to v0: execute first, second fails (inactive registry cid). (b) `passTime` past `proposalDeadline`: execute fails. (c) `passTime` past `actionConfirmationTimeout`: confirmations expired, execute fails. (d) re-execute an executed proposal fails (archived). | Same on LocalNet; for (b)/(c) use short deadlines/timeouts (≥ 10 s minimum timeout, `ensure` in Rules.daml L167) |
| Non-member cannot confirm/execute; unauthorised proposer rejected at confirm | DM-style tests | |
| Add duplicate active verifier rejected | Second Add for the same verifier, after re-filing at the new version, fails "Verifier already active" | |
| Suspension blocks new attestations | After Suspend, verifier's issue-attestation with old cid fails (inactive); with new cid fails "Verifier suspended" | Same, plus the attestation UI error |
| Proposer cancel | `GovernableAction_ProposerCancel` archives the proposal | `POST /governance/cancel-proposal` |

---

## 8. Versions and compatibility

| Component | DM pins / tests | Latest seen 2026-10-01 | Source |
|---|---|---|---|
| Daml SDK for DM's Daml | **3.4.11**, `--target=2.2` (all `daml.yaml`). CI: `~/.dpm/bin/dpm install 3.4.11`, `dpm build --all`, byte-compares the build with `releases/v1/*.dar`, `dpm upgrade-check`, `dpm test` | GitHub `digital-asset/daml` latest stable 3.x tag **v3.4.11** (2026-02-18); later 3.5 builds are snapshots on GitHub. Splice pins **DPM SDK 3.5.2** (`nix/dpm-sdk-sources.json` at v0.6.12 and v0.8.4). | daml.yaml, `.github/workflows/ci.yml` L211-303 [READ]; GitHub API [READ] |
| Canton runtime | **3.5.8**: Splice LocalNet **0.6.12** (`integration-tests/env.sh` `LOCALNET_VERSION="0.6.12"`, bundle `…/v0.6.12/0.6.12_splice-node.tar.gz`). Splice v0.6.12 `nix/canton-sources.json` `"version": "3.5.8"`. DM's `canton_hash` is a port of Canton **v3.5.8**. | Canton OSS **v3.5.19** (2026-09-23). Splice **v0.8.4** (2026-09-25) pins Canton 3.5.19. | [READ] |
| Protocol version | **35**, hard-coded: `crates/decman/src/consts.rs` L162-165 `pub const CANTON_PROTOCOL_VERSION: i32 = 35;` ("Bumped 34 -> 35 alongside the localnet 0.6.7 -> 0.6.11 test target"). Used for vault key export. | | [READ] |
| Ledger API features | Uses `GetActiveContractsPage` / `GetUpdatesPage` (Canton ≥ 3.5.1) with fallback for older nodes. Uses P2P-embedded signing keys (Canton ≥ 3.4). | | `server/ledger_paging.rs` [READ] |
| Rust | stable, edition 2024 (≥ 1.85) | local: 1.95.0 (Windows, gnu toolchain active) | |
| Node (frontend build) | `^20.19.0 || >=22.12.0`; CI Node 22 | local: 24.16 (satisfies `>=22.12.0`) | |
| Build system deps (Linux) | `pkg-config libssl-dev protobuf-compiler libprotobuf-dev git openssh-client ca-certificates cmake` | | `.github/actions/setup-build-env/action.yml` [READ] |
| Java | Needed only for Daml tests and for Canton itself: "Java 17+ is required for Daml tests" (CONTRIBUTING.md) | local: Temurin 21.0.12 | [READ]; Canton OSS on Java 21 [INFERRED] |

Compatibility conclusions:
- **Interface identity matters, not SDK version.** Collara must implement the interface from the *exact* `governance-action-v1` package id `48acd500…`, which is guaranteed by data-depending on `releases/v1/governance-action-v1-0.1.0.dar`.
  - Building Collara's governance package with SDK **3.4.11 / LF 2.2** is the zero-risk choice.
  - A newer SDK (3.5.x via DPM) can probably consume LF 2.2 DARs as data-dependencies, but that is [INFERRED/VERIFY]. A package compiled to a higher LF minor can depend on lower ones; the reverse is impossible.
- **Runtime:** LF 2.2 packages built with SDK 3.4.11 run on Canton 3.5.8. DM's integration suite does exactly that. Using Canton **3.5.8** keeps Collara identical to DM's tested target; 3.5.19 should work (same minor) but is untested by DM [INFERRED]. **Canton 3.4.x is likely incompatible with DM v1.12.0** because PV 35 is hard-coded [INFERRED].
- **Keycloak:** compatible.
  - DM supports a Keycloak public SPA client with PKCE (`DECPM_KEYCLOAK_URL/REALM/CLIENT_ID`), optional `DECPM_ADMIN_ROLE` and `DECPM_KEYCLOAK_INTERNAL_URL`.
  - It also supports per-party confidential clients for Canton tokens. The Canton participants must then validate Keycloak JWTs (JWKS auth service) [INFERRED].
  - For LocalNet, unsafe HMAC plus `--insecure` is what DM's own localnet tests use.

---

## 9. Deployment requirements (what DM needs)

Mandatory for real DM governance:
1. **≥ 3 Canton participants** (3.5.x, PV 35) connected to one synchronizer. DM resolves the synchronizer by **alias** `DECPM_CANTON_SYNCHRONIZER` (default `global`) through `SynchronizerConnectivityService.GetSynchronizerId` (`utils.rs` L335-361).
2. **Admin API (gRPC) and Ledger API (gRPC) reachable** from each DM node. Defaults are 5002/5001. TLS is optional (`DECPM_CANTON_*_TLS*`).
3. **One DM process per participant.** Each needs its own `DECPM_DIR` (SQLite + Noise key), HTTP port, Noise port and metrics port, and the nodes must be mutually reachable on Noise ports (`DECPM_PUBLIC_ADDRESS`).
4. **Auth:** either Keycloak or Auth0 (UI + per-party M2M), or `--insecure` against a Canton with unsafe HMAC auth. Splice LocalNet's participant config, from Splice v0.6.12 `cluster/compose/localnet/conf/canton/app-provider/app-auth.conf` [READ]:
   ```hocon
   ledger-api {
     auth-services = [{ type = unsafe-jwt-hmac-256, target-audience = "https://canton.network.global", secret = "unsafe" }]
     user-management-service.additional-admin-user-id = "ledger-api-user"
   }
   ```
   DM leaves `Commands.user_id` empty, so a token with a `sub` is needed. A no-auth Canton would likely reject empty `user_id` [INFERRED, VERIFY].
5. **Member parties** (local, one per participant) with user rights `CanActAs member` + `CanReadAs decParty`; LocalNet tests also grant `CanActAs decParty`.
6. **DARs vetted on all participants:** `governance-action-v1`, `governance-core-v1`, and Collara's.

Not required for governance: Docker, Splice validator/SV/scan/wallet apps, Canton Coin, Kubernetes, Keycloak (if insecure mode).

Splice LocalNet layout DM tests against (`integration-tests/env.sh` [READ]):
- One `canton` container with 3 participants:
  - app-provider: Ledger 3901, Admin 3902, JSON 3975
  - app-user: 2901, 2902, 2975
  - sv: 4901, 4902, 4975
- DM HTTP 8081-8083, Noise 9001-9003, metrics 9464-9466.
- `DECPM_TOPOLOGY_PROPAGATION_DELAY_SECS=3` for localnet; the production default is 30 s.
- `DECPM_PEER_WAIT_POLL_DELAY_MS=500`.
- `DECPM_CANTON_NETWORK=devnet`.
- Mock token (HS256 "unsafe", aud `https://canton.network.global`, sub `ledger-api-user`).

Production notes (DEPLOYMENT_GUIDE.md [READ]):
- Kubernetes manifests: Secret, Deployment + PVC, Service, Traefik Ingress.
- Noise port public; metrics port private.
- `DECPM_DB_ENCRYPTION_KEY` recommended.
- Peers exchange public keys out of band.
- `--insecure` must never be used in production.

---

## 10. Feasibility on this machine (Windows 11, no Docker, Java 21, Node 24, WSL2 Ubuntu 24.04 with PostgreSQL 16)

Local facts checked:
- `cargo 1.95.0` and `rustc 1.95.0` installed; the active toolchain is **`stable-x86_64-pc-windows-gnu`**; msvc is installed but there is **no Visual Studio**.
- **No `protoc`, `cmake`, `nasm` or `clang`.**
- **No `daml`/`dpm`.**
- Java Temurin 21.0.12, Node v24.16.0.
- `wsl -l -v`: `Ubuntu  Stopped  2`.

### 10.1 Can DM run against a plain Canton sandbox / `dpm sandbox`?
- **`dpm sandbox` (single participant): No, for DM.**
  - Onboarding needs ≥ 2 distinct participants and `/contracts` needs ≥ 3.
  - Each DM node is keyed by its participant id (Noise peer DB, P2P hosting list), so three DM nodes on one participant cannot form a decentralized party. [INFERRED from ARCHITECTURE.md §Participant Minimums and the P2P model.]
- **Yes, for the DM *Daml engine*.** Upload `governance-action-v1` + `governance-core-v1` + Collara DARs to a sandbox. Allocate `GovernanceParty` and 3 members. Create `GovernanceRules` as `GovernanceParty`; members act with `readAs GovernanceParty`. This is exactly DM's own Daml test harness (§6.2). Quorum, duplicate and expiry rules are enforced for real, but the governance party is controlled by one operator.
- **Plain Canton OSS with 3 participants: probably yes [VERIFY].** It is the same Canton build Splice LocalNet uses (Splice pins Canton OSS 3.5.8 `oss_sha256`). DM only needs Admin API, Ledger API and a synchronizer alias. It has not been tried here, and DM's maintainers do not test this layout.

### 10.2 Mandatory pieces for a *real* 2-of-3 DM demo
Canton 3.5.x × 3 participants, 1 sequencer + 1 mediator, unsafe-HMAC auth, 3 × DM v1.12.0, DM DARs + Collara DAR, member parties + rights, DM onboarding (decentralized party), `/dars/distribute`, `/contracts` (GovernanceRules), Collara proposals through the Ledger API, confirm/execute through DM or the Ledger API.

### 10.3 Minimal path (recommended): everything inside WSL2 Ubuntu
1. **Canton:** download `canton-open-source-3.5.8.tar.gz` (≈ 282 MB) from https://github.com/digital-asset/canton/releases/tag/v3.5.8 and install `openjdk-21-jre-headless` (or 17) in WSL. Write a config with:
   - `sequencers.sequencer1 { sequencer.type = reference }` and `mediators.mediator1`;
   - `participants.p1/p2/p3` with ledger-api 5001/5011/5021, admin-api 5002/5012/5022 and `http-ledger-api` 7575/7576/7577;
   - each participant's `ledger-api.auth-services` and `additional-admin-user-id` as in §9;
   - storage on WSL Postgres 16 (one DB per node), or in-memory for throwaway runs.

   Bootstrap script: create a synchronizer from sequencer1 + mediator1 (PV 35) and `connect_local` every participant with alias **`global`**. [INFERRED: exact Canton 3.5 console commands, e.g. `bootstrap.synchronizer(...)` / `participants.all.synchronizers.connect_local(sequencer1, alias = "global")`; VERIFY against `examples/` in the Canton tarball.]
2. **DM binary.** Either:
   - (a) **No build:** fetch the v1.12.0 amd64 image's last layer from `public.ecr.aws`. Get an anonymous token from `https://public.ecr.aws/token/?scope=repository:dlc-link/decentralization-manager:pull`, then `GET /v2/dlc-link/decentralization-manager/blobs/sha256:4f06a12e…`, and `tar -xzf` it to get `usr/local/bin/dec-party-manager`. It is a glibc binary built on Debian 12, so it should run on Ubuntu 24.04 [INFERRED].
   - (b) Build in WSL: `apt install build-essential pkg-config libssl-dev protobuf-compiler libprotobuf-dev cmake git`, Node 22, rustup stable; then `DECMAN_SKIP_FRONTEND=1 cargo run -p decman --features typegen --bin gen-types` and `cargo build --release -p decman`. canton-lib is fetched over https; no SSH needed.
3. Run 3 nodes:
   ```
   DECPM_PORT=8081 DECPM_NOISE_PORT=9001 DECPM_METRICS_PORT=9464 DECPM_CANTON_LEDGER_PORT=5001 DECPM_CANTON_ADMIN_PORT=5002 \
   DECPM_PUBLIC_ADDRESS=127.0.0.1 DECPM_LOG_FORMAT=text DECPM_TOPOLOGY_PROPAGATION_DELAY_SECS=3 \
   ./dec-party-manager -d ./dm/p1 serve --insecure
   ```
   P2 and P3 the same with 8082/9002/9465/5011/5012 and 8083/9003/9466/5021/5022.
4. Follow §6.1 steps 2-9, then §6.2. Script it in bash, mirroring `integration-tests/common.sh::configure_peers` and the Rust phases.
5. Collara's Windows-side Node services reach WSL ports via `localhost` forwarding (Windows→WSL works by default with WSL2 NAT [INFERRED]).
6. Build the Collara DAR with `dpm` (SDK 3.4.11) in WSL, or on Windows if DPM supports it [VERIFY].

### 10.4 Exact blockers and risks
1. **No Docker.** DM's documented local path (Splice LocalNet 0.6.12 docker-compose, `integration-tests/run.sh`, `development/docker-compose.yml`) and its Docker image cannot be used as-is. *Workaround:* §10.3.
2. **DM is Linux-first.** CI and images are Linux amd64 only and there are no Windows binaries. A Windows-native build would need protoc (+ well-known protos), probably cmake/NASM or an MSVC toolchain for `aws-lc-rs`/`aws-lc-sys` (used by `jsonwebtoken`, `tokio-rustls` and `tonic` `tls-aws-lc`), and the gnu toolchain is currently default. The code does have `cfg(unix)` guards (`noise/mod.rs`), but a Windows build is **unverified**. *Workaround:* WSL.
3. **DM + plain Canton OSS is an untested topology.** DM tests target Splice LocalNet and a real DevNet cluster. Possible surprises:
   - participant auto-init vs Splice's manual init;
   - synchronizer bootstrap parameters;
   - reward-automation and `/network-info` errors without Splice (expected to be non-fatal) [VERIFY].
4. **WSL is "Stopped".** Starting it is required, and PostgreSQL 16 there is the only persistent DB.
5. **Toolchain downloads needed:** Canton OSS (≈ 282 MB), JRE in WSL, `dpm` + SDK 3.4.11, and either a Rust build toolchain in WSL or the ECR layer (≈ 20 MB).
6. **Resource use:** one JVM hosting 3 participants + sequencer + mediator, plus 3 DM processes. Several GB of RAM [INFERRED].
7. **Custom proposals bypass DM's propose endpoint**, so the "propose" step is Collara's own Ledger API call; only confirm/execute/list go through DM. That is the documented "Path B", not a hack (CUSTOM_DAML_TEMPLATES.md L448-460).
8. **Availability coupling:** every governance confirm/execute, and probably every accreditation fetch, needs ≥ P2P-threshold member participants online [INFERRED].
9. **Honesty constraint (brief §8):** three participants in one Canton JVM and three DM nodes on one laptop, all run by one person, demonstrate the *mechanism*, not independent operators. Say so in the UI and docs.

### 10.5 Tiered plan

| Tier | What runs | Claims allowed |
|---|---|---|
| **A** (always possible, early) | Collara DAR + DM `governance-core-v1` DARs on any single participant (sandbox or Collara LocalNet). Governance party is a plain local party; 3 member parties. | "2-of-3 quorum enforced by DM's audited `GovernanceRules` contract on-ledger; decentralized-party topology **not** demonstrated." Mark the BitSafe module **partial**. |
| **B** (target) | §10.3: Canton OSS 3.5.8 × 3 participants in WSL + 3 DM v1.12.0 nodes + decentralized party + GovernanceRules through `/contracts` | "Real DM integration on a local 3-node topology; one operator runs all nodes." |
| **C** (blocked) | Splice LocalNet 0.6.12 via Docker, exactly DM's CI setup | n/a on this machine |

The Collara code (Daml templates, backend adapter) is identical across Tiers A and B. Only party ids, the rules cid and the endpoint config differ, so start with A and promote to B.

---

## 11. Open questions / to verify on a running node
1. Does DM v1.12.0 operate correctly against Canton OSS 3.5.8 configured by hand (no Splice)? Look for onboarding topology propagation, `/contracts` interactive submission and the DAR distribution vetting state.
2. Does the `/contracts` serializer accept an empty `party_set` (registry bootstrap option (a))?
3. Exact Canton 3.5 bootstrap console commands and the PV 35 static parameters for a fresh synchronizer.
4. Is the decentralized party a *confirming* party when a verifier fetches a governance-signed `VerifierAccreditation`? This affects attestation availability and privacy (§7.3).
5. Can SDK 3.5.x (if the Collara core model uses it) data-depend on LF 2.2 `governance-action-v1` without changing the interface package id? This is moot if Collara pins 3.4.11.
6. Does `dpm` (SDK 3.4.11) run natively on Windows, or must Daml builds happen in WSL?
7. JSON Ledger API v2 envelope for `submit-and-wait-for-transaction` on 3.5.8: confirm against the node's `/docs/openapi`.
8. In v1.12.0 the confirmations feed did not pass the rules' member set into the domain-action count (fixed after the tag, at `63a7898`). In v1.12.0 the UI `can_execute` may count a removed member's confirmation; the on-ledger execute still rejects it. Pin v1.12.0, or pin HEAD `63a7898` if this matters.

## 12. Files read (for traceability)
- `README.md` (full)
- `docs/CUSTOM_DAML_TEMPLATES.md` (full)
- `docs/ARCHITECTURE.md` (§Core Concepts, Components, Trust model, Workflows, Governance System, Technical Constraints)
- `docs/DEPLOYMENT_GUIDE.md` (§§1-5, config reference)
- `docs/USE_CASES.md` (§Generic Voting)
- `docs/CONTRIBUTING.md` (§Development setup)
- `docs/SECURITY.md`, `docs/audit-acknowledgements.md`, `USER_GUIDE.md` (skim), `NOTICE`
- `daml/multi-package.yaml` and every `daml/*/daml.yaml`
- `daml/governance-action-v1/daml/Governance/Action.daml`
- `daml/governance-core/daml/Governance/{Rules,Confirmation,ExecutionResult,GenericVote}.daml`
- `daml/orphan-marker/daml/OrphanMarker.daml`
- `daml/governance-core-test/daml/Governance/TestUtils.daml`, plus `Test/AuthorizationTest.daml` L112-140 and `Test/ExecutionTest.daml` L143-178
- `crates/decman/src/server/handlers/governance.rs` (propose / confirm / execute / ledger submission)
- `crates/decman-lib/src/catalog/{commands,templates}.rs`, `crates/decman-lib/src/framework/commands.rs`, `crates/decman-lib/src/catalog/interpret.rs` L593-680
- `crates/decman/src/server/queries.rs` L520-700 and L853-887
- `crates/decman/src/config.rs` L401-468, `consts.rs` L155-170
- `crates/decman/src/auth/mock.rs`, `auth/validators/mock.rs`, `utils.rs` L330-361
- `crates/decman/src/workflow/onboarding/steps/proposals/create.rs` L135-260
- `crates/decman/tests/common/phases/deploy_gov_core.rs`
- `integration-tests/{env.sh,common.sh,bring-up.sh}`
- `.github/workflows/ci.yml`, `.github/actions/setup-build-env/action.yml`
- `Cargo.toml`, `crates/decman/Cargo.toml`, `crates/decman/build.rs`, `Dockerfile`, `development/{Dockerfile,docker-compose.yml}`, `crates/decman/frontend/package.json`
- External: GitHub API (DM releases, compare, commits); Splice `v0.6.12` `nix/canton-sources.json`, `nix/dpm-sdk-sources.json`, `cluster/compose/localnet/conf/canton/{app.conf,app-provider/app.conf,app-provider/app-auth.conf}`, `env/*.env`; Splice `v0.8.4` `nix/*.json`; Canton OSS releases v3.5.8 and v3.5.19 assets; public ECR manifest for `decentralization-manager:v1.12.0`.
