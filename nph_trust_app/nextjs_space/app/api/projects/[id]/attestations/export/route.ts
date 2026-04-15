export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const attestations = await prisma.attestation.findMany({
      where: { projectId: params.id },
      include: { createdBy: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ projectId: params.id, exportedAt: new Date().toISOString(), attestations });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
