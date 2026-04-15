import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { NextResponse } from 'next/server';

export type AppRole = 'ADMIN' | 'RESEARCHER' | 'COORDINATOR' | 'AUDITOR';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;
    const u = session.user as any;
    return {
      id: u?.id ?? '',
      email: u?.email ?? '',
      name: u?.name ?? '',
      role: (u?.role ?? 'RESEARCHER') as AppRole,
    };
  } catch {
    return null;
  }
}

export function checkRole(userRole: AppRole, allowedRoles: AppRole[]): boolean {
  return allowedRoles.includes(userRole);
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function requireAuth(allowedRoles?: AppRole[]): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (allowedRoles && !checkRole(user.role, allowedRoles)) return forbidden();
  return user;
}
