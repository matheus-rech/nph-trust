export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { getProvenanceGraph } from '@/lib/provenance';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const [attestations, lineage, artifacts, events, provenanceGraph] = await Promise.all([
      prisma.attestation.findMany({
        where: { projectId: params.id },
        include: { createdBy: { select: { displayName: true } }, pathwayEvent: { include: { stageDefinition: true, patientEpisode: { select: { pseudoId: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.lineageEntry.findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' } }),
      prisma.inputArtifact.findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' } }),
      prisma.pathwayEvent.findMany({
        where: { patientEpisode: { projectId: params.id } },
        include: { stageDefinition: true, patientEpisode: { select: { pseudoId: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      getProvenanceGraph(params.id),
    ]);
    return NextResponse.json({ attestations, lineage, artifacts, events, provenanceGraph });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
