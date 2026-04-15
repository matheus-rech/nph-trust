export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string; episodeId: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const episode = await prisma.patientEpisode.findUnique({
      where: { id: params.episodeId },
      include: {
        site: true,
        project: { select: { id: true, name: true } },
        pathwayEvents: {
          include: {
            stageDefinition: true,
            attestations: { select: { id: true, status: true, payloadHash: true, createdAt: true } },
          },
          orderBy: { stageDefinition: { sortOrder: 'asc' } },
        },
        fhirResources: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!episode) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(episode);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string; episodeId: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const episode = await prisma.patientEpisode.update({
      where: { id: params.episodeId },
      data: {
        siteId: body?.siteId,
        metadata: body?.metadata,
      },
    });
    return NextResponse.json(episode);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
