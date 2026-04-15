// ============================================================
// NPH-Trust Pipeline Orchestrator — Types
// ============================================================
// Defines the composable pipeline abstraction:
//   PipelineContext: shared state flowing through steps
//   PipelineStep: unit of work with execute/rollback
//   PipelineResult: final outcome with full audit trail
//
// Phase 1 architecture is NOT modified — this layer
// composes on top of existing services.
// ============================================================

// ── Pipeline Context ───────────────────────────────────────

export interface PipelineContext {
  /** Unique execution ID (UUID) */
  readonly pipelineId: string;
  /** Human-readable pipeline name (e.g., 'import', 'pathway_event') */
  readonly pipelineName: string;
  /** Project scope */
  readonly projectId: string;
  /** Authenticated user executing the pipeline */
  readonly userId: string;
  /** Pipeline start timestamp */
  readonly startedAt: Date;

  // ── Accumulated State ──────────────────────────────────

  /**
   * Named intermediate results produced by steps.
   * Each step can write artifacts for downstream steps to consume.
   * Keys follow convention: `step_name.artifact_name`
   */
  artifacts: Map<string, unknown>;

  /** IDs of ProvenanceNodes created during this pipeline run */
  provenanceNodeIds: string[];

  /** IDs of Attestations created during this pipeline run */
  attestationIds: string[];

  /** IDs of RunLog entries created during this pipeline run */
  runLogIds: string[];

  /** Non-fatal errors encountered (pipeline continued) */
  warnings: PipelineWarning[];

  // ── Configuration ──────────────────────────────────────

  /** Skip blockchain anchoring for this run (default: false) */
  skipBlockchain: boolean;

  /** Skip attestation generation (for dry-run/testing) */
  skipAttestation: boolean;

  /** Per-step timeout in milliseconds (0 = no timeout). Default: 30000 */
  stepTimeoutMs: number;

  /** Max retries for retryable steps before marking as warning. Default: 2 */
  maxStepRetries: number;
}

// ── Pipeline Step ──────────────────────────────────────────

export interface PipelineStep<TInput = unknown, TOutput = unknown> {
  /** Unique step name within the pipeline */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /**
   * Execute this step.
   * Input comes from the previous step's output (or pipeline input for first step).
   * Must return output for the next step.
   */
  execute(input: TInput, ctx: PipelineContext): Promise<TOutput>;

  /**
   * Optional: compensating action if a later step fails.
   * Called in reverse order when pipeline aborts.
   */
  rollback?(ctx: PipelineContext): Promise<void>;

  /**
   * Optional: skip this step conditionally.
   * If returns true, the step is skipped and input passes through as output.
   */
  shouldSkip?(input: TInput, ctx: PipelineContext): boolean;
}

// ── Pipeline Result ────────────────────────────────────────

export type PipelineStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface StepOutcome {
  stepName: string;
  status: 'executed' | 'skipped' | 'failed' | 'degraded';
  durationMs: number;
  error?: string;
}

/** Post-execution traceability audit included in every PipelineResult */
export interface TraceabilityReport {
  /** Were any provenance nodes created? */
  hasProvenance: boolean;
  /** Were any attestations created? */
  hasAttestation: boolean;
  /** Steps that signaled degraded traceability */
  degradedSteps: string[];
  /** True if pipeline status was downgraded due to traceability gaps */
  wasDowngraded: boolean;
}

export interface PipelineResult<T = unknown> {
  pipelineId: string;
  pipelineName: string;
  status: PipelineStatus;
  output: T | null;
  stepsExecuted: StepOutcome[];
  provenanceNodeIds: string[];
  attestationIds: string[];
  runLogIds: string[];
  warnings: PipelineWarning[];
  traceability: TraceabilityReport;
  durationMs: number;
  error?: string;
}

// ── Error / Warning Types ──────────────────────────────────

export interface PipelineWarning {
  stepName: string;
  message: string;
  timestamp: Date;
}

/**
 * Step severity classification:
 *
 * - `fatal`:    Failure aborts the pipeline + triggers rollback.
 *               Used for: data creation steps (CreatePathwayEventStep, CreateCheckpointStep, etc.)
 *
 * - `degraded`: Failure downgrades pipeline to PARTIAL, but execution continues.
 *               Used for: provenance + attestation steps (RecordEventProvenanceStep, CreateAttestationStep, etc.)
 *               The pipeline produced its core output but traceability is incomplete.
 *
 * - `optional`: Failure is recorded as a warning, pipeline stays SUCCESS.
 *               Used for: blockchain anchoring (AnchorAttestationStep).
 *
 * Retry behavior: Only `isRetryable: true` errors are retried.
 * After retry exhaustion, severity determines the final status.
 *
 * Resumability: Pipelines are NOT resumable from a mid-point.
 * Each run creates a fresh context. If a pipeline fails, re-invoke the
 * full pipeline — idempotency keys prevent duplicate attestations/provenance.
 *
 * Compensation: Steps may implement rollback() for compensating writes.
 * Rollback is called in reverse order only on FATAL failures.
 * DEGRADED failures do NOT trigger rollback — the core data is valid.
 */
export type PipelineErrorSeverity = 'fatal' | 'degraded' | 'optional';

export class PipelineError extends Error {
  public readonly stepName: string;
  public readonly pipelineId: string;
  public readonly isRetryable: boolean;
  public readonly severity: PipelineErrorSeverity;
  public readonly originalCause?: Error;

  constructor(opts: {
    stepName: string;
    pipelineId: string;
    message: string;
    isRetryable?: boolean;
    severity?: PipelineErrorSeverity;
    cause?: Error;
  }) {
    super(opts.message);
    this.name = 'PipelineError';
    this.stepName = opts.stepName;
    this.pipelineId = opts.pipelineId;
    this.isRetryable = opts.isRetryable ?? false;
    this.severity = opts.severity ?? (opts.isRetryable ? 'optional' : 'fatal');
    this.originalCause = opts.cause;
  }
}

// ── Pipeline Definition ────────────────────────────────────

export interface PipelineDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  steps: PipelineStep[];
}
