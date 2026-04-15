export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const stages = await prisma.pathwayStageDefinition.findMany({ orderBy: { sortOrder: 'asc' } });
    return NextResponse.json(stages);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
