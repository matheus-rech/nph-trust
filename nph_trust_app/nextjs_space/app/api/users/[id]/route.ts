export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        role: body?.role,
        isActive: body?.isActive,
        displayName: body?.displayName,
      },
      select: { id: true, email: true, displayName: true, role: true, isActive: true },
    });
    return NextResponse.json(user);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
