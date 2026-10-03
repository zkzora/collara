// Sharing (owner share, dealer consent, lender review opening, share revocation, share-based evidence access).
// Other route modules may call `ensureLenderAssessment` (the M18 trigger).
export { ensureLenderAssessment, REVIEW_OPEN_OPERATION, type EnsureLenderAssessmentInput } from "./assessment";
export { activeShareCoverage, presentSharedEvidence, sharedDownloadVersion, type ShareCoverage } from "./evidence-access";
export { decideConsent, withdrawConsent, type ConsentDecisionInput } from "./consent";
export { DEALER_DECLINE_REASON, revokeShare, type RevokeInput } from "./grants";
export { DEFAULT_SHARE_DAYS, dealerConsent, recordContributions, SHARE_PURPOSE, shareWithLender, type ShareInput } from "./share";
