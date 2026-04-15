export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { FundingPayoutService } from '@/lib/funding/payout-service';
import { MilestoneType } from '@/lib/funding/types';

// POST /api/funding/claims/submit
export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const {
      claimId, programId, siteId, episodeRef,
      milestoneType, attestationHash, recipient, amount,
    } = body ?? {};

    if (!claimId || !programId || !episodeRef || milestoneType === undefined || !attestationHash || !amount) {
      return NextResponse.json(
        { error: 'claimId, programId, episodeRef, milestoneType, attestationHash, and amount are required' },
        { status: 400 },
      );
    }

    const service = new FundingPayoutService();
    const result = await service.submitPayout({
      claimId,
      programId,
      siteId: siteId ?? '',
      episodeRef,
      milestoneType: typeof milestoneType === 'number' ? milestoneType : parseInt(milestoneType, 10),
      attestationHash,
      recipient: recipient ?? '0x0000000000000000000000000000000000000000',
      amount,
    });

    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
  } catch (err: any) {
    console.error('[claims/submit POST]', err);
    return NextResponse.json({ error: 'Payout submission failed' }, { status: 500 });
  }
}
