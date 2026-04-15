// ============================================================
// NPH-Trust Core Type Definitions
// ============================================================

// ── Attestation Types ──────────────────────────────────────

export type AttestationEventType =
  | 'pathway_event_created'
  | 'pathway_event_completed'
  | 'pathway_event_status_changed'
  | 'import_job_completed'
  | 'checkpoint_created'
  | 'approval_granted'
  | 'approval_rejected'
  | 'data_exported'
  | 'output_generated'
  | 'data_transform'
  | 'manual_attestation';

export type AttestationStatusType =
  | 'DRAFT'
  | 'HASHED'
  | 'SIGNED'
  | 'ANCHOR_PENDING'
  | 'ANCHORED'
  | 'FAILED'
  | 'REVERIFIED';

export type PathwayEventStatusType =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'FAILED';

export interface AttestationPayload {
  /** Deterministic fields only — no timestamps in payload body */
  schemaVersion: string;
  eventType: AttestationEventType;
  subjectType: string;
  subjectId: string;
  projectId: string;
  canonicalData: Record<string, unknown>;
}

/**
 * Target binding: every attestation MUST declare what it attests.
 * At least one of eventId or subjectId must be non-null.
 */
export interface AttestationTarget {
  subjectType: string;
  subjectId: string;
  eventId?: string;          // pathway event ID, if applicable
  sourceArtifactIds?: string[]; // input artifact IDs that contributed
}

export interface AttestationRecord {
  id: string;
  eventType: AttestationEventType;
  /** Strong binding: canonical object being attested */
  subjectType: string;
  subjectId: string;
  /** Strong binding: pathway event ID (if applicable) */
  pathwayEventId: string | null;
  /** Strong binding: provenance graph node for this attestation */
  provenanceNodeId: string | null;
  payloadHash: string;
  canonicalPayloadRef: string | null;
  signature: string | null;
  signerId: string | null;
  algorithmVersion: string;
  status: AttestationStatusType;
  txRef: AnchorRef | null;
  idempotencyKey: string | null;
  /** Strong binding: source artifact IDs that contributed */
  sourceArtifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AnchorRef {
  chainId: string;
  txHash: string;
  blockNumber: number | null;
  contractAddr: string | null;
  timestamp: string | null;
}

export interface AnchorRecord {
  attestationId: string;
  payloadHash: string;
  chainId: string;
  txHash: string;
  blockNumber: number | null;
  contractAddr: string;
  anchoredAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
}

export interface VerificationResult {
  attestationId: string;
  payloadHash: string;
  payloadIntegrity: boolean;
  signatureValid: boolean;
  anchorVerified: boolean | null;
  status: 'VERIFIED' | 'PAYLOAD_TAMPERED' | 'SIGNATURE_MISMATCH' | 'ANCHOR_MISMATCH' | 'UNANCHORED';
  verifiedAt: string;
  details: {
    recomputedHash: string;
    storedHash: string;
    algorithmVersion: string;
    anchorChainId?: string;
    anchorTxHash?: string;
  };
}

// ── Signing Types ──────────────────────────────────────────

export interface SigningResult {
  signature: string;
  signerId: string;
  algorithmVersion: string;
}

// ── Blockchain Provider Types ──────────────────────────────

export type TxRef = string;

export type AnchorStatus =
  | { state: 'PENDING'; txRef: TxRef }
  | { state: 'CONFIRMED'; txRef: TxRef; blockNumber: number; timestamp: string }
  | { state: 'FAILED'; txRef: TxRef; error: string }
  | { state: 'NOT_FOUND' };

export interface BlockchainProvider {
  /** Human-readable chain name */
  readonly chainId: string;
  /** Submit a hash to be anchored on-chain */
  submitAnchor(hash: string): Promise<TxRef>;
  /** Verify that a hash was anchored */
  verifyAnchor(hash: string): Promise<boolean>;
  /** Get the status of a previously submitted transaction */
  getStatus(tx: TxRef): Promise<AnchorStatus>;
  /** Health check */
  isAvailable(): Promise<boolean>;
}

export interface BlockchainProviderConfig {
  chainId: string;
  rpcUrl: string;
  contractAddress: string;
  privateKey?: string;
  gasLimitOverride?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

// ── Provenance / Execution Graph Types ─────────────────────

export type ProvenanceNodeKind = 'INPUT' | 'EVENT' | 'TRANSFORM' | 'OUTPUT' | 'ATTESTATION';

/**
 * Provenance origin classification:
 * - NATIVE: created in real-time by service calls (pathway-service, attestation-service, pipeline steps)
 * - IMPORT_RECONCILED: created during post-import batch reconciliation
 * - BACKFILLED: retrospectively reconstructed from historical data
 * - LEGACY_UNCLASSIFIED: pre-existing nodes with no origin flag (requires manual review)
 */
export type ProvenanceOrigin = 'NATIVE' | 'IMPORT_RECONCILED' | 'BACKFILLED' | 'LEGACY_UNCLASSIFIED';

/**
 * Metadata added to provenance nodes created by backfill.
 * MUST be present when origin === 'BACKFILLED'.
 */
export interface BackfillMetadata {
  /** Always true for backfilled nodes */
  backfilled: true;
  /** Source of the backfill data (e.g., 'seed_data', 'import_migration', 'manual_backfill') */
  backfillSource: string;
  /** When the backfill was executed */
  backfillTimestamp: string;
  /** Original created_at/occurred_at from the source record, if available */
  originalTimestamp?: string;
  /** Confidence level: 'HIGH' (direct DB record), 'MEDIUM' (inferred), 'LOW' (estimated) */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Optional note about what was reconstructed vs available */
  completenessNote?: string;
}

export interface ProvenanceNodeRecord {
  id: string;
  projectId: string;
  nodeType: ProvenanceNodeKind;
  label: string | null;
  entityType: string;
  entityId: string;
  attestationId: string | null;
  runLogId: string | null;
  metadata: (Record<string, unknown> & Partial<BackfillMetadata>) | null;
  timestamp: string;
  inputRefs: string[];   // IDs of parent ProvenanceNodes
  outputRefs: string[];  // IDs of child ProvenanceNodes
}

export interface ProvenanceEdgeRecord {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: string;
  metadata: Record<string, unknown> | null;
}

export interface ProvenanceGraph {
  nodes: ProvenanceNodeRecord[];
  edges: ProvenanceEdgeRecord[];
}

// ── Execution Log Types ────────────────────────────────────
// RunLog = temporal: WHEN did something happen, in what order
// ProvenanceGraph = structural: WHAT is connected to WHAT
// ProvenanceNode.runLogId bridges the two layers.

export interface RunLogRecord {
  id: string;
  projectId: string;
  action: string;
  status: string;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  errorDetail: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
}

// ── Lifecycle Types ────────────────────────────────────────

export interface LifecycleTransition<S extends string> {
  from: S;
  to: S;
  label: string;
  requiresAuth?: boolean;
}

// ── Idempotency ────────────────────────────────────────────

export interface IdempotencyCheck {
  key: string;
  exists: boolean;
  existingAttestationId?: string;
}

// ── Edge Type Constants (mirrored from provenance.ts) ──────

export const PROVENANCE_EDGE_TYPES = {
  DERIVED_FROM: 'derived_from',
  ATTESTED_BY: 'attested_by',
  PRODUCED: 'produced',
  TRANSFORMED_TO: 'transformed_to',
  TRIGGERED: 'triggered',
  CONSUMED: 'consumed',
} as const;

export type ProvenanceEdgeType = (typeof PROVENANCE_EDGE_TYPES)[keyof typeof PROVENANCE_EDGE_TYPES];
