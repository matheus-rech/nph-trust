export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: params.id },
      include: { user: { select: { id: true, displayName: true, email: true, role: true } } },
    });
    return NextResponse.json(members);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const member = await prisma.projectMember.create({
      data: { projectId: params.id, userId: body?.userId, role: body?.role ?? 'RESEARCHER' },
      include: { user: { select: { id: true, displayName: true, email: true, role: true } } },
    });
    return NextResponse.json(member, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: 'Already a member' }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
