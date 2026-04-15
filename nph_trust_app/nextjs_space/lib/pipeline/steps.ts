// ============================================================
// NPH-Trust Pipeline Steps
// ============================================================
// Each step is a composable unit of work following the
// PipelineStep interface. Steps delegate to Phase 1 services
// (attestation-service, provenance, lifecycle) — they do NOT
// re-implement core logic.
//
// Steps communicate via the PipelineContext.artifacts map.
// Convention: artifacts are keyed as `step_name.artifact_name`
// ============================================================

import type { PipelineStep, PipelineContext } from './types';
import { PipelineError } from './types';
import { setArtifact, getArtifact, addWarning } from './context';
import { prisma } from '../db';
import { computeFileHash, canonicalize, computeHash } from '../attestation';
import { createAttestation } from '../attestation-service';
import { anchorAttestation } from '../attestation-service';
import {
  createProvenanceNode,
  createProvenanceEdge,
  recordProvenanceChain,
  recordEventNode,
  EDGE_TYPES,
} from '../provenance';
import { transitionPathwayEvent } from '../pathway-service';

// ============================================================
// 1. INPUT INGESTION STEPS
// ============================================================

/**
 * Step: Parse and validate a CSV file upload.
 * Input: { file: File }
 * Output: { artifact, job, rows, headers }
 * Artifacts: ingest.artifact, ingest.job, ingest.rows, ingest.headers
 */
export const IngestCSVStep: PipelineStep<
  { file: File },
  { artifactId: string; jobId: string; rows: any[]; headers: string[]; errors: any[] }
> = {
  name: 'ingest_csv',
  description: 'Parse CSV, create InputArtifact and ImportJob',

  async execute(input, ctx) {
    const { file } = input;
    if (!file) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'No file provided',
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = buffer.toString('utf-8');
    const fileHash = computeFileHash(buffer);

    // ── Duplicate file detection ──────────────────────────
    // Check for existing artifact with same SHA-256 hash in this project.
    // Detects byte-identical duplicates only (semantic dedup is out of scope).
    const existingArtifact = await prisma.inputArtifact.findFirst({
      where: {
        projectId: ctx.projectId,
        sha256Hash: fileHash,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingArtifact) {
      // Find the most recent import job for this artifact
      const existingJob = await prisma.importJob.findFirst({
        where: { inputArtifactId: existingArtifact.id },
        orderBy: { createdAt: 'desc' },
      });

      // Store structured duplicate result in context
      setArtifact(ctx, 'ingest.isDuplicate', true);
      setArtifact(ctx, 'ingest.duplicateArtifactId', existingArtifact.id);
      setArtifact(ctx, 'ingest.duplicateImportJobId', existingJob?.id ?? null);
      setArtifact(ctx, 'ingest.duplicateHandling', 'REUSED_EXISTING');
      setArtifact(ctx, 'ingest.artifact', existingArtifact);
      setArtifact(ctx, 'ingest.artifactId', existingArtifact.id);
      setArtifact(ctx, 'ingest.job', existingJob);
      setArtifact(ctx, 'ingest.jobId', existingJob?.id ?? null);
      setArtifact(ctx, 'ingest.fileHash', fileHash);
      setArtifact(ctx, 'ingest.fileName', file.name);
      setArtifact(ctx, 'ingest.fileSize', buffer.length);
      setArtifact(ctx, 'ingest.fileMimeType', file.type || 'text/csv');

      addWarning(ctx, 'ingest_csv', `Duplicate file detected (SHA-256: ${fileHash.slice(0, 16)}...). Reusing existing artifact ${existingArtifact.id}.`);

      return {
        artifactId: existingArtifact.id,
        jobId: existingJob?.id ?? '',
        rows: existingJob?.previewData as any[] ?? [],
        headers: (existingArtifact.metadata as any)?.headers ?? [],
        errors: [],
      };
    }

    // If not a duplicate, also set isDuplicate = false for downstream steps
    setArtifact(ctx, 'ingest.isDuplicate', false);

    const lines = text.split('\n').filter((l: string) => l.trim());
    if (lines.length < 2) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'File must have header + at least 1 data row',
      });
    }

    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
    const rows: any[] = [];
    const errors: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map((v: string) => v.trim());
      const row: any = {};
      headers.forEach((h: string, j: number) => { row[h] = vals[j] ?? ''; });
      if (!row.pseudo_id && !row.pseudoid && !row.id) {
        errors.push({ row: i + 1, field: 'pseudo_id', code: 'MISSING_REQUIRED', message: 'Missing patient identifier', severity: 'error' });
      } else {
        rows.push(row);
      }
    }

    // Create input artifact
    const artifact = await prisma.inputArtifact.create({
      data: {
        projectId: ctx.projectId,
        filename: file.name,
        mimeType: file.type || 'text/csv',
        sizeBytes: buffer.length,
        storagePath: `imports/${ctx.projectId}/${Date.now()}-${file.name}`,
        sha256Hash: fileHash,
        sourceType: 'CSV',
        status: 'READY',
        metadata: { headers, rowCount: rows.length },
      },
    });

    // Create import job
    const job = await prisma.importJob.create({
      data: {
        projectId: ctx.projectId,
        inputArtifactId: artifact.id,
        initiatedById: ctx.userId,
        status: 'VALIDATED',
        sourceType: 'CSV',
        totalRows: rows.length,
        errors: errors.length > 0 ? (errors as any) : undefined,
        previewData: rows.slice(0, 10),
      },
    });

    // Store in context for downstream steps
    setArtifact(ctx, 'ingest.artifact', artifact);
    setArtifact(ctx, 'ingest.artifactId', artifact.id);
    setArtifact(ctx, 'ingest.job', job);
    setArtifact(ctx, 'ingest.jobId', job.id);
    setArtifact(ctx, 'ingest.rows', rows);
    setArtifact(ctx, 'ingest.headers', headers);
    setArtifact(ctx, 'ingest.fileHash', fileHash);
    setArtifact(ctx, 'ingest.fileName', file.name);
    setArtifact(ctx, 'ingest.fileSize', buffer.length);
    setArtifact(ctx, 'ingest.fileMimeType', file.type || 'text/csv');

    return { artifactId: artifact.id, jobId: job.id, rows, headers, errors };
  },
};

/**
 * Step: Register INPUT provenance node for an ingested artifact.
 * Input: passthrough from IngestCSVStep
 * Artifacts read: ingest.artifactId, ingest.fileHash, ingest.fileName, etc.
 */
export const RegisterInputProvenanceStep: PipelineStep = {
  name: 'register_input_provenance',
  description: 'Create INPUT provenance node for the uploaded artifact',

  async execute(input, ctx) {
    const artifactId = getArtifact<string>(ctx, 'ingest.artifactId');
    const fileName = getArtifact<string>(ctx, 'ingest.fileName');
    const fileHash = getArtifact<string>(ctx, 'ingest.fileHash');
    const fileSize = getArtifact<number>(ctx, 'ingest.fileSize');
    const mimeType = getArtifact<string>(ctx, 'ingest.fileMimeType');

    if (!artifactId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'No artifact ID in context — IngestCSVStep must run first',
      });
    }

    const node = await createProvenanceNode({
      projectId: ctx.projectId,
      nodeType: 'INPUT',
      label: fileName ?? 'Uploaded artifact',
      entityType: 'input_artifact',
      entityId: artifactId,
      metadata: { sha256: fileHash, sizeBytes: fileSize, mimeType },
    });

    ctx.provenanceNodeIds.push(node.id);
    setArtifact(ctx, 'provenance.inputNodeId', node.id);
    return input;
  },
};

// ============================================================
// 2. CANONICAL TRANSFORMATION STEP
// ============================================================

/**
 * Step: Execute an import job — transform raw CSV rows into canonical objects.
 * Input: { jobId: string }
 * Output: { processed, errorCount, finalStatus }
 */
export const ExecuteImportTransformStep: PipelineStep<
  { jobId: string },
  { processed: number; errorCount: number; finalStatus: string }
> = {
  name: 'execute_import_transform',
  description: 'Transform import job rows into canonical PatientEpisodes and PathwayEvents',

  async execute(input, ctx) {
    const { jobId } = input;
    const job = await prisma.importJob.findUnique({
      where: { id: jobId },
      include: { inputArtifact: true },
    });

    if (!job) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Import job ${jobId} not found`,
      });
    }
    if (job.status !== 'VALIDATED') {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Job not in VALIDATED state (current: ${job.status})`,
      });
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'IMPORTING', startedAt: new Date() },
    });

    const rows = (job.previewData as any[]) ?? [];
    const stages = await prisma.pathwayStageDefinition.findMany();
    const screeningStage = stages.find((s: any) => s.stageType === 'SYMPTOM_SCREENING');

    let processed = 0;
    let errorCount = 0;
    const createdEventIds: string[] = [];

    for (const row of rows) {
      try {
        const pseudoId = row?.pseudo_id ?? row?.pseudoid ?? row?.id ?? `IMP-${Date.now()}-${processed}`;
        const episode = await prisma.patientEpisode.upsert({
          where: { projectId_pseudoId: { projectId: job.projectId, pseudoId } },
          update: { metadata: { ageRange: row?.age_range ?? row?.age ?? '', sex: row?.sex ?? '' } },
          create: {
            projectId: job.projectId,
            pseudoId,
            siteId: row?.site_id ?? null,
            metadata: { ageRange: row?.age_range ?? row?.age ?? '', sex: row?.sex ?? '', imported: true },
          },
        });

        if (screeningStage && (row?.gait_score || row?.cognition_score)) {
          const evt = await prisma.pathwayEvent.create({
            data: {
              patientEpisodeId: episode.id,
              stageDefinitionId: screeningStage.id,
              status: 'COMPLETED',
              occurredAt: new Date(),
              completedAt: new Date(),
              data: { gaitScore: row?.gait_score, cognitionScore: row?.cognition_score, urinaryScore: row?.urinary_score },
            },
          });
          createdEventIds.push(evt.id);
        }
        processed++;
      } catch (e: any) {
        errorCount++;
        console.error('Row import error:', e?.message);
      }
    }

    const finalStatus = errorCount > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: finalStatus, processedRows: processed, errorRows: errorCount, completedAt: new Date() },
    });

    // Store in context
    setArtifact(ctx, 'transform.jobId', jobId);
    setArtifact(ctx, 'transform.processed', processed);
    setArtifact(ctx, 'transform.errorCount', errorCount);
    setArtifact(ctx, 'transform.finalStatus', finalStatus);
    setArtifact(ctx, 'transform.inputArtifactId', job.inputArtifactId);
    setArtifact(ctx, 'transform.inputArtifactFilename', job.inputArtifact.filename);
    setArtifact(ctx, 'transform.totalRows', job.totalRows);
    setArtifact(ctx, 'transform.sourceType', job.sourceType);
    setArtifact(ctx, 'transform.createdEventIds', createdEventIds);

    return { processed, errorCount, finalStatus };
  },
};

// ============================================================
// 3. ATTESTATION GENERATION STEP (generic)
// ============================================================

/**
 * Step: Create an attestation for the current pipeline action.
 * Input: AttestationInput (eventType, target, canonicalData)
 * Output: { attestationId, isDuplicate, runLogId }
 *
 * Skipped if ctx.skipAttestation is true.
 */
export interface AttestationInput {
  eventType: string;
  target: {
    subjectType: string;
    subjectId: string;
    eventId?: string;
    sourceArtifactIds?: string[];
  };
  canonicalData: Record<string, unknown>;
}

export const CreateAttestationStep: PipelineStep<
  AttestationInput,
  { attestationId: string; isDuplicate: boolean; runLogId?: string }
> = {
  name: 'create_attestation',
  description: 'Generate attestation with hash, signature, and provenance binding',

  shouldSkip(_input, ctx) {
    return ctx.skipAttestation;
  },

  async execute(input, ctx) {
    const result = await createAttestation({
      projectId: ctx.projectId,
      eventType: input.eventType,
      target: input.target,
      canonicalData: input.canonicalData,
      createdById: ctx.userId,
    });

    ctx.attestationIds.push(result.attestation.id);
    if (result.runLogId) ctx.runLogIds.push(result.runLogId);
    setArtifact(ctx, 'attestation.id', result.attestation.id);
    setArtifact(ctx, 'attestation.isDuplicate', result.isDuplicate);
    setArtifact(ctx, 'attestation.runLogId', result.runLogId);

    return {
      attestationId: result.attestation.id,
      isDuplicate: result.isDuplicate,
      runLogId: result.runLogId,
    };
  },
};

// ============================================================
// 4. PROVENANCE CHAIN STEP (for import flows)
// ============================================================

/**
 * Step: Record a full input→transform→output provenance chain.
 * Reads context artifacts from ingest + transform steps.
 */
export const RecordImportProvenanceChainStep: PipelineStep = {
  name: 'record_import_provenance_chain',
  description: 'Record INPUT→TRANSFORM→OUTPUT provenance chain for import',

  async execute(input, ctx) {
    const attestationId = getArtifact<string>(ctx, 'attestation.id');
    const isDuplicate = getArtifact<boolean>(ctx, 'attestation.isDuplicate');
    const runLogId = getArtifact<string>(ctx, 'attestation.runLogId');
    const artifactId = getArtifact<string>(ctx, 'transform.inputArtifactId');
    const filename = getArtifact<string>(ctx, 'transform.inputArtifactFilename');
    const jobId = getArtifact<string>(ctx, 'transform.jobId');
    const processed = getArtifact<number>(ctx, 'transform.processed');

    // Duplicate attestation → provenance already exists from first run
    if (isDuplicate) {
      addWarning(ctx, this.name, 'Skipping provenance chain: duplicate attestation (already recorded)');
      return input;
    }

    // Missing context → traceability gap, must surface as degraded
    if (!attestationId || !artifactId || !jobId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Cannot record provenance chain: missing ${[
          !attestationId && 'attestationId',
          !artifactId && 'artifactId',
          !jobId && 'jobId',
        ].filter(Boolean).join(', ')}`,
        severity: 'degraded',
      });
    }

    const chain = await recordProvenanceChain({
      projectId: ctx.projectId,
      inputEntity: { type: 'input_artifact', id: artifactId, label: filename },
      transformLabel: `CSV Import (${processed ?? 0} rows)`,
      outputEntity: { type: 'import_job', id: jobId, label: `Import Job ${jobId}` },
      attestationId,
      runLogId,
    });

    ctx.provenanceNodeIds.push(chain.inputNode.id, chain.transformNode.id, chain.outputNode.id);
    return input;
  },
};

// ============================================================
// 5. BLOCKCHAIN ANCHORING STEP
// ============================================================

/**
 * Step: Submit attestation hash to blockchain (optional, async).
 * Skipped if ctx.skipBlockchain is true or no attestation exists.
 */
export const AnchorAttestationStep: PipelineStep<
  unknown,
  { anchored: boolean; txRef?: string; error?: string }
> = {
  name: 'anchor_attestation',
  description: 'Submit attestation to blockchain (optional, retryable)',

  shouldSkip(_input, ctx) {
    return ctx.skipBlockchain || !getArtifact<string>(ctx, 'attestation.id');
  },

  async execute(input, ctx) {
    const attestationId = getArtifact<string>(ctx, 'attestation.id')!;

    try {
      const result = await anchorAttestation(attestationId);
      if (!result.anchored) {
        addWarning(ctx, this.name, result.error ?? 'Blockchain anchoring skipped or unavailable');
      }
      return result;
    } catch (err: any) {
      // Blockchain failure is non-blocking
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Blockchain anchoring failed: ${err?.message}`,
        isRetryable: true,
        cause: err,
      });
    }
  },
};

// ============================================================
// 6. PATHWAY EVENT STEPS
// ============================================================

export interface CreatePathwayEventInput {
  episodeId: string;
  stageType: string;
  status?: string;
  occurredAt?: string;
  completedAt?: string;
  performedBy?: string;
  notes?: string;
  data?: Record<string, unknown>;
  createAttestation?: boolean;
}

/**
 * Step: Create a pathway event (the canonical clinical object).
 * Output: the created event
 */
export const CreatePathwayEventStep: PipelineStep<
  CreatePathwayEventInput,
  { event: any; stageDef: any }
> = {
  name: 'create_pathway_event',
  description: 'Create canonical PathwayEvent record',

  async execute(input, ctx) {
    const stageDef = await prisma.pathwayStageDefinition.findUnique({
      where: { stageType: input.stageType as any },
    });
    if (!stageDef) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Invalid stage type: ${input.stageType}`,
      });
    }

    const event = await prisma.pathwayEvent.create({
      data: {
        patientEpisodeId: input.episodeId,
        stageDefinitionId: stageDef.id,
        status: (input.status ?? 'PENDING') as any,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
        performedBy: input.performedBy ?? null,
        notes: input.notes ?? null,
        data: (input.data ?? undefined) as any,
      },
      include: { stageDefinition: true },
    });

    setArtifact(ctx, 'event.id', event.id);
    setArtifact(ctx, 'event.stageType', input.stageType);
    setArtifact(ctx, 'event.status', event.status);
    setArtifact(ctx, 'event.data', input.data ?? {});
    setArtifact(ctx, 'event.shouldAttest', input.status === 'COMPLETED' || input.createAttestation);

    return { event, stageDef };
  },
};

/**
 * Step: Record EVENT provenance node for a pathway event.
 */
export const RecordEventProvenanceStep: PipelineStep = {
  name: 'record_event_provenance',
  description: 'Create EVENT provenance node for the pathway event',

  async execute(input, ctx) {
    const eventId = getArtifact<string>(ctx, 'event.id');
    const stageType = getArtifact<string>(ctx, 'event.stageType');
    const attestationId = getArtifact<string>(ctx, 'attestation.id');
    const isDuplicate = getArtifact<boolean>(ctx, 'attestation.isDuplicate');

    if (!eventId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Cannot record event provenance: no event ID in context',
        severity: 'degraded',
      });
    }

    const eventType = getArtifact<string>(ctx, 'event.status') === 'COMPLETED'
      ? 'pathway_event_completed'
      : 'pathway_event_created';

    const node = await recordEventNode({
      projectId: ctx.projectId,
      eventType,
      entityType: 'pathway_event',
      entityId: eventId,
      label: `${stageType ?? 'unknown'} event`,
      attestationId: isDuplicate ? undefined : attestationId,
    });

    ctx.provenanceNodeIds.push(node.id);
    return input;
  },
};

/**
 * Step: Conditionally build attestation input for a pathway event.
 * Only produces attestation input if the event warrants attestation.
 */
export const BuildEventAttestationInputStep: PipelineStep<
  { event: any; stageDef: any },
  AttestationInput | { event: any; stageDef: any }
> = {
  name: 'build_event_attestation_input',
  description: 'Build attestation payload for pathway event if applicable',

  async execute(input, ctx) {
    const shouldAttest = getArtifact<boolean>(ctx, 'event.shouldAttest');
    if (!shouldAttest) {
      setArtifact(ctx, 'attestation.skip', true);
      return input;
    }

    const eventType = input.event.status === 'COMPLETED'
      ? 'pathway_event_completed'
      : 'pathway_event_created';

    return {
      eventType,
      target: {
        subjectType: 'pathway_event',
        subjectId: input.event.id,
        eventId: input.event.id,
      },
      canonicalData: {
        eventId: input.event.id,
        stageType: input.stageDef.stageType,
        status: input.event.status,
        data: input.event.data ?? {},
      },
    };
  },
};

// ============================================================
// 7. APPROVAL STEP
// ============================================================

export interface ApprovalInput {
  approvalId: string;
  status: 'APPROVED' | 'REJECTED';
  comment?: string;
}

export const ProcessApprovalStep: PipelineStep<
  ApprovalInput,
  { approval: any; projectId: string | null }
> = {
  name: 'process_approval',
  description: 'Process approval decision and resolve project context',

  async execute(input, ctx) {
    const existing = await prisma.approval.findUnique({ where: { id: input.approvalId } });
    if (!existing) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Approval not found',
      });
    }
    if (existing.status !== 'PENDING') {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Approval already reviewed',
      });
    }

    const approval = await prisma.approval.update({
      where: { id: input.approvalId },
      data: {
        status: input.status,
        comment: input.comment ?? undefined,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });

    // Resolve project ID from target
    let projectId: string | null = null;
    const targetType = existing.targetType as string;
    if (targetType === 'PATHWAY_EVENT') {
      const event = await prisma.pathwayEvent.findUnique({
        where: { id: existing.targetId },
        include: { patientEpisode: { select: { projectId: true } } },
      });
      projectId = event?.patientEpisode?.projectId ?? null;
    } else if (targetType === 'CHECKPOINT' || targetType === 'OUTPUT_ARTIFACT' || targetType === 'ATTESTATION') {
      const checkpoint = await prisma.checkpoint.findUnique({
        where: { id: existing.targetId },
        select: { projectId: true },
      }).catch(() => null);
      if (checkpoint) {
        projectId = checkpoint.projectId;
      } else {
        const att = await prisma.attestation.findUnique({
          where: { id: existing.targetId },
          select: { projectId: true },
        }).catch(() => null);
        projectId = att?.projectId ?? null;
      }
    }

    setArtifact(ctx, 'approval.id', approval.id);
    setArtifact(ctx, 'approval.targetType', existing.targetType);
    setArtifact(ctx, 'approval.targetId', existing.targetId);
    setArtifact(ctx, 'approval.status', input.status);
    setArtifact(ctx, 'approval.projectId', projectId);

    return { approval, projectId };
  },
};

/**
 * Step: Build attestation input for an approval decision.
 */
export const BuildApprovalAttestationStep: PipelineStep<
  { approval: any; projectId: string | null },
  AttestationInput
> = {
  name: 'build_approval_attestation',
  description: 'Build attestation payload for approval decision',

  shouldSkip(input) {
    return !input.projectId;
  },

  async execute(input, ctx) {
    const eventType = input.approval.status === 'APPROVED' ? 'approval_granted' : 'approval_rejected';
    const targetType = getArtifact<string>(ctx, 'approval.targetType');
    const targetId = getArtifact<string>(ctx, 'approval.targetId');

    return {
      eventType,
      target: {
        subjectType: 'approval',
        subjectId: input.approval.id,
        sourceArtifactIds: targetId ? [targetId] : [],
      },
      canonicalData: {
        approvalId: input.approval.id,
        targetType,
        targetId,
        decision: input.approval.status,
        reviewerId: ctx.userId,
      },
    };
  },
};

/**
 * Step: Record EVENT provenance for approval decision.
 */
export const RecordApprovalProvenanceStep: PipelineStep = {
  name: 'record_approval_provenance',
  description: 'Create EVENT provenance node for approval decision',

  async execute(input, ctx) {
    const approvalId = getArtifact<string>(ctx, 'approval.id');
    const status = getArtifact<string>(ctx, 'approval.status');
    const targetType = getArtifact<string>(ctx, 'approval.targetType');
    const attestationId = getArtifact<string>(ctx, 'attestation.id');
    const isDuplicate = getArtifact<boolean>(ctx, 'attestation.isDuplicate');
    const runLogId = getArtifact<string>(ctx, 'attestation.runLogId');
    const projectId = getArtifact<string>(ctx, 'approval.projectId');

    if (!approvalId || !projectId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: `Cannot record approval provenance: missing ${[
          !approvalId && 'approvalId',
          !projectId && 'projectId',
        ].filter(Boolean).join(', ')}`,
        severity: 'degraded',
      });
    }

    // Duplicate attestation → provenance already exists from first run
    if (isDuplicate) {
      addWarning(ctx, this.name, 'Skipping approval provenance: duplicate attestation (already recorded)');
      return input;
    }

    // Missing attestation ID → traceability gap
    if (!attestationId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Cannot record approval provenance: attestation was not created',
        severity: 'degraded',
      });
    }

    const eventType = status === 'APPROVED' ? 'approval_granted' : 'approval_rejected';
    const node = await recordEventNode({
      projectId,
      eventType,
      entityType: 'approval',
      entityId: approvalId,
      label: `Approval ${(status ?? '').toLowerCase()}: ${targetType}`,
      attestationId,
      runLogId,
    });
    ctx.provenanceNodeIds.push(node.id);

    return input;
  },
};

// ============================================================
// 8. CHECKPOINT / OUTPUT STEPS
// ============================================================

export interface CheckpointInput {
  label?: string;
  description?: string;
}

export const CreateCheckpointStep: PipelineStep<
  CheckpointInput,
  { checkpoint: any; hash: string; version: number }
> = {
  name: 'create_checkpoint',
  description: 'Snapshot project state, hash, and create versioned checkpoint',

  async execute(input, ctx) {
    const [episodes, events, attestations, latest] = await Promise.all([
      prisma.patientEpisode.findMany({
        where: { projectId: ctx.projectId },
        select: { id: true, pseudoId: true, metadata: true },
      }),
      prisma.pathwayEvent.findMany({
        where: { patientEpisode: { projectId: ctx.projectId } },
        include: { stageDefinition: true },
      }),
      prisma.attestation.findMany({
        where: { projectId: ctx.projectId },
        select: { id: true, status: true, payloadHash: true, eventType: true },
      }),
      prisma.checkpoint.findFirst({
        where: { projectId: ctx.projectId },
        orderBy: { version: 'desc' },
      }),
    ]);

    const snapshot = { episodes, events, attestations };
    const canonical = canonicalize(snapshot);
    const hash = computeHash(canonical);
    const version = (latest?.version ?? 0) + 1;

    const checkpoint = await prisma.checkpoint.create({
      data: {
        projectId: ctx.projectId,
        version,
        label: input.label ?? `v${version}`,
        description: input.description ?? null,
        createdById: ctx.userId,
        snapshotData: snapshot,
        sha256Hash: hash,
        parentId: latest?.id ?? null,
      },
    });

    setArtifact(ctx, 'checkpoint.id', checkpoint.id);
    setArtifact(ctx, 'checkpoint.version', version);
    setArtifact(ctx, 'checkpoint.hash', hash);
    setArtifact(ctx, 'checkpoint.parentId', latest?.id ?? null);
    setArtifact(ctx, 'checkpoint.episodeCount', episodes.length);
    setArtifact(ctx, 'checkpoint.eventCount', events.length);
    setArtifact(ctx, 'checkpoint.attestationCount', attestations.length);
    setArtifact(ctx, 'checkpoint.attestationIds', attestations.map((a: any) => a.id));

    return { checkpoint, hash, version };
  },
};

/**
 * Step: Record OUTPUT provenance node for checkpoint + parent chain edge.
 */
export const RecordCheckpointProvenanceStep: PipelineStep = {
  name: 'record_checkpoint_provenance',
  description: 'Create OUTPUT provenance node for checkpoint with parent chain',

  async execute(input, ctx) {
    const checkpointId = getArtifact<string>(ctx, 'checkpoint.id');
    const version = getArtifact<number>(ctx, 'checkpoint.version');
    const parentId = getArtifact<string>(ctx, 'checkpoint.parentId');
    const runLogId = getArtifact<string>(ctx, 'attestation.runLogId');
    const isDuplicate = getArtifact<boolean>(ctx, 'attestation.isDuplicate');

    // Duplicate attestation → provenance already exists from first run
    if (isDuplicate) {
      addWarning(ctx, this.name, 'Skipping checkpoint provenance: duplicate attestation (already recorded)');
      return input;
    }

    if (!checkpointId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Cannot record checkpoint provenance: no checkpoint ID in context',
        severity: 'degraded',
      });
    }

    const cpNode = await createProvenanceNode({
      projectId: ctx.projectId,
      nodeType: 'OUTPUT',
      label: `Checkpoint v${version}`,
      entityType: 'checkpoint',
      entityId: checkpointId,
      runLogId,
    });
    ctx.provenanceNodeIds.push(cpNode.id);

    // Link parent checkpoint
    if (parentId) {
      const parentNodes = await prisma.provenanceNode.findMany({
        where: { projectId: ctx.projectId, entityType: 'checkpoint', entityId: parentId },
        take: 1,
      });
      if (parentNodes.length > 0) {
        await createProvenanceEdge({
          sourceId: parentNodes[0].id,
          targetId: cpNode.id,
          edgeType: EDGE_TYPES.DERIVED_FROM,
        });
      }
    }

    return input;
  },
};

// ============================================================
// 9. EXPORT / OUTPUT GENERATION STEP
// ============================================================

export interface ExportInput {
  format: 'json' | 'csv';
}

export const BuildExportStep: PipelineStep<
  ExportInput,
  { content: string; episodes: any[]; hash: string; format: string }
> = {
  name: 'build_export',
  description: 'Gather project data and build export content',

  async execute(input, ctx) {
    const episodes = await prisma.patientEpisode.findMany({
      where: { projectId: ctx.projectId },
      include: {
        site: { select: { name: true, identifier: true } },
        pathwayEvents: { include: { stageDefinition: true }, orderBy: { stageDefinition: { sortOrder: 'asc' } } },
      },
    });

    let content: string;
    if (input.format === 'csv') {
      const rows = ['pseudoId,site,currentStage,status,ageRange,sex'];
      (episodes ?? []).forEach((ep: any) => {
        const lastEvent = ep?.pathwayEvents?.[(ep?.pathwayEvents?.length ?? 1) - 1];
        const meta = ep?.metadata as any;
        rows.push(`${ep.pseudoId},${ep?.site?.name ?? ''},${lastEvent?.stageDefinition?.name ?? ''},${lastEvent?.status ?? ''},${meta?.ageRange ?? ''},${meta?.sex ?? ''}`);
      });
      content = rows.join('\n');
    } else {
      content = canonicalize({ projectId: ctx.projectId, episodes });
    }

    const hash = computeHash(content);

    // Track lock status for partial-regeneration awareness
    const lockedEventCount = (episodes ?? []).reduce((sum: number, ep: any) => {
      return sum + (ep?.pathwayEvents ?? []).filter((e: any) => e.status === 'COMPLETED').length;
    }, 0);
    const totalEventCount = (episodes ?? []).reduce((sum: number, ep: any) => {
      return sum + (ep?.pathwayEvents ?? []).length;
    }, 0);

    setArtifact(ctx, 'export.content', content);
    setArtifact(ctx, 'export.hash', hash);
    setArtifact(ctx, 'export.format', input.format);
    setArtifact(ctx, 'export.episodeCount', episodes.length);
    setArtifact(ctx, 'export.lockedEventCount', lockedEventCount);
    setArtifact(ctx, 'export.totalEventCount', totalEventCount);

    return { content, episodes, hash, format: input.format };
  },
};

/**
 * Step: Record OUTPUT provenance node for an export artifact.
 */
export const RecordExportProvenanceStep: PipelineStep = {
  name: 'record_export_provenance',
  description: 'Create OUTPUT provenance node for exported data',

  async execute(input, ctx) {
    const attestationId = getArtifact<string>(ctx, 'attestation.id');
    const isDuplicate = getArtifact<boolean>(ctx, 'attestation.isDuplicate');
    const runLogId = getArtifact<string>(ctx, 'attestation.runLogId');
    const format = getArtifact<string>(ctx, 'export.format');
    const episodeCount = getArtifact<number>(ctx, 'export.episodeCount');

    // Duplicate attestation → provenance already exists from first run
    if (isDuplicate) {
      addWarning(ctx, this.name, 'Skipping export provenance: duplicate attestation (already recorded)');
      return input;
    }

    if (!attestationId) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Cannot record export provenance: no attestation ID in context',
        severity: 'degraded',
      });
    }

    // Get subjectId from the attestation
    const att = await prisma.attestation.findUnique({
      where: { id: attestationId },
      select: { subjectId: true },
    });

    const node = await createProvenanceNode({
      projectId: ctx.projectId,
      nodeType: 'OUTPUT',
      label: `Export (${(format ?? 'json').toUpperCase()}, ${episodeCount ?? 0} episodes)`,
      entityType: 'export',
      entityId: att?.subjectId ?? `export-${ctx.pipelineId}`,
      attestationId,
      runLogId,
    });
    ctx.provenanceNodeIds.push(node.id);

    return input;
  },
};

// ============================================================
// GENERIC: Conditional attestation step adapter
// ============================================================

/**
 * Step: Create attestation only if ctx.skipAttestation is false
 * AND attestation.skip is not set.
 * This wraps CreateAttestationStep with additional context checks.
 */
export const ConditionalAttestationStep: PipelineStep = {
  name: 'conditional_attestation',
  description: 'Create attestation if conditions are met',

  shouldSkip(_input, ctx) {
    return ctx.skipAttestation || getArtifact<boolean>(ctx, 'attestation.skip') === true;
  },

  async execute(input, ctx) {
    // Input should be AttestationInput from a prior build step
    const attInput = input as AttestationInput;
    if (!attInput.eventType || !attInput.target) {
      throw new PipelineError({
        stepName: this.name,
        pipelineId: ctx.pipelineId,
        message: 'Cannot create attestation: input is not valid AttestationInput (missing eventType or target)',
        severity: 'degraded',
      });
    }
    return CreateAttestationStep.execute(attInput, ctx);
  },
};
