// ============================================================
// NPH-Trust Post-Import Reconciliation Step
// ============================================================
// Runs after ExecuteImportTransformStep. Sweeps newly created
// PathwayEvents for the import job and:
//   1. Validates lifecycle state
//   2. Creates attestations for COMPLETED events
//   3. Creates IMPORT_RECONCILED provenance nodes
//   4. Stores ReconciliationSummary in context
//
// Severity: degraded (individual failures don't abort pipeline)
// Idempotent: re-running produces no duplicates
// ============================================================

import { prisma } from '../../db';
import { ensureProvenanceNode, createProvenanceEdge, EDGE_TYPES } from '../../provenance';
import { createAttestation } from '../../attestation-service';
import type { PipelineStep, PipelineContext } from '../types';
import { PipelineError } from '../types';
import { setArtifact, getArtifact, addWarning } from '../context';

export interface ReconciliationSummary {
  totalScanned: number;
  eligible: number;
  reconciled: number;
  skipped: number;
  invalid: number;
  attestationsCreated: number;
  provenanceNodesCreated: number;
  provenanceEdgesCreated: number;
  warnings: string[];
  errors: Array<{ eventId: string; reason: string; errorClass: string }>;
}

export const ReconcileImportedEventsStep: PipelineStep = {
  name: 'reconcile_imported_events',
  description: 'Validate imported events, create attestations and provenance nodes for eligible COMPLETED events',

  async execute(input: unknown, ctx: PipelineContext) {
    const jobId = getArtifact<string>(ctx, 'transform.jobId');
    if (!jobId) {
      throw new PipelineError({
        stepName: 'reconcile_imported_events',
        pipelineId: ctx.pipelineId,
        message: 'No jobId in context — ExecuteImportTransformStep must run first',
        severity: 'degraded',
      });
    }

    // Scope reconciliation to events created by THIS import job only.
    // ExecuteImportTransformStep stores created event IDs in context.
    const createdEventIds = getArtifact<string[]>(ctx, 'transform.createdEventIds');
    if (!createdEventIds || createdEventIds.length === 0) {
      // No events were created by the import — nothing to reconcile
      addWarning(ctx, 'reconcile_imported_events', 'No events created by import — skipping reconciliation');
      setArtifact(ctx, 'reconciliation.summary', {
        totalScanned: 0, eligible: 0, reconciled: 0, skipped: 0, invalid: 0,
        attestationsCreated: 0, provenanceNodesCreated: 0, provenanceEdgesCreated: 0,
        warnings: ['No events created by import'], errors: [],
      } as ReconciliationSummary);
      setArtifact(ctx, 'reconciliation.eventNodeIds', []);
      return input;
    }

    // Query only the events created by this import batch
    const events = await prisma.pathwayEvent.findMany({
      where: {
        id: { in: createdEventIds },
      },
      include: {
        stageDefinition: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter to events that don't already have provenance nodes (idempotency)
    const eventsNeedingReconciliation: typeof events = [];
    for (const evt of events) {
      const existingNode = await prisma.provenanceNode.findFirst({
        where: {
          projectId: ctx.projectId,
          entityType: 'pathway_event',
          entityId: evt.id,
        },
      });
      if (!existingNode) {
        eventsNeedingReconciliation.push(evt);
      }
    }

    const summary: ReconciliationSummary = {
      totalScanned: eventsNeedingReconciliation.length,
      eligible: 0,
      reconciled: 0,
      skipped: 0,
      invalid: 0,
      attestationsCreated: 0,
      provenanceNodesCreated: 0,
      provenanceEdgesCreated: 0,
      warnings: [],
      errors: [],
    };

    // Store event node IDs for later edge linking (LinkReconciledEventsStep)
    const reconciledEventNodeIds: string[] = [];

    for (const evt of eventsNeedingReconciliation) {
      // 1. Validate lifecycle state
      if (!evt.stageDefinition) {
        summary.invalid++;
        summary.errors.push({
          eventId: evt.id,
          reason: `Missing or invalid stage definition (stageDefinitionId: ${evt.stageDefinitionId})`,
          errorClass: 'INVALID_STAGE_DEFINITION',
        });
        continue;
      }

      const isCompleted = evt.status === 'COMPLETED';
      const isSkippable = ['PENDING', 'IN_PROGRESS', 'SKIPPED', 'CANCELLED'].includes(evt.status);

      if (!isCompleted && !isSkippable) {
        summary.invalid++;
        summary.errors.push({
          eventId: evt.id,
          reason: `Unexpected event status: ${evt.status}`,
          errorClass: 'INVALID_STATUS',
        });
        continue;
      }

      summary.eligible++;

      try {
        // 2. Create provenance node (all eligible events get one)
        const { node: provNode, created: nodeCreated } = await ensureProvenanceNode({
          projectId: ctx.projectId,
          nodeType: 'EVENT',
          label: `${evt.stageDefinition.stageType}: ${evt.status}`,
          entityType: 'pathway_event',
          entityId: evt.id,
          metadata: {
            origin: 'IMPORT_RECONCILED',
            importJobId: jobId,
            reconciliationTimestamp: new Date().toISOString(),
            confidence: 'HIGH',
            stageType: evt.stageDefinition.stageType,
            status: evt.status,
          },
        });

        if (nodeCreated) {
          summary.provenanceNodesCreated++;
          ctx.provenanceNodeIds.push(provNode.id);
        }
        reconciledEventNodeIds.push(provNode.id);

        // 3. Create attestation for COMPLETED events only
        if (isCompleted) {
          try {
            const attResult = await createAttestation({
              projectId: ctx.projectId,
              eventType: 'pathway_event_completed',
              target: {
                subjectType: 'pathway_event',
                subjectId: evt.id,
                eventId: evt.id,
              },
              canonicalData: {
                eventId: evt.id,
                stageType: evt.stageDefinition.stageType,
                status: 'COMPLETED',
                data: evt.data ?? {},
              },
              createdById: ctx.userId,
            });

            if (!attResult.isDuplicate) {
              summary.attestationsCreated++;
              ctx.attestationIds.push(attResult.attestation.id);

              // Link event node to attestation node
              if (attResult.attestation.provenanceNodeId) {
                await createProvenanceEdge({
                  sourceId: provNode.id,
                  targetId: attResult.attestation.provenanceNodeId,
                  edgeType: EDGE_TYPES.ATTESTED_BY,
                });
                summary.provenanceEdgesCreated++;
              }
            }
          } catch (attErr: any) {
            summary.warnings.push(`Attestation failed for event ${evt.id}: ${attErr?.message}`);
          }
        }

        summary.reconciled++;
      } catch (err: any) {
        summary.skipped++;
        summary.warnings.push(`Reconciliation failed for event ${evt.id}: ${err?.message}`);
      }
    }

    // Invariant check
    if (summary.invalid + summary.reconciled + summary.skipped !== summary.totalScanned) {
      summary.warnings.push(
        `Invariant violation: invalid(${summary.invalid}) + reconciled(${summary.reconciled}) + skipped(${summary.skipped}) !== totalScanned(${summary.totalScanned})`
      );
    }

    // Store summary and event node IDs in context
    setArtifact(ctx, 'reconciliation.summary', summary);
    setArtifact(ctx, 'reconciliation.eventNodeIds', reconciledEventNodeIds);

    console.log(
      `[Reconciliation] Scanned: ${summary.totalScanned}, Eligible: ${summary.eligible}, ` +
      `Reconciled: ${summary.reconciled}, Skipped: ${summary.skipped}, Invalid: ${summary.invalid}, ` +
      `Attestations: ${summary.attestationsCreated}, Nodes: ${summary.provenanceNodesCreated}, ` +
      `Edges: ${summary.provenanceEdgesCreated}`
    );

    if (summary.errors.length > 0) {
      addWarning(ctx, 'reconcile_imported_events',
        `${summary.errors.length} invalid event(s) excluded from reconciliation`
      );
    }

    return input;
  },
};
