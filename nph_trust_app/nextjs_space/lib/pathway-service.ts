// ============================================================
// NPH-Trust Pathway Event Service
// ============================================================
// Enforces pathway event lifecycle transitions.
// State is NOT freely mutable — all mutations go through here.
// ============================================================

import { prisma } from './db';
import {
  enforcePathwayEventTransition,
  PathwayEventLifecycleError,
} from './lifecycle';
import { createAttestation } from './attestation-service';
import { recordEventNode } from './provenance';
import type { PathwayEventStatusType } from './types';

export interface TransitionEventParams {
  eventId: string;
  newStatus: PathwayEventStatusType;
  projectId: string;
  userId: string;
  data?: Record<string, unknown>;
  notes?: string;
  performedBy?: string;
  occurredAt?: string;
  completedAt?: string;
}

export interface TransitionResult {
  event: any;
  attestation?: any;
  lifecycleError?: string;
}

/**
 * Transition a pathway event to a new status.
 * Enforces the lifecycle state machine:
 *   PENDING → IN_PROGRESS → COMPLETED (terminal)
 *   PENDING → SKIPPED / CANCELLED
 *   FAILED → PENDING / IN_PROGRESS (retry)
 *
 * Throws PathwayEventLifecycleError on invalid transition.
 * Auto-creates attestation on COMPLETED transition.
 */
export async function transitionPathwayEvent(
  params: TransitionEventParams
): Promise<TransitionResult> {
  const existing = await prisma.pathwayEvent.findUnique({
    where: { id: params.eventId },
    include: { stageDefinition: true },
  });
  if (!existing) {
    throw new Error(`Pathway event ${params.eventId} not found`);
  }

  const currentStatus = existing.status as PathwayEventStatusType;

  // Enforce lifecycle transition
  enforcePathwayEventTransition(currentStatus, params.newStatus);

  // Build update data
  const updateData: Record<string, any> = {
    status: params.newStatus,
  };
  if (params.data !== undefined) updateData.data = params.data;
  if (params.notes !== undefined) updateData.notes = params.notes;
  if (params.performedBy !== undefined) updateData.performedBy = params.performedBy;
  if (params.occurredAt) updateData.occurredAt = new Date(params.occurredAt);
  if (params.completedAt) updateData.completedAt = new Date(params.completedAt);
  if (params.newStatus === 'COMPLETED' && !params.completedAt) {
    updateData.completedAt = new Date();
  }

  // Execute the transition
  const event = await prisma.pathwayEvent.update({
    where: { id: params.eventId },
    data: updateData,
    include: { stageDefinition: true },
  });

  // Log the transition in RunLog
  const runLog = await prisma.runLog.create({
    data: {
      projectId: params.projectId,
      action: `pathway_event.transition.${currentStatus}_to_${params.newStatus}`,
      status: 'SUCCESS',
      inputSummary: {
        eventId: params.eventId,
        from: currentStatus,
        to: params.newStatus,
        stageType: existing.stageDefinition.stageType,
      } as any,
      triggeredBy: params.userId,
    },
  });

  let attestation: any = undefined;

  // Auto-attest on COMPLETED
  if (params.newStatus === 'COMPLETED') {
    try {
      const result = await createAttestation({
        projectId: params.projectId,
        eventType: 'pathway_event_completed',
        target: {
          subjectType: 'pathway_event',
          subjectId: params.eventId,
          eventId: params.eventId,
        },
        canonicalData: {
          eventId: params.eventId,
          stageType: existing.stageDefinition.stageType,
          status: 'COMPLETED',
          data: params.data ?? existing.data ?? {},
        },
        createdById: params.userId,
      });
      attestation = result.attestation;

      // Record in provenance graph
      await recordEventNode({
        projectId: params.projectId,
        eventType: 'pathway_event_completed',
        entityType: 'pathway_event',
        entityId: params.eventId,
        label: `${existing.stageDefinition.stageType} completed`,
        attestationId: result.attestation.id,
        runLogId: runLog.id,
      });
    } catch (attErr: any) {
      console.error('Attestation creation error (non-blocking):', attErr?.message);
    }
  } else if (params.newStatus !== currentStatus) {
    // Record non-terminal transitions in provenance too
    try {
      await recordEventNode({
        projectId: params.projectId,
        eventType: `pathway_event_${params.newStatus.toLowerCase()}`,
        entityType: 'pathway_event',
        entityId: params.eventId,
        label: `${existing.stageDefinition.stageType}: ${currentStatus} → ${params.newStatus}`,
        runLogId: runLog.id,
      });
    } catch (err: any) {
      console.error('Provenance recording error (non-blocking):', err?.message);
    }
  }

  return { event, attestation };
}
