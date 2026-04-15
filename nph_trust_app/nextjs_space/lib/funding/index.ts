// ============================================================
// NPH-Trust Outcome-Based Funding Layer — Barrel Export
// ============================================================

export {
  MilestoneType,
  MILESTONE_LABELS,
  DEFAULT_EVENT_MILESTONE_MAPPINGS,
} from './types';

export type {
  EventToMilestoneMapping,
  PayMilestoneParams,
  ContractTxResult,
  FundingClaimStatus,
  PayoutAttemptStatus,
  EligibilityCheckInput,
  EligibilityCheckResult,
  PayoutSubmissionInput,
  PayoutSubmissionResult,
  FundingVaultProvider,
  FundingProvenanceBinding,
} from './types';

export { NullFundingProvider } from './null-funding-provider';
export { FundingPayoutService } from './payout-service';
