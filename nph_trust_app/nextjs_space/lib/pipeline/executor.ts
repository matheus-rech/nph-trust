// ============================================================
// NPH-Trust Pipeline Executor
// ============================================================
// Runs a sequence of PipelineSteps with:
//   - Per-step timing and error capture
//   - Step-level timeout enforcement
//   - Retry logic for retryable errors
//   - Three-tier severity: fatal → FAILED, degraded → PARTIAL, optional → warning
//   - Post-execution traceability audit
//   - RunLog integration (one log entry per pipeline run)
//   - Rollback on fatal failure (reverse order)
//   - Full audit trail in PipelineResult
//
// Failure Semantics:
//   FATAL error   → pipeline aborts, rollback triggered, status = FAILED
//   DEGRADED error → pipeline continues, status downgraded to PARTIAL
//   OPTIONAL error → pipeline continues, warning recorded, status unchanged
//   Retryable      → retried with backoff; after exhaustion, severity applies
//
// Traceability Guarantee:
//   After all steps complete, the executor audits whether provenance nodes
//   and attestation records were actually produced. If the pipeline name
//   implies traceability is expected (import_execute, pathway_event,
//   approval, checkpoint, export) and none were created, the status is
//   downgraded from SUCCESS to PARTIAL.
// ============================================================

import { prisma } from '../db';
import type {
  PipelineStep,
  PipelineContext,
  PipelineResult,
  PipelineStatus,
  StepOutcome,
  TraceabilityReport,
} from './types';
import { PipelineError } from './types';

// Pipelines that MUST produce provenance to be considered SUCCESS
const PROVENANCE_REQUIRED_PIPELINES = new Set([
  'import_execute',
  'pathway_event',
  'approval',
  'checkpoint',
  'export',
]);

// Pipelines that MUST produce attestations to be considered SUCCESS
// (import_upload only creates provenance, not attestation)
const ATTESTATION_REQUIRED_PIPELINES = new Set([
  'import_execute',
  'checkpoint',
  'export',
]);

// ── Timeout Utility ────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PipelineError({
        stepName: label,
        pipelineId: 'timeout',
        message: `Step '${label}' timed out after ${ms}ms`,
        isRetryable: true,
        severity: 'degraded',
      })),
      ms
    );
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ── Step Execution with Retry ──────────────────────────────

async function executeStepWithRetry(
  step: PipelineStep,
  input: unknown,
  ctx: PipelineContext
): Promise<{ output: unknown; attempts: number }> {
  const maxRetries = ctx.maxStepRetries;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const promise = step.execute(input, ctx);
      const output = ctx.stepTimeoutMs > 0
        ? await withTimeout(promise, ctx.stepTimeoutMs, step.name)
        : await promise;
      return { output, attempts: attempt + 1 };
    } catch (err: any) {
      lastError = err;

      // Only retry if it's a retryable PipelineError AND we have retries left
      if (err instanceof PipelineError && err.isRetryable && attempt < maxRetries) {
        ctx.warnings.push({
          stepName: step.name,
          message: `Retry ${attempt + 1}/${maxRetries}: ${err.message}`,
          timestamp: new Date(),
        });
        // Brief backoff: 100ms * (attempt + 1)
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      break;
    }
  }

  throw lastError;
}

// ── Main Pipeline Executor ─────────────────────────────────

/**
 * Execute a named pipeline: run steps in order, log everything.
 *
 * @param name - Pipeline name (for logging)
 * @param steps - Ordered list of PipelineSteps
 * @param input - Initial input to the first step
 * @param ctx - Pipeline execution context
 * @returns PipelineResult with full audit trail and traceability report
 */
export async function executePipeline<TInput, TOutput>(
  name: string,
  steps: PipelineStep[],
  input: TInput,
  ctx: PipelineContext
): Promise<PipelineResult<TOutput>> {
  const outcomes: StepOutcome[] = [];
  const executedSteps: PipelineStep[] = [];
  const degradedSteps: string[] = [];
  let currentOutput: unknown = input;
  let pipelineStatus: PipelineStatus = 'SUCCESS';
  let fatalError: string | undefined;

  console.log(`[Pipeline:${name}] Starting (id=${ctx.pipelineId}, steps=${steps.length}, project=${ctx.projectId})`);

  for (const step of steps) {
    const stepStart = Date.now();

    // Check if step should be skipped
    if (step.shouldSkip?.(currentOutput, ctx)) {
      outcomes.push({
        stepName: step.name,
        status: 'skipped',
        durationMs: Date.now() - stepStart,
      });
      console.log(`[Pipeline:${name}] Step '${step.name}' skipped`);
      continue;
    }

    try {
      const { output, attempts } = await executeStepWithRetry(step, currentOutput, ctx);
      currentOutput = output;
      executedSteps.push(step);
      const durationMs = Date.now() - stepStart;
      outcomes.push({
        stepName: step.name,
        status: 'executed',
        durationMs,
      });
      console.log(`[Pipeline:${name}] Step '${step.name}' executed (${durationMs}ms, attempts=${attempts})`);
    } catch (err: any) {
      const durationMs = Date.now() - stepStart;
      const errorMessage = err?.message ?? 'Unknown error';
      const severity = err instanceof PipelineError ? err.severity : 'fatal';

      // ── OPTIONAL severity: warning only, pipeline stays SUCCESS ──
      if (severity === 'optional') {
        outcomes.push({
          stepName: step.name,
          status: 'skipped',
          durationMs,
          error: errorMessage,
        });
        ctx.warnings.push({
          stepName: step.name,
          message: `Optional step failed (non-blocking): ${errorMessage}`,
          timestamp: new Date(),
        });
        console.warn(`[Pipeline:${name}] Step '${step.name}' failed (optional): ${errorMessage}`);
        continue;
      }

      // ── DEGRADED severity: pipeline continues but downgraded to PARTIAL ──
      if (severity === 'degraded') {
        outcomes.push({
          stepName: step.name,
          status: 'degraded',
          durationMs,
          error: errorMessage,
        });
        ctx.warnings.push({
          stepName: step.name,
          message: `Traceability degraded: ${errorMessage}`,
          timestamp: new Date(),
        });
        degradedSteps.push(step.name);
        pipelineStatus = 'PARTIAL';
        console.warn(`[Pipeline:${name}] Step '${step.name}' DEGRADED: ${errorMessage}`);
        continue;
      }

      // ── FATAL severity: abort + rollback ──
      outcomes.push({
        stepName: step.name,
        status: 'failed',
        durationMs,
        error: errorMessage,
      });
      pipelineStatus = 'FAILED';
      fatalError = `Pipeline '${name}' failed at step '${step.name}': ${errorMessage}`;
      console.error(`[Pipeline:${name}] FATAL at step '${step.name}': ${errorMessage}`);

      // Rollback executed steps in reverse order
      for (let i = executedSteps.length - 1; i >= 0; i--) {
        const rollbackStep = executedSteps[i];
        if (rollbackStep.rollback) {
          try {
            await rollbackStep.rollback(ctx);
            console.log(`[Pipeline:${name}] Rolled back step '${rollbackStep.name}'`);
          } catch (rollbackErr: any) {
            console.error(
              `[Pipeline:${name}] Rollback failed for step '${rollbackStep.name}':`,
              rollbackErr?.message
            );
          }
        }
      }

      break;
    }
  }

  // ── Post-Execution Traceability Audit ──────────────────────
  const hasProvenance = ctx.provenanceNodeIds.length > 0;
  const hasAttestation = ctx.attestationIds.length > 0;
  let wasDowngraded = false;

  if (pipelineStatus === 'SUCCESS') {
    // Check: pipeline that REQUIRES provenance produced none
    if (PROVENANCE_REQUIRED_PIPELINES.has(name) && !hasProvenance && !ctx.skipAttestation) {
      pipelineStatus = 'PARTIAL';
      wasDowngraded = true;
      ctx.warnings.push({
        stepName: '__traceability_audit',
        message: `Pipeline '${name}' completed but produced 0 provenance nodes — downgraded to PARTIAL`,
        timestamp: new Date(),
      });
      console.warn(`[Pipeline:${name}] Traceability audit: 0 provenance nodes produced — downgrading to PARTIAL`);
    }

    // Check: pipeline that REQUIRES attestation produced none
    if (ATTESTATION_REQUIRED_PIPELINES.has(name) && !hasAttestation && !ctx.skipAttestation) {
      pipelineStatus = 'PARTIAL';
      wasDowngraded = true;
      ctx.warnings.push({
        stepName: '__traceability_audit',
        message: `Pipeline '${name}' completed but produced 0 attestations — downgraded to PARTIAL`,
        timestamp: new Date(),
      });
      console.warn(`[Pipeline:${name}] Traceability audit: 0 attestations produced — downgrading to PARTIAL`);
    }
  }

  const traceability: TraceabilityReport = {
    hasProvenance,
    hasAttestation,
    degradedSteps,
    wasDowngraded,
  };

  const durationMs = Date.now() - ctx.startedAt.getTime();
  console.log(`[Pipeline:${name}] Finished (status=${pipelineStatus}, duration=${durationMs}ms, nodes=${ctx.provenanceNodeIds.length}, attestations=${ctx.attestationIds.length}, degraded=${degradedSteps.length})`);

  // Record pipeline execution in RunLog
  try {
    const runLog = await prisma.runLog.create({
      data: {
        projectId: ctx.projectId,
        action: `pipeline.${name}`,
        status: pipelineStatus,
        inputSummary: {
          pipelineId: ctx.pipelineId,
          pipelineName: name,
          stepCount: steps.length,
          stepsExecuted: outcomes.filter((o) => o.status === 'executed').length,
          stepsSkipped: outcomes.filter((o) => o.status === 'skipped').length,
          stepsDegraded: outcomes.filter((o) => o.status === 'degraded').length,
          stepsFailed: outcomes.filter((o) => o.status === 'failed').length,
        } as any,
        outputSummary: {
          provenanceNodeIds: ctx.provenanceNodeIds,
          attestationIds: ctx.attestationIds,
          traceability,
          warnings: ctx.warnings.map((w) => `${w.stepName}: ${w.message}`),
          stepOutcomes: outcomes.map((o) => ({
            name: o.stepName,
            status: o.status,
            ms: o.durationMs,
            ...(o.error ? { error: o.error } : {}),
          })),
        } as any,
        errorDetail: fatalError ?? null,
        durationMs,
        triggeredBy: ctx.userId,
      },
    });
    ctx.runLogIds.push(runLog.id);
  } catch (logErr: any) {
    console.error(`[Pipeline:${name}] RunLog creation failed:`, logErr?.message);
  }

  return {
    pipelineId: ctx.pipelineId,
    pipelineName: name,
    status: pipelineStatus,
    output: pipelineStatus !== 'FAILED' ? (currentOutput as TOutput) : null,
    stepsExecuted: outcomes,
    provenanceNodeIds: ctx.provenanceNodeIds,
    attestationIds: ctx.attestationIds,
    runLogIds: ctx.runLogIds,
    warnings: ctx.warnings,
    traceability,
    durationMs,
    error: fatalError,
  };
}
