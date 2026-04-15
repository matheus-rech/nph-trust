export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { createAttestation } from '@/lib/attestation-service';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const attestations = await prisma.attestation.findMany({
      where: { projectId: params.id },
      include: {
        createdBy: { select: { displayName: true, email: true } },
        pathwayEvent: { include: { stageDefinition: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(attestations);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { subjectType, subjectId, canonicalData, eventType, sourceArtifactIds } = body ?? {};
    if (!subjectType || !subjectId) {
      return NextResponse.json(
        { error: 'Attestation requires a clear target: subjectType and subjectId are mandatory' },
        { status: 400 }
      );
    }

    const result = await createAttestation({
      projectId: params.id,
      eventType: eventType ?? 'manual_attestation',
      target: {
        subjectType,
        subjectId,
        eventId: subjectType === 'pathway_event' ? subjectId : undefined,
        sourceArtifactIds: sourceArtifactIds ?? [],
      },
      canonicalData: canonicalData ?? {},
      createdById: auth.id,
    });

    if (result.isDuplicate) {
      return NextResponse.json(
        { error: 'Duplicate attestation', existingId: result.attestation.id, idempotencyKey: result.attestation.idempotencyKey },
        { status: 409 }
      );
    }

    return NextResponse.json(result.attestation, { status: 201 });
  } catch (err: any) {
    console.error('Attestation creation error:', err);
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 });
  }
}
