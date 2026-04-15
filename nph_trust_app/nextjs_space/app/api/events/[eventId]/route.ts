export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { transitionPathwayEvent } from '@/lib/pathway-service';
import { PathwayEventLifecycleError } from '@/lib/lifecycle';
import type { PathwayEventStatusType } from '@/lib/types';

export async function PUT(req: Request, { params }: { params: { eventId: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();

    // If status is being changed, enforce lifecycle transition
    if (body?.status) {
      const existing = await prisma.pathwayEvent.findUnique({
        where: { id: params.eventId },
        include: { patientEpisode: true, stageDefinition: true },
      });
      if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

      try {
        const result = await transitionPathwayEvent({
          eventId: params.eventId,
          newStatus: body.status as PathwayEventStatusType,
          projectId: existing.patientEpisode.projectId,
          userId: auth.id,
          data: body.data,
          notes: body.notes,
          performedBy: body.performedBy,
          occurredAt: body.occurredAt,
          completedAt: body.completedAt,
        });
        return NextResponse.json(result.event);
      } catch (err: any) {
        if (err instanceof PathwayEventLifecycleError) {
          return NextResponse.json(
            {
              error: err.message,
              type: 'LIFECYCLE_VIOLATION',
              details: {
                eventId: params.eventId,
                currentStatus: existing.status,
                requestedStatus: body.status,
                stageType: existing.stageDefinition?.stageType,
                isTerminal: existing.status === 'COMPLETED',
              },
            },
            { status: 422 }
          );
        }
        throw err;
      }
    }

    // Non-status updates on COMPLETED events should be restricted to notes only
    const existing = await prisma.pathwayEvent.findUnique({
      where: { id: params.eventId },
      select: { status: true },
    });
    if (existing?.status === 'COMPLETED' && (body?.data !== undefined || body?.performedBy !== undefined)) {
      console.warn(`[events/${params.eventId}] Attempted data modification on COMPLETED event — allowing notes only`);
    }

    const event = await prisma.pathwayEvent.update({
      where: { id: params.eventId },
      data: {
        occurredAt: body?.occurredAt ? new Date(body.occurredAt) : undefined,
        completedAt: body?.completedAt ? new Date(body.completedAt) : undefined,
        performedBy: body?.performedBy,
        notes: body?.notes,
        data: body?.data,
      },
      include: { stageDefinition: true },
    });
    return NextResponse.json(event);
  } catch (err: any) {
    console.error(`[events/${params.eventId}] Update error:`, err);
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 });
  }
}
