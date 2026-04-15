export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

// GET /api/funding/programs/[id]/milestones — list milestone configs
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const configs = await prisma.fundingMilestoneConfig.findMany({
      where: { programId: params.id },
      orderBy: { milestoneType: 'asc' },
    });
    return NextResponse.json(configs);
  } catch (err: any) {
    console.error('[milestones GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/funding/programs/[id]/milestones — create/update milestone config
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { milestoneType, label, amount, enabled, stageType, requiredStatus, dataConditions } = body ?? {};

    if (!milestoneType || !label || amount === undefined || !stageType) {
      return NextResponse.json(
        { error: 'milestoneType, label, amount, and stageType are required' },
        { status: 400 },
      );
    }

    const config = await prisma.fundingMilestoneConfig.upsert({
      where: {
        programId_milestoneType: {
          programId: params.id,
          milestoneType,
        },
      },
      create: {
        programId: params.id,
        milestoneType,
        label,
        amount,
        enabled: enabled ?? true,
        stageType,
        requiredStatus: requiredStatus ?? 'COMPLETED',
        dataConditions: dataConditions ?? null,
      },
      update: {
        label,
        amount,
        enabled: enabled ?? true,
        stageType,
        requiredStatus: requiredStatus ?? 'COMPLETED',
        dataConditions: dataConditions ?? null,
      },
    });

    return NextResponse.json(config, { status: 201 });
  } catch (err: any) {
    console.error('[milestones POST]', err);
    return NextResponse.json({ error: 'Failed to configure milestone' }, { status: 500 });
  }
}
