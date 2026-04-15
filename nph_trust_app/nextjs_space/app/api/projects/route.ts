export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const projects = await prisma.project.findMany({
      include: {
        sites: true,
        members: { include: { user: { select: { id: true, displayName: true, email: true, role: true } } } },
        _count: { select: { patientEpisodes: true, attestations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(projects);
  } catch (err: any) {
    console.error('GET projects error:', err);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { name, description, status } = body ?? {};
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    const project = await prisma.project.create({
      data: {
        name,
        description: description ?? null,
        status: status ?? 'DRAFT',
        members: { create: { userId: auth.id, role: auth.role } },
      },
      include: { members: true },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (err: any) {
    console.error('POST project error:', err);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
