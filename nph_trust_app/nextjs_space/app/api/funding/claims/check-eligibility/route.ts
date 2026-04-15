export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { FundingPayoutService } from '@/lib/funding/payout-service';
import { MilestoneType } from '@/lib/funding/types';

// POST /api/funding/claims/check-eligibility
export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { projectId, episodeId, milestoneType, programId } = body ?? {};

    if (!projectId || !episodeId || milestoneType === undefined || !programId) {
      return NextResponse.json(
        { error: 'projectId, episodeId, milestoneType, and programId are required' },
        { status: 400 },
      );
    }

    // Validate milestoneType is a valid enum value
    if (!(milestoneType in MilestoneType) && typeof milestoneType !== 'number') {
      return NextResponse.json(
        { error: `Invalid milestoneType: ${milestoneType}` },
        { status: 400 },
      );
    }

    const service = new FundingPayoutService();
    const result = await service.checkEligibility({
      projectId,
      episodeId,
      milestoneType: typeof milestoneType === 'number' ? milestoneType : parseInt(milestoneType, 10),
      programId,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[check-eligibility POST]', err);
    return NextResponse.json({ error: 'Eligibility check failed' }, { status: 500 });
  }
}
