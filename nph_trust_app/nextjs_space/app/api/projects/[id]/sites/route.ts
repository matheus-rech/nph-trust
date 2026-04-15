export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const sites = await prisma.site.findMany({
      where: { projectId: params.id },
      include: { _count: { select: { patientEpisodes: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(sites);
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
    if (!body?.name || !body?.identifier) return NextResponse.json({ error: 'Name and identifier required' }, { status: 400 });
    const site = await prisma.site.create({
      data: {
        projectId: params.id,
        name: body.name,
        identifier: body.identifier,
        metadata: body.metadata ?? null,
      },
    });
    return NextResponse.json(site, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
