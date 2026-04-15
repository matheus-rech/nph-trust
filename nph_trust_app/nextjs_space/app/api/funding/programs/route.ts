export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

// GET /api/funding/programs — list funding programs
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const status = url.searchParams.get('status');

  try {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const programs = await prisma.fundingProgram.findMany({
      where,
      include: {
        milestoneConfigs: true,
        createdBy: { select: { displayName: true, email: true } },
        _count: { select: { claims: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(programs);
  } catch (err: any) {
    console.error('[funding/programs GET]', err);
    return NextResponse.json({ error: 'Failed to list programs' }, { status: 500 });
  }
}

// POST /api/funding/programs — create a new funding program
export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { projectId, name, funderName, description, totalBudget, budgetCurrency, validFrom, validUntil } = body ?? {};

    if (!projectId || !name || !funderName) {
      return NextResponse.json(
        { error: 'projectId, name, and funderName are required' },
        { status: 400 },
      );
    }

    const program = await prisma.fundingProgram.create({
      data: {
        projectId,
        name,
        funderName,
        description: description ?? null,
        totalBudget: totalBudget ?? 0,
        budgetCurrency: budgetCurrency ?? 'USDC',
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        createdById: auth.id,
      },
      include: { milestoneConfigs: true },
    });

    return NextResponse.json(program, { status: 201 });
  } catch (err: any) {
    console.error('[funding/programs POST]', err);
    return NextResponse.json({ error: 'Failed to create program' }, { status: 500 });
  }
}
