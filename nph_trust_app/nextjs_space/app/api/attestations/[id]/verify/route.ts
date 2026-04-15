export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { verifyAttestation } from '@/lib/attestation-service';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await verifyAttestation(params.id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? 'Verification failed' }, { status: 500 });
  }
}
