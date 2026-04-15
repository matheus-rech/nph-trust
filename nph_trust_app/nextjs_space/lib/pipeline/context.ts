// ============================================================
// NPH-Trust Pipeline Context Factory
// ============================================================

import crypto from 'crypto';
import type { PipelineContext } from './types';

/**
 * Create a fresh pipeline execution context.
 * Each pipeline run gets a unique ID and clean state.
 */
export function createPipelineContext(opts: {
  pipelineName: string;
  projectId: string;
  userId: string;
  skipBlockchain?: boolean;
  skipAttestation?: boolean;
  stepTimeoutMs?: number;
  maxStepRetries?: number;
}): PipelineContext {
  return {
    pipelineId: crypto.randomUUID(),
    pipelineName: opts.pipelineName,
    projectId: opts.projectId,
    userId: opts.userId,
    startedAt: new Date(),
    artifacts: new Map(),
    provenanceNodeIds: [],
    attestationIds: [],
    runLogIds: [],
    warnings: [],
    skipBlockchain: opts.skipBlockchain ?? false,
    skipAttestation: opts.skipAttestation ?? false,
    stepTimeoutMs: opts.stepTimeoutMs ?? 30000,
    maxStepRetries: opts.maxStepRetries ?? 2,
  };
}

// ── Context Helpers ────────────────────────────────────────

/** Type-safe artifact getter */
export function getArtifact<T>(ctx: PipelineContext, key: string): T | undefined {
  return ctx.artifacts.get(key) as T | undefined;
}

/** Type-safe artifact setter */
export function setArtifact(ctx: PipelineContext, key: string, value: unknown): void {
  ctx.artifacts.set(key, value);
}

/** Add a non-fatal warning */
export function addWarning(ctx: PipelineContext, stepName: string, message: string): void {
  ctx.warnings.push({ stepName, message, timestamp: new Date() });
}
