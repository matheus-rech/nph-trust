// ============================================================
// NPH-Trust Value Layer — Barrel Export
// ============================================================

export type {
  // Foundation
  OnChainRef,
  VerifiableClaim,

  // Outcome-Based Funding
  FundingMilestone,
  MilestoneCondition,
  StageCompletionCondition,
  AttestationExistsCondition,
  ApprovalGrantedCondition,
  DataFieldCondition,
  AnchorConfirmedCondition,
  TimeWindowCondition,
  FundingAgreement,
  MilestoneClaim,
  MilestoneEvidence,

  // Verifiable Real-World Evidence
  DatasetAnchor,
  AnalysisRunAnchor,
  ManuscriptClaim,
  ClaimChallenge,

  // Research Contribution / Reputation
  ContributionType,
  ContributionRecord,
  ContributionMapping,
  ReputationProfile,
  ReputationAttestationPayload,

  // Smart Contract Interfaces (Conceptual)
  IAttestationRegistryContract,
  IOutcomeFundingContract,
  IReputationRegistryContract,
} from './types';

export { DEFAULT_CONTRIBUTION_MAPPINGS } from './types';
