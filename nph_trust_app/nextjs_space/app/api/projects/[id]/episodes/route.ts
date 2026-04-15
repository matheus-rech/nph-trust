export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const episodes = await prisma.patientEpisode.findMany({
      where: { projectId: params.id },
      include: {
        site: { select: { id: true, name: true, identifier: true } },
        pathwayEvents: {
          include: { stageDefinition: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(episodes);
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
    if (!body?.pseudoId) return NextResponse.json({ error: 'pseudoId required' }, { status: 400 });
    const episode = await prisma.patientEpisode.create({
      data: {
        projectId: params.id,
        pseudoId: body.pseudoId,
        siteId: body.siteId ?? null,
        metadata: body.metadata ?? null,
      },
      include: { site: true },
    });
    return NextResponse.json(episode, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: 'Duplicate pseudoId' }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
