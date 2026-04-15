// ============================================================
// NPH-Trust Pre-Composed Pipelines
// ============================================================
// Each function builds and executes a pipeline for a specific
// workflow. These are the entry points called by API routes.
// ============================================================

import type { PipelineResult, PipelineStep } from './types';
import { createPipelineContext, getArtifact } from './context';
import { executePipeline } from './executor';
import {
  // Input
  IngestCSVStep,
  RegisterInputProvenanceStep,
  // Transform
  ExecuteImportTransformStep,
  RecordImportProvenanceChainStep,
  // Attestation
  CreateAttestationStep,
  ConditionalAttestationStep,
  AnchorAttestationStep,
  // Event
  CreatePathwayEventStep,
  BuildEventAttestationInputStep,
  RecordEventProvenanceStep,
  // Approval
  ProcessApprovalStep,
  BuildApprovalAttestationStep,
  RecordApprovalProvenanceStep,
  // Checkpoint
  CreateCheckpointStep,
  RecordCheckpointProvenanceStep,
  // Export
  BuildExportStep,
  RecordExportProvenanceStep,
  // Types
  type CreatePathwayEventInput,
  type ApprovalInput,
  type CheckpointInput,
  type ExportInput,
  type AttestationInput,
} from './steps';
import { ReconcileImportedEventsStep } from './steps/reconcile-imported-events';
import { LinkReconciledEventsStep } from './steps/link-reconciled-events';

// ============================================================
// 1. IMPORT UPLOAD PIPELINE
// ============================================================
// Flow: File → Parse CSV → Create Artifact → INPUT Provenance
// Returns: { job, artifact, preview, totalRows, errors, headers }

export async function executeImportUploadPipeline(opts: {
  projectId: string;
  userId: string;
  file: File;
}): Promise<PipelineResult> {
  const ctx = createPipelineContext({
    pipelineName: 'import_upload',
    projectId: opts.projectId,
    userId: opts.userId,
  });

  return executePipeline(
    'import_upload',
    [IngestCSVStep, RegisterInputProvenanceStep],
    { file: opts.file },
    ctx
  );
}

// ============================================================
// 2. IMPORT EXECUTE PIPELINE
// ============================================================
// Flow: Validate Job → Transform Rows → Canonical Objects
//       → Attest Import → Provenance Chain → Anchor (optional)

export async function executeImportExecutePipeline(opts: {
  projectId: string;
  userId: string;
  jobId: string;
}): Promise<PipelineResult> {
  const ctx = createPipelineContext({
    pipelineName: 'import_execute',
    projectId: opts.projectId,
    userId: opts.userId,
  });

  // Build attestation input dynamically after transform
  const BuildImportAttestationStep: PipelineStep = {
    name: 'build_import_attestation',
    description: 'Build attestation payload from import transform results',
    async execute(input, ctx) {
      const jobId = getArtifact<string>(ctx, 'transform.jobId');
      const inputArtifactId = getArtifact<string>(ctx, 'transform.inputArtifactId');
      const totalRows = getArtifact<number>(ctx, 'transform.totalRows');
      const processed = getArtifact<number>(ctx, 'transform.processed');
      const errorCount = getArtifact<number>(ctx, 'transform.errorCount');
      const sourceType = getArtifact<string>(ctx, 'transform.sourceType');

      return {
        eventType: 'import_job_completed',
        target: {
          subjectType: 'import_job',
          subjectId: jobId!,
          sourceArtifactIds: inputArtifactId ? [inputArtifactId] : [],
        },
        canonicalData: {
          inputArtifactId,
          totalRows,
          processedRows: processed,
          errorRows: errorCount,
          sourceType,
        },
      } as AttestationInput;
    },
  };

  return executePipeline(
    'import_execute',
    [
      ExecuteImportTransformStep,
      ReconcileImportedEventsStep,
      BuildImportAttestationStep,
      CreateAttestationStep,
      RecordImportProvenanceChainStep,
      LinkReconciledEventsStep,
      AnchorAttestationStep,
    ],
    { jobId: opts.jobId },
    ctx
  );
}

// ============================================================
// 3. PATHWAY EVENT CREATION PIPELINE
// ============================================================
// Flow: Create Event → Build Attestation → Attest (if COMPLETED)
//       → EVENT Provenance → Anchor (optional)

export async function executePathwayEventPipeline(opts: {
  projectId: string;
  userId: string;
  input: CreatePathwayEventInput;
}): Promise<PipelineResult> {
  const ctx = createPipelineContext({
    pipelineName: 'pathway_event',
    projectId: opts.projectId,
    userId: opts.userId,
  });

  return executePipeline(
    'pathway_event',
    [
      CreatePathwayEventStep,
      BuildEventAttestationInputStep,
      ConditionalAttestationStep,
      RecordEventProvenanceStep,
      AnchorAttestationStep,
    ],
    opts.input,
    ctx
  );
}

// ============================================================
// 4. APPROVAL PIPELINE
// ============================================================
// Flow: Process Decision → Build Attestation → Attest
//       → EVENT Provenance → Anchor (optional)

export async function executeApprovalPipeline(opts: {
  userId: string;
  input: ApprovalInput;
}): Promise<PipelineResult> {
  // Project ID will be resolved during the approval step
  const ctx = createPipelineContext({
    pipelineName: 'approval',
    projectId: 'pending-resolution',
    userId: opts.userId,
  });

  // Override projectId after resolution
  const ResolveProjectStep: PipelineStep<
    { approval: any; projectId: string | null },
    { approval: any; projectId: string | null }
  > = {
    name: 'resolve_project_id',
    description: 'Update pipeline context with resolved project ID',
    async execute(input, ctx) {
      if (input.projectId) {
        (ctx as any).projectId = input.projectId;
      }
      return input;
    },
  };

  return executePipeline(
    'approval',
    [
      ProcessApprovalStep,
      ResolveProjectStep,
      BuildApprovalAttestationStep,
      ConditionalAttestationStep,
      RecordApprovalProvenanceStep,
      AnchorAttestationStep,
    ],
    opts.input,
    ctx
  );
}

// ============================================================
// 5. CHECKPOINT PIPELINE
// ============================================================
// Flow: Snapshot State → Hash → Create Checkpoint → Attest
//       → OUTPUT Provenance (with parent chain) → Anchor

export async function executeCheckpointPipeline(opts: {
  projectId: string;
  userId: string;
  input: CheckpointInput;
}): Promise<PipelineResult> {
  const ctx = createPipelineContext({
    pipelineName: 'checkpoint',
    projectId: opts.projectId,
    userId: opts.userId,
  });

  // Build attestation input from checkpoint
  const BuildCheckpointAttestationStep: PipelineStep = {
    name: 'build_checkpoint_attestation',
    description: 'Build attestation payload from checkpoint',
    async execute(input, ctx) {
      const checkpointId = getArtifact<string>(ctx, 'checkpoint.id');
      const version = getArtifact<number>(ctx, 'checkpoint.version');
      const hash = getArtifact<string>(ctx, 'checkpoint.hash');
      const episodeCount = getArtifact<number>(ctx, 'checkpoint.episodeCount');
      const eventCount = getArtifact<number>(ctx, 'checkpoint.eventCount');
      const attestationCount = getArtifact<number>(ctx, 'checkpoint.attestationCount');
      const attestationIds = getArtifact<string[]>(ctx, 'checkpoint.attestationIds');
      const parentId = getArtifact<string>(ctx, 'checkpoint.parentId');

      return {
        eventType: 'checkpoint_created',
        target: {
          subjectType: 'checkpoint',
          subjectId: checkpointId!,
          sourceArtifactIds: attestationIds ?? [],
        },
        canonicalData: {
          checkpointId,
          version,
          snapshotHash: hash,
          episodeCount,
          eventCount,
          attestationCount,
          parentCheckpointId: parentId,
        },
      } as AttestationInput;
    },
  };

  return executePipeline(
    'checkpoint',
    [
      CreateCheckpointStep,
      BuildCheckpointAttestationStep,
      CreateAttestationStep,
      RecordCheckpointProvenanceStep,
      AnchorAttestationStep,
    ],
    opts.input,
    ctx
  );
}

// ============================================================
// 6. EXPORT PIPELINE
// ============================================================
// Flow: Gather Data → Build Content → Hash → Attest
//       → OUTPUT Provenance → Anchor

export async function executeExportPipeline(opts: {
  projectId: string;
  userId: string;
  format: 'json' | 'csv';
}): Promise<PipelineResult> {
  const ctx = createPipelineContext({
    pipelineName: 'export',
    projectId: opts.projectId,
    userId: opts.userId,
  });

  // Build attestation from export results
  const BuildExportAttestationStep: PipelineStep = {
    name: 'build_export_attestation',
    description: 'Build attestation payload from export content',
    async execute(input, ctx) {
      const hash = getArtifact<string>(ctx, 'export.hash');
      const format = getArtifact<string>(ctx, 'export.format');
      const episodeCount = getArtifact<number>(ctx, 'export.episodeCount');

      return {
        eventType: 'data_exported',
        target: {
          subjectType: 'export',
          subjectId: `export-${ctx.projectId}-${format}-${(hash ?? '').slice(0, 16)}`,
        },
        canonicalData: {
          format,
          episodeCount,
          outputHash: hash,
        },
      } as AttestationInput;
    },
  };

  return executePipeline(
    'export',
    [
      BuildExportStep,
      BuildExportAttestationStep,
      CreateAttestationStep,
      RecordExportProvenanceStep,
      AnchorAttestationStep,
    ],
    { format: opts.format },
    ctx
  );
}
