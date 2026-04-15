export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

// GET /api/funding/claims/[id] — claim detail with payout attempts
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const claim = await prisma.fundingClaim.findUnique({
      where: { id: params.id },
      include: {
        program: { select: { name: true, funderName: true, budgetCurrency: true } },
        attestation: {
          select: {
            id: true,
            payloadHash: true,
            status: true,
            eventType: true,
            provenanceNodeId: true,
          },
        },
        verifiedBy: { select: { displayName: true, email: true } },
        payoutAttempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });

    if (!claim) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    return NextResponse.json(claim);
  } catch (err: any) {
    console.error('[funding/claims/[id] GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
