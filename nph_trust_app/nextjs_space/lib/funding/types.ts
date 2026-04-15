// ============================================================
// NPH-Trust Outcome-Based Funding Layer — TypeScript Types
// ============================================================
// Mirrors the NphOutcomeFundingVault contract structures and
// defines the off-chain service layer interfaces.
// ============================================================

import type { OnChainRef } from '../value-layer/types';

// ============================================================
// 1. MILESTONE TYPE ENUM (mirrors Solidity MilestoneType)
// ============================================================

/**
 * On-chain milestone type identifiers.
 * Ordinal values MUST match the Solidity enum exactly.
 */
export enum MilestoneType {
  SCREENING_COMPLETED = 0,
  IMAGING_COMPLETED = 1,
  SPECIALIST_REVIEW_COMPLETED = 2,
  CSF_TEST_COMPLETED = 3,
  SHUNT_PERFORMED = 4,
  FOLLOWUP_3M_COMPLETED = 5,
  VALIDATED_IMPROVEMENT_RECORDED = 6,
}

/** Human-readable labels for milestone types */
export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  [MilestoneType.SCREENING_COMPLETED]: 'Symptom Screening Completed',
  [MilestoneType.IMAGING_COMPLETED]: 'Imaging Completed',
  [MilestoneType.SPECIALIST_REVIEW_COMPLETED]: 'Specialist Review Completed',
  [MilestoneType.CSF_TEST_COMPLETED]: 'CSF Test Completed',
  [MilestoneType.SHUNT_PERFORMED]: 'Shunt Intervention Performed',
  [MilestoneType.FOLLOWUP_3M_COMPLETED]: '3-Month Follow-Up Completed',
  [MilestoneType.VALIDATED_IMPROVEMENT_RECORDED]: 'Validated Improvement Recorded',
};

// ============================================================
// 2. EVENT → MILESTONE MAPPING
// ============================================================

/**
 * Maps NPH-Trust PathwayStageType + status to contract MilestoneType.
 * Used by the payout service to resolve which milestone a pathway
 * event satisfies.
 */
export interface EventToMilestoneMapping {
  stageType: string;
  requiredStatus: 'COMPLETED';
  milestoneType: MilestoneType;
  /** Additional conditions on PathwayEvent.data (optional) */
  dataConditions?: {
    fieldPath: string;
    operator: 'eq' | 'in';
    value: unknown;
  }[];
}

/**
 * Default event-to-milestone mappings for iNPH pathway.
 * VALIDATED_IMPROVEMENT_RECORDED requires a data condition.
 */
export const DEFAULT_EVENT_MILESTONE_MAPPINGS: EventToMilestoneMapping[] = [
  {
    stageType: 'SYMPTOM_SCREENING',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.SCREENING_COMPLETED,
  },
  {
    stageType: 'IMAGING',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.IMAGING_COMPLETED,
  },
  {
    stageType: 'SPECIALIST_REVIEW',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.SPECIALIST_REVIEW_COMPLETED,
  },
  {
    stageType: 'CSF_TESTING',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.CSF_TEST_COMPLETED,
  },
  {
    stageType: 'SHUNT_INTERVENTION',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.SHUNT_PERFORMED,
  },
  {
    stageType: 'FOLLOW_UP',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.FOLLOWUP_3M_COMPLETED,
  },
  {
    stageType: 'FOLLOW_UP',
    requiredStatus: 'COMPLETED',
    milestoneType: MilestoneType.VALIDATED_IMPROVEMENT_RECORDED,
    dataConditions: [
      { fieldPath: 'outcome', operator: 'eq', value: 'IMPROVED' },
    ],
  },
];

// ============================================================
// 3. CONTRACT INTERACTION TYPES
// ============================================================

/** Parameters for calling payMilestone on the contract */
export interface PayMilestoneParams {
  claimId: string;        // bytes32 hex
  programId: string;      // bytes32 hex
  siteId: string;         // bytes32 hex
  episodeRef: string;     // bytes32 hex
  milestoneType: MilestoneType;
  attestationHash: string; // bytes32 hex
  recipient: string;       // Ethereum address
}

/** Result of a contract transaction */
export interface ContractTxResult {
  success: boolean;
  txHash: string | null;
  blockNumber: number | null;
  gasUsed: number | null;
  error: string | null;
  /** On-chain timestamp if available */
  timestamp: number | null;
}

// ============================================================
// 4. FUNDING SERVICE INTERFACES
// ============================================================

/** Lifecycle of a funding claim */
export type FundingClaimStatus =
  | 'ELIGIBLE'         // Conditions met, not yet submitted
  | 'PENDING_SUBMIT'   // Queued for on-chain submission
  | 'SUBMITTED'        // Transaction sent, waiting for confirmation
  | 'CONFIRMED'        // Transaction confirmed on-chain
  | 'FAILED'           // Transaction failed or reverted
  | 'REJECTED'         // Eligibility check failed
  | 'MOCK_APPROVED'    // Approved in mock/disabled-chain mode
  | 'DUPLICATE';       // Already paid (replay detected)

/** Lifecycle of a payout attempt */
export type PayoutAttemptStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REVERTED';

/** Input for the eligibility check service */
export interface EligibilityCheckInput {
  projectId: string;
  episodeId: string;
  milestoneType: MilestoneType;
  programId: string;
}

/** Result of an eligibility check */
export interface EligibilityCheckResult {
  eligible: boolean;
  reason: string;
  /** The attestation that proves this milestone (if eligible) */
  attestation: {
    id: string;
    payloadHash: string;
    status: string;
    provenanceNodeId: string | null;
    eventType: string;
  } | null;
  /** The pathway event that triggered the milestone (if eligible) */
  pathwayEvent: {
    id: string;
    stageType: string;
    status: string;
    completedAt: string | null;
  } | null;
  /** Whether a payout for this combination already exists */
  alreadyPaid: boolean;
  /** Whether this attestation hash was already used */
  attestationAlreadyUsed: boolean;
}

/** Input for the payout submission service */
export interface PayoutSubmissionInput {
  claimId: string;
  programId: string;
  siteId: string;
  episodeRef: string;
  milestoneType: MilestoneType;
  attestationHash: string;
  recipient: string;
  /** Amount in token decimals (from milestone config) */
  amount: string;
}

/** Result of a payout submission */
export interface PayoutSubmissionResult {
  claimId: string;
  status: FundingClaimStatus;
  txResult: ContractTxResult | null;
  /** If blockchain is disabled, this is a mock result */
  isMock: boolean;
  error: string | null;
}

// ============================================================
// 5. FUNDING VAULT PROVIDER INTERFACE
// ============================================================

/**
 * Abstraction over the on-chain NphOutcomeFundingVault contract.
 * Mirrors the BlockchainProvider pattern — allows NullFundingProvider
 * for mock/disabled-chain mode.
 */
export interface FundingVaultProvider {
  readonly chainId: string;
  readonly contractAddress: string | null;

  /** Check if the provider is connected and available */
  isAvailable(): Promise<boolean>;

  /** Submit a milestone payout transaction */
  payMilestone(params: PayMilestoneParams): Promise<ContractTxResult>;

  /** Check if a claim has been paid on-chain */
  isMilestonePaid(
    programId: string,
    siteId: string,
    episodeRef: string,
    milestoneType: MilestoneType,
  ): Promise<boolean>;

  /** Check if an attestation hash has been used on-chain */
  isAttestationUsed(attestationHash: string): Promise<boolean>;

  /** Get program details from the contract */
  getProgram(programId: string): Promise<{
    token: string;
    treasuryBalance: string;
    totalDeposited: string;
    totalPaidOut: string;
    active: boolean;
  } | null>;
}

// ============================================================
// 6. PROVENANCE INTEGRATION
// ============================================================

/**
 * Describes how a funding claim links to the provenance graph.
 * This is stored in FundingClaim.provenanceBinding.
 */
export interface FundingProvenanceBinding {
  /** The attestation that proves the milestone */
  attestationId: string;
  attestationHash: string;
  /** The provenance node for the attestation */
  attestationProvenanceNodeId: string | null;
  /** The pathway event that triggered the milestone */
  pathwayEventId: string;
  /** Provenance nodes in the evidence chain */
  provenanceNodeIds: string[];
  /** The on-chain anchor (if anchored) */
  onChainRef: OnChainRef | null;
}
