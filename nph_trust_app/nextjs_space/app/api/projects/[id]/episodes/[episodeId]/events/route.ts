export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { executePathwayEventPipeline } from '@/lib/pipeline';

export async function GET(_req: Request, { params }: { params: { id: string; episodeId: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const events = await prisma.pathwayEvent.findMany({
      where: { patientEpisodeId: params.episodeId },
      include: { stageDefinition: true, attestations: true },
      orderBy: { stageDefinition: { sortOrder: 'asc' } },
    });
    return NextResponse.json(events);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string; episodeId: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    if (!body?.stageType) return NextResponse.json({ error: 'stageType required' }, { status: 400 });

    const result = await executePathwayEventPipeline({
      projectId: params.id,
      userId: auth.id,
      input: {
        episodeId: params.episodeId,
        stageType: body.stageType,
        status: body.status,
        occurredAt: body.occurredAt,
        completedAt: body.completedAt,
        performedBy: body.performedBy,
        notes: body.notes,
        data: body.data,
        createAttestation: body.createAttestation,
      },
    });

    if (result.status === 'FAILED') {
      // Check if it's a validation error
      const failedStep = result.stepsExecuted.find((s) => s.status === 'failed');
      if (failedStep?.error?.includes('Invalid stage type')) {
        return NextResponse.json({ error: 'Invalid stage type' }, { status: 400 });
      }
      return NextResponse.json(
        { error: result.error ?? 'Event creation failed', pipeline: result },
        { status: 500 }
      );
    }

    // Extract the event from pipeline output
    const pipelineOutput = result.output as any;
    const event = pipelineOutput?.event ?? pipelineOutput;

    return NextResponse.json(
      {
        ...event,
        pipeline: {
          pipelineId: result.pipelineId,
          status: result.status,
          steps: result.stepsExecuted,
          provenanceNodeIds: result.provenanceNodeIds,
          attestationIds: result.attestationIds,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
