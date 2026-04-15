// ============================================================
// NPH-Trust Deferred Edge Linking Step
// ============================================================
// Runs AFTER RecordImportProvenanceChainStep.
// Connects reconciled event provenance nodes to the import
// chain's OUTPUT node via DERIVED_FROM edges.
//
// Skips gracefully if:
//   - No OUTPUT node exists (import chain step failed/degraded)
//   - No reconciled event nodes exist
// ============================================================

import { prisma } from '../../db';
import { createProvenanceEdge, EDGE_TYPES } from '../../provenance';
import type { PipelineStep, PipelineContext } from '../types';
import { getArtifact, addWarning, setArtifact } from '../context';

export const LinkReconciledEventsStep: PipelineStep = {
  name: 'link_reconciled_events',
  description: 'Connect reconciled event nodes to import chain OUTPUT node',

  shouldSkip(_input: unknown, ctx: PipelineContext): boolean {
    const eventNodeIds = getArtifact<string[]>(ctx, 'reconciliation.eventNodeIds');
    return !eventNodeIds || eventNodeIds.length === 0;
  },

  async execute(input: unknown, ctx: PipelineContext) {
    // Get the import chain's OUTPUT node ID
    // RecordImportProvenanceChainStep stores chain nodes in ctx.provenanceNodeIds
    // The OUTPUT node is the last one added by that step (3rd of 3: input, transform, output)
    // We also check for an explicit artifact key
    let outputNodeId = getArtifact<string>(ctx, 'provenance.outputNodeId');

    // If not explicitly set, try to find the import job's OUTPUT provenance node
    if (!outputNodeId) {
      const jobId = getArtifact<string>(ctx, 'transform.jobId');
      if (jobId) {
        const outputNode = await prisma.provenanceNode.findFirst({
          where: {
            projectId: ctx.projectId,
            entityType: 'import_job',
            entityId: jobId,
            nodeType: 'OUTPUT',
          },
        });
        outputNodeId = outputNode?.id;
      }
    }

    if (!outputNodeId) {
      addWarning(ctx, 'link_reconciled_events',
        'No import chain OUTPUT node found — skipping edge linkage (import chain step may have failed)'
      );
      return input;
    }

    const eventNodeIds = getArtifact<string[]>(ctx, 'reconciliation.eventNodeIds') ?? [];
    let edgesCreated = 0;

    for (const eventNodeId of eventNodeIds) {
      try {
        await createProvenanceEdge({
          sourceId: outputNodeId,
          targetId: eventNodeId,
          edgeType: EDGE_TYPES.DERIVED_FROM,
        });
        edgesCreated++;
      } catch (err: any) {
        addWarning(ctx, 'link_reconciled_events',
          `Failed to link event node ${eventNodeId} to import chain: ${err?.message}`
        );
      }
    }

    setArtifact(ctx, 'reconciliation.edgesLinked', edgesCreated);
    console.log(`[LinkReconciledEvents] Linked ${edgesCreated}/${eventNodeIds.length} event nodes to import chain OUTPUT`);

    return input;
  },
};
