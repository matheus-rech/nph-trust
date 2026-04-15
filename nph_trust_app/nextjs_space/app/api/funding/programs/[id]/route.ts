export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

// GET /api/funding/programs/[id] — get program detail
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const program = await prisma.fundingProgram.findUnique({
      where: { id: params.id },
      include: {
        milestoneConfigs: { orderBy: { milestoneType: 'asc' } },
        createdBy: { select: { displayName: true, email: true } },
        _count: { select: { claims: true } },
      },
    });

    if (!program) {
      return NextResponse.json({ error: 'Program not found' }, { status: 404 });
    }

    return NextResponse.json(program);
  } catch (err: any) {
    console.error('[funding/programs/[id] GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PUT /api/funding/programs/[id] — update program status or fields
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const allowedFields = [
      'status', 'name', 'description', 'funderName',
      'totalBudget', 'budgetCurrency', 'validFrom', 'validUntil',
      'chainId', 'contractAddress', 'onChainProgramId',
      'tokenAddress', 'tokenSymbol', 'tokenDecimals',
    ];

    const data: any = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'validFrom' || field === 'validUntil') {
          data[field] = body[field] ? new Date(body[field]) : null;
        } else {
          data[field] = body[field];
        }
      }
    }

    const program = await prisma.fundingProgram.update({
      where: { id: params.id },
      data,
      include: { milestoneConfigs: true },
    });

    return NextResponse.json(program);
  } catch (err: any) {
    console.error('[funding/programs/[id] PUT]', err);
    return NextResponse.json({ error: 'Failed to update program' }, { status: 500 });
  }
}
