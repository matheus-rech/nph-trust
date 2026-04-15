export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

// GET /api/funding/claims — list funding claims with filters
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const programId = url.searchParams.get('programId');
  const projectId = url.searchParams.get('projectId');
  const status = url.searchParams.get('status');
  const milestoneType = url.searchParams.get('milestoneType');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  try {
    const where: any = {};
    if (programId) where.programId = programId;
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (milestoneType) where.milestoneType = milestoneType;

    const [claims, total] = await Promise.all([
      prisma.fundingClaim.findMany({
        where,
        include: {
          program: { select: { name: true, funderName: true } },
          verifiedBy: { select: { displayName: true } },
          _count: { select: { payoutAttempts: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.fundingClaim.count({ where }),
    ]);

    return NextResponse.json({ claims, total, limit, offset });
  } catch (err: any) {
    console.error('[funding/claims GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
