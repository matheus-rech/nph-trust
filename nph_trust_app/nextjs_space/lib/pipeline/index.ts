// ============================================================
// NPH-Trust Pipeline Module — Public API
// ============================================================
// Barrel export for all pipeline components.
// API routes import from here:
//   import { executeImportUploadPipeline } from '@/lib/pipeline';
// ============================================================

// Types
export type {
  PipelineContext,
  PipelineStep,
  PipelineResult,
  PipelineStatus,
  StepOutcome,
  PipelineWarning,
  PipelineDefinition,
  PipelineErrorSeverity,
  TraceabilityReport,
} from './types';
export { PipelineError } from './types';

// Context
export { createPipelineContext, getArtifact, setArtifact, addWarning } from './context';

// Executor
export { executePipeline } from './executor';

// Pre-composed Pipelines
export {
  executeImportUploadPipeline,
  executeImportExecutePipeline,
  executePathwayEventPipeline,
  executeApprovalPipeline,
  executeCheckpointPipeline,
  executeExportPipeline,
} from './pipelines';

// Individual Steps (for custom pipeline composition)
export {
  IngestCSVStep,
  RegisterInputProvenanceStep,
  ExecuteImportTransformStep,
  RecordImportProvenanceChainStep,
  CreateAttestationStep,
  ConditionalAttestationStep,
  AnchorAttestationStep,
  CreatePathwayEventStep,
  BuildEventAttestationInputStep,
  RecordEventProvenanceStep,
  ProcessApprovalStep,
  BuildApprovalAttestationStep,
  RecordApprovalProvenanceStep,
  CreateCheckpointStep,
  RecordCheckpointProvenanceStep,
  BuildExportStep,
  RecordExportProvenanceStep,
} from './steps';

// Reconciliation Steps
export { ReconcileImportedEventsStep } from './steps/reconcile-imported-events';
export { LinkReconciledEventsStep } from './steps/link-reconciled-events';
export type { ReconciliationSummary } from './steps/reconcile-imported-events';
