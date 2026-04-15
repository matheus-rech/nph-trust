// ============================================================
// NPH-Trust Value Layer — Type Definitions
// ============================================================
// Defines the interfaces for translating attestation-backed
// clinical events into blockchain-verifiable value primitives.
//
// These types are DESIGN-ONLY. No runtime implementation yet.
// They integrate with existing:
//   - Attestation model (lib/attestation-service.ts)
//   - Provenance graph (lib/provenance.ts)
//   - BlockchainProvider interface (lib/blockchain/types.ts)
//   - Pipeline orchestrator (lib/pipeline/)
//
// Three use-case domains:
//   1. Outcome-based funding (OBF)
//   2. Verifiable real-world evidence (vRWE)
//   3. Research contribution / reputation (RCR)
// ============================================================

// ── Shared Foundation ────────────────────────────────────────

/**
 * Reference to an on-chain anchor without exposing PHI.
 * Every value-layer operation ultimately resolves to one or more
 * attestation anchors. This is the link between off-chain clinical
 * data and on-chain proofs.
 */
export interface OnChainRef {
  /** Attestation ID in NPH-Trust database */
  attestationId: string;
  /** Hash that was (or will be) anchored */
  payloadHash: string;
  /** Chain where the anchor lives (null if unanchored) */
  chainId: string | null;
  /** Transaction reference (null if unanchored) */
  txHash: string | null;
  /** Block number (null if unanchored) */
  blockNumber: number | null;
  /** Timestamp of the anchor (null if unanchored) */
  anchorTimestamp: string | null;
}

/**
 * Verifiable claim: a statement that can be independently checked
 * by resolving its attestation chain. The claim itself contains
 * no PHI — only hashes and references.
 */
export interface VerifiableClaim {
  /** Unique claim identifier */
  claimId: string;
  /** Human-readable label */
  label: string;
  /** What domain this claim belongs to */
  domain: 'outcome' | 'evidence' | 'contribution';
  /** The attestation(s) backing this claim */
  attestationRefs: OnChainRef[];
  /** Provenance node IDs that form the evidence chain */
  provenanceNodeIds: string[];
  /** Project scope */
  projectId: string;
  /** When the claim was assembled */
  createdAt: string;
  /** Whether all attestations are anchored on-chain */
  fullyAnchored: boolean;
}

// ============================================================
// 1. OUTCOME-BASED FUNDING (OBF)
// ============================================================

/**
 * A milestone is a clinically significant pathway event (or
 * combination of events) that funders recognize as a payable
 * outcome. Milestones map directly to PathwayStageDefinition
 * types and PathwayEvent statuses.
 *
 * Example:
 *   "Shunt intervention completed" = SHUNT_INTERVENTION + COMPLETED
 *   "6-month follow-up with improvement" = FOLLOW_UP + COMPLETED + data.outcome === 'IMPROVED'
 */
export interface FundingMilestone {
  /** Unique milestone identifier within an agreement */
  milestoneId: string;
  /** Human-readable description */
  label: string;
  /**
   * Conditions that must ALL be true for the milestone to be met.
   * Evaluated against PathwayEvent + Attestation + Approval records.
   */
  conditions: MilestoneCondition[];
  /**
   * Payment amount in the agreement's base currency.
   * Denominated off-chain — blockchain only stores the
   * proof-of-milestone, not the payment itself.
   */
  paymentAmount: number;
  /** ISO 4217 currency code */
  paymentCurrency: string;
  /** Whether the milestone can be claimed multiple times (e.g., per-patient) */
  isRecurring: boolean;
  /** Maximum total claims if recurring */
  maxClaims?: number;
}

/**
 * A single condition that must be satisfied for a milestone.
 * Conditions are composable — multiple conditions form an AND.
 */
export type MilestoneCondition =
  | StageCompletionCondition
  | AttestationExistsCondition
  | ApprovalGrantedCondition
  | DataFieldCondition
  | AnchorConfirmedCondition
  | TimeWindowCondition;

/** Pathway stage must be COMPLETED */
export interface StageCompletionCondition {
  type: 'stage_completed';
  /** PathwayStageDefinition.stageType */
  stageType: string;
  /** Required status (typically COMPLETED) */
  requiredStatus: 'COMPLETED';
}

/** An attestation must exist for the event */
export interface AttestationExistsCondition {
  type: 'attestation_exists';
  /** Event type that must have been attested */
  eventType: string;
  /** Minimum attestation status */
  minimumStatus: 'SIGNED' | 'ANCHORED';
}

/** An approval must have been granted */
export interface ApprovalGrantedCondition {
  type: 'approval_granted';
  /** Approval target type */
  targetType: string;
  /** Required approval status */
  requiredStatus: 'APPROVED';
}

/**
 * A specific field in the event's data payload must match.
 * Used for outcome-conditional milestones:
 *   e.g., data.outcome === 'IMPROVED'
 *
 * The actual field value is NEVER placed on-chain.
 * The verifier checks the attestation hash covers the data
 * and then resolves the condition off-chain.
 */
export interface DataFieldCondition {
  type: 'data_field';
  /** Dot-notation path into PathwayEvent.data JSON */
  fieldPath: string;
  /** Comparison operator */
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in';
  /** Expected value(s) */
  value: unknown;
}

/** The attestation must be confirmed on-chain */
export interface AnchorConfirmedCondition {
  type: 'anchor_confirmed';
  /** Minimum anchor age (seconds) — optional finality window */
  minAgeSeconds?: number;
}

/** Milestone must be claimed within a time window */
export interface TimeWindowCondition {
  type: 'time_window';
  /** Relative to the triggering event's completedAt */
  afterDays?: number;
  /** Deadline */
  beforeDays?: number;
}

/**
 * A funding agreement between a funder and the registry.
 * This is the off-chain representation — the smart contract
 * mirrors the milestone structure but stores only hashes.
 */
export interface FundingAgreement {
  agreementId: string;
  /** Descriptive name */
  name: string;
  /** Funder identity (institution, not individual) */
  funderId: string;
  funderName: string;
  /** Project scope */
  projectId: string;
  /** Milestones that can trigger payments */
  milestones: FundingMilestone[];
  /** Agreement status */
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  /** Total budget cap */
  totalBudget: number;
  budgetCurrency: string;
  /** Amount already released */
  totalReleased: number;
  /** Validity window */
  validFrom: string;
  validUntil: string;
  /** On-chain contract address (null if not deployed) */
  contractAddress: string | null;
  chainId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A milestone claim: asserts that a specific patient episode
 * has satisfied all conditions for a milestone.
 *
 * The claim references attestation IDs and provenance node IDs
 * but NEVER includes patient-identifying information.
 */
export interface MilestoneClaim {
  claimId: string;
  agreementId: string;
  milestoneId: string;
  /** Episode reference — the pseudo ID, NOT the patient identity */
  episodePseudoId: string;
  /** Evidence chain */
  evidence: MilestoneEvidence;
  /** Evaluation result */
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'PAID' | 'EXPIRED';
  /** Amount to be released upon verification */
  claimAmount: number;
  claimCurrency: string;
  /** Verifier who checked the conditions */
  verifiedById: string | null;
  verifiedAt: string | null;
  /** On-chain transaction for payment release (null if not yet triggered) */
  paymentTxRef: string | null;
  createdAt: string;
}

/**
 * Evidence collected for a milestone claim.
 * This is what gets verified — either by an oracle or
 * a human auditor with system access.
 */
export interface MilestoneEvidence {
  /** Attestation references covering each condition */
  attestationRefs: OnChainRef[];
  /** Provenance lineage node IDs forming the evidence chain */
  provenanceChainIds: string[];
  /** Per-condition evaluation results */
  conditionResults: {
    condition: MilestoneCondition;
    satisfied: boolean;
    attestationId: string | null;
    note: string | null;
  }[];
  /** Whether all evidence attestations are fully anchored */
  fullyAnchored: boolean;
}

// ============================================================
// 2. VERIFIABLE REAL-WORLD EVIDENCE (vRWE)
// ============================================================

/**
 * Represents a dataset snapshot that has been hashed and
 * optionally anchored. Used to prove that a specific dataset
 * existed at a specific time with a specific content hash.
 *
 * Maps directly to existing Checkpoint model + export pipeline.
 */
export interface DatasetAnchor {
  /** Reference to the Checkpoint or export that produced the hash */
  sourceType: 'checkpoint' | 'export';
  sourceId: string;
  /** Content hash (SHA-256 of canonical data) */
  contentHash: string;
  /** On-chain reference */
  anchor: OnChainRef;
  /** Metadata that IS safe to publish (no PHI) */
  publicMetadata: {
    projectId: string;
    format: 'json' | 'csv';
    episodeCount: number;
    lockedEventCount: number;
    totalEventCount: number;
    snapshotVersion?: number;
  };
}

/**
 * Represents a computational analysis run performed on a dataset.
 * The analysis itself happens off-chain, but its inputs and outputs
 * are anchored for reproducibility.
 *
 * Future: App 2 (manuscript generation) will produce these.
 */
export interface AnalysisRunAnchor {
  analysisId: string;
  /** What was analyzed */
  inputDatasetAnchors: DatasetAnchor[];
  /** Hash of the analysis code/configuration */
  analysisCodeHash: string;
  /** Hash of the analysis output */
  outputHash: string;
  /** Attestation covering the full run */
  runAttestation: OnChainRef;
  /** Human-readable description */
  description: string;
  /** Who executed the analysis */
  executedById: string;
  executedAt: string;
}

/**
 * A manuscript claim links a specific statement in a publication
 * to one or more on-chain proofs. This enables reviewers and
 * readers to verify that claimed results are backed by
 * cryptographically anchored data.
 *
 * Example:
 *   "73% of patients showed gait improvement at 6 months"
 *   → links to: dataset anchor (checkpoint hash) +
 *     analysis run anchor + specific attestation for FOLLOW_UP events
 */
export interface ManuscriptClaim {
  /** Unique identifier for this claim */
  claimId: string;
  /** The statement being made (no PHI) */
  statement: string;
  /** Section/paragraph reference in the manuscript */
  manuscriptRef: {
    manuscriptId: string;
    section: string;
    paragraphIndex?: number;
  };
  /** Evidence backing the claim */
  evidence: {
    /** Dataset snapshots used */
    datasetAnchors: DatasetAnchor[];
    /** Analysis runs that produced the result */
    analysisRuns: AnalysisRunAnchor[];
    /** Individual attestations referenced */
    attestationRefs: OnChainRef[];
    /** Provenance chain connecting data → analysis → claim */
    provenanceChainIds: string[];
  };
  /** Verification status */
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'CHALLENGED' | 'RETRACTED';
  /** Who verified this claim */
  verifiedById: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

/**
 * A verification challenge against a manuscript claim.
 * Allows third parties to flag discrepancies.
 */
export interface ClaimChallenge {
  challengeId: string;
  targetClaimId: string;
  challengerType: 'reviewer' | 'replicator' | 'auditor';
  /** Description of the discrepancy (no PHI) */
  description: string;
  /** Evidence the challenger provides */
  challengeEvidence: {
    /** Challenger's own attestation of the discrepancy */
    challengeAttestationRef: OnChainRef | null;
    /** Specific condition that failed */
    failedCondition: string | null;
  };
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'UPHELD';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ============================================================
// 3. RESEARCH CONTRIBUTION / REPUTATION (RCR)
// ============================================================

/**
 * Contribution types that can be attested on-chain.
 * Each maps to existing system events.
 */
export type ContributionType =
  | 'data_collection'          // Created pathway events with clinical data
  | 'data_validation'          // Approved/reviewed data quality
  | 'data_curation'            // Import + transform + quality checks
  | 'analysis_execution'       // Ran reproducible analysis (future: App 2)
  | 'manuscript_authoring'     // Authored manuscript sections (future: App 2)
  | 'peer_review'              // Reviewed and validated claims
  | 'attestation_verification' // Independently verified attestation integrity
  | 'site_coordination'        // Managed multi-site data collection
  | 'approval_review';         // Reviewed and decided approval requests

/**
 * A contribution record links a user's action to the attestation
 * that proves it happened. Contributions are the raw material
 * for reputation scoring.
 */
export interface ContributionRecord {
  contributionId: string;
  /** User who made the contribution */
  contributorId: string;
  /** What they did */
  contributionType: ContributionType;
  /** Project scope */
  projectId: string;
  /** Attestation proving the contribution */
  attestationRef: OnChainRef;
  /** Provenance nodes involved */
  provenanceNodeIds: string[];
  /**
   * Weight/significance of this contribution.
   * Determined by rules engine, NOT by the contributor.
   * Range: 0.0 to 1.0
   */
  weight: number;
  /** How the weight was calculated */
  weightRationale: string;
  /** When the contribution occurred */
  occurredAt: string;
  /** When it was recorded in the reputation system */
  recordedAt: string;
}

/**
 * Maps system events to contribution types.
 * Used by the contribution extraction engine to automatically
 * generate ContributionRecords from pipeline results.
 */
export interface ContributionMapping {
  /** Pipeline event type (from attestation.eventType) */
  eventType: string;
  /** What contribution this maps to */
  contributionType: ContributionType;
  /** Base weight for this type of contribution */
  baseWeight: number;
  /** Role that typically makes this contribution */
  expectedRole: string;
  /** Additional conditions (e.g., only count if approval was APPROVED) */
  conditions?: MilestoneCondition[];
}

/**
 * Default event → contribution mappings for the NPH-Trust system.
 * These define how existing system events generate reputation signals.
 */
export const DEFAULT_CONTRIBUTION_MAPPINGS: ContributionMapping[] = [
  {
    eventType: 'pathway_event_completed',
    contributionType: 'data_collection',
    baseWeight: 0.3,
    expectedRole: 'RESEARCHER',
  },
  {
    eventType: 'pathway_event_created',
    contributionType: 'data_collection',
    baseWeight: 0.1,
    expectedRole: 'RESEARCHER',
  },
  {
    eventType: 'approval_granted',
    contributionType: 'approval_review',
    baseWeight: 0.4,
    expectedRole: 'COORDINATOR',
  },
  {
    eventType: 'approval_rejected',
    contributionType: 'approval_review',
    baseWeight: 0.3,
    expectedRole: 'COORDINATOR',
  },
  {
    eventType: 'import_completed',
    contributionType: 'data_curation',
    baseWeight: 0.5,
    expectedRole: 'RESEARCHER',
  },
  {
    eventType: 'checkpoint_created',
    contributionType: 'data_curation',
    baseWeight: 0.4,
    expectedRole: 'COORDINATOR',
  },
  {
    eventType: 'data_exported',
    contributionType: 'data_curation',
    baseWeight: 0.2,
    expectedRole: 'RESEARCHER',
  },
  {
    eventType: 'manual_attestation',
    contributionType: 'attestation_verification',
    baseWeight: 0.3,
    expectedRole: 'AUDITOR',
  },
];

/**
 * Aggregated reputation profile for a user.
 * Reputation is project-scoped — a user's reputation in one
 * project is independent of another.
 */
export interface ReputationProfile {
  userId: string;
  projectId: string;
  /** Total weighted contribution score */
  totalScore: number;
  /** Breakdown by contribution type */
  breakdown: Record<ContributionType, {
    count: number;
    totalWeight: number;
  }>;
  /** How many of the user's contributions are fully anchored */
  anchoredContributions: number;
  totalContributions: number;
  /** On-chain reputation attestation (if published) */
  reputationAnchor: OnChainRef | null;
  /** When the profile was last computed */
  computedAt: string;
}

/**
 * Reputation attestation input — what gets hashed and signed
 * when a user's reputation is published on-chain.
 * Contains NO user-identifying information — only the user's
 * system ID and aggregated metrics.
 */
export interface ReputationAttestationPayload {
  /** User's internal ID (not PII) */
  userId: string;
  projectId: string;
  /** Reputation score at time of attestation */
  totalScore: number;
  /** Number of contributions included */
  contributionCount: number;
  /** Hash of all contribution IDs included */
  contributionMerkleRoot: string;
  /** When the reputation was computed */
  computedAt: string;
}

// ============================================================
// SMART CONTRACT INTERFACES (Conceptual)
// ============================================================
// These describe what on-chain contracts would expose.
// No Solidity implementation yet — these define the API surface.
// ============================================================

/**
 * Conceptual interface for the Attestation Registry contract.
 * This is the foundational on-chain component that all three
 * use cases build upon.
 */
export interface IAttestationRegistryContract {
  /**
   * Store an attestation hash on-chain.
   * @param hash - SHA-256 hash of the canonical payload
   * @param eventType - Classification of what was attested
   * @returns Transaction reference
   */
  anchor(hash: string, eventType: string): Promise<string>;

  /**
   * Verify that a hash exists on-chain.
   * @param hash - The hash to verify
   * @returns Whether the hash was found and when it was anchored
   */
  verify(hash: string): Promise<{ exists: boolean; anchoredAt: number | null; blockNumber: number | null }>;

  /**
   * Batch-anchor multiple hashes in one transaction (gas optimization).
   * @param entries - Array of { hash, eventType }
   * @returns Transaction reference
   */
  batchAnchor(entries: { hash: string; eventType: string }[]): Promise<string>;
}

/**
 * Conceptual interface for the Outcome Funding contract.
 * Manages escrow and milestone-based payment release.
 *
 * The contract itself does NOT evaluate clinical conditions.
 * An oracle (authorized backend) submits verified milestone
 * claims; the contract releases funds.
 */
export interface IOutcomeFundingContract {
  /**
   * Register a new funding agreement.
   * @param agreementHash - Hash of the full agreement terms
   * @param milestoneHashes - Hash of each milestone's conditions
   * @param totalBudget - Total escrow amount (in wei/smallest unit)
   */
  registerAgreement(
    agreementHash: string,
    milestoneHashes: string[],
    totalBudget: bigint,
  ): Promise<string>;

  /**
   * Submit a verified milestone claim for payment release.
   * Only callable by authorized oracle address.
   * @param agreementHash - The agreement this claim belongs to
   * @param milestoneHash - Which milestone was met
   * @param evidenceHash - Hash of the MilestoneEvidence object
   * @param amount - Payment amount to release
   */
  submitMilestoneClaim(
    agreementHash: string,
    milestoneHash: string,
    evidenceHash: string,
    amount: bigint,
  ): Promise<string>;

  /**
   * Check the remaining budget for an agreement.
   */
  getRemainingBudget(agreementHash: string): Promise<bigint>;

  /**
   * Get all milestone claims for an agreement.
   */
  getMilestoneClaims(agreementHash: string): Promise<{
    milestoneHash: string;
    evidenceHash: string;
    amount: bigint;
    claimedAt: number;
    txHash: string;
  }[]>;
}

/**
 * Conceptual interface for the Reputation Registry contract.
 * Stores aggregated reputation proofs — NOT individual contributions.
 */
export interface IReputationRegistryContract {
  /**
   * Publish a reputation attestation.
   * @param userId - Internal user ID (not PII)
   * @param reputationHash - Hash of ReputationAttestationPayload
   * @param score - The reputation score (scaled integer)
   * @param contributionCount - Number of contributions
   */
  publishReputation(
    userId: string,
    reputationHash: string,
    score: number,
    contributionCount: number,
  ): Promise<string>;

  /**
   * Verify a user's reputation attestation.
   */
  verifyReputation(userId: string): Promise<{
    exists: boolean;
    reputationHash: string | null;
    score: number;
    publishedAt: number | null;
  }>;
}
