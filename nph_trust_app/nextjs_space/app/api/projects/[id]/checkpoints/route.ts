export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { executeCheckpointPipeline } from '@/lib/pipeline';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const checkpoints = await prisma.checkpoint.findMany({
      where: { projectId: params.id },
      include: { createdBy: { select: { displayName: true } } },
      orderBy: { version: 'desc' },
    });
    return NextResponse.json(checkpoints);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();

    const result = await executeCheckpointPipeline({
      projectId: params.id,
      userId: auth.id,
      input: {
        label: body?.label,
        description: body?.description,
      },
    });

    if (result.status === 'FAILED') {
      return NextResponse.json(
        { error: result.error ?? 'Checkpoint creation failed', pipeline: result },
        { status: 500 }
      );
    }

    const pipelineOutput = result.output as any;
    const checkpoint = pipelineOutput?.checkpoint ?? pipelineOutput;

    return NextResponse.json(
      {
        ...checkpoint,
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
