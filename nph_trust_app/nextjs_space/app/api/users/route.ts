export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import bcrypt from 'bcryptjs';

export async function GET() {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json(users);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(['ADMIN']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { email, password, name, role } = body ?? {};
    if (!email || !password || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName: name, role: role ?? 'RESEARCHER' },
    });
    return NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role }, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: 'Email exists' }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
