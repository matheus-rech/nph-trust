export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  try {
    const where: any = {};
    if (status) where.status = status;
    const approvals = await prisma.approval.findMany({
      where,
      include: {
        reviewedBy: { select: { displayName: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
    return NextResponse.json(approvals);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { targetType, targetId, comment } = body ?? {};
    if (!targetType || !targetId) return NextResponse.json({ error: 'targetType and targetId required' }, { status: 400 });
    const approval = await prisma.approval.create({
      data: { targetType, targetId, requestedById: auth.id, status: 'PENDING', comment: comment ?? null },
    });
    return NextResponse.json(approval, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
