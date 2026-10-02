// Tier A governance (DM GovernanceRules 2-of-3) and the verifier registry: write path (service.ts), fresh ledger
// reads (ledger.ts), pure DM rules (rules.ts) and the read path (read.ts). Routes: src/routes/workflow/governance.ts.
export { governedProposalHistory, openProposals, readGovernanceLedger, type ActiveProposal, type GovernanceLedger, type ProposalHistoryEntry } from "./ledger";
export { isSeatHolder, UNPROJECTED_GOVERNANCE, verifierDirectory } from "./read";
export {
  ACCREDITATION_VALID_DAYS,
  executableConfirmations,
  GOVERNANCE_COPY,
  governanceProposalRef,
  LEDGER_SCOPE,
  ledgerScopeOf,
  PROPOSAL_DEADLINE_DAYS,
  proposalStaleness,
  type ConfirmationLike,
  type Staleness,
} from "./rules";
export { GovernanceService, type ConfirmResult, type ExecuteResult, type GovernanceServiceOptions, type ProposeResult, type RegistrarSyncState } from "./service";
