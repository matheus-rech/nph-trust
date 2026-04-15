export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const [project, episodes, events, attestations, recentActivity, approvals] = await Promise.all([
      prisma.project.findUnique({ where: { id: params.id }, include: { sites: true, _count: { select: { patientEpisodes: true, attestations: true, checkpoints: true } } } }),
      prisma.patientEpisode.findMany({ where: { projectId: params.id }, select: { id: true, pseudoId: true, siteId: true, metadata: true } }),
      prisma.pathwayEvent.findMany({ where: { patientEpisode: { projectId: params.id } }, include: { stageDefinition: true } }),
      prisma.attestation.findMany({ where: { projectId: params.id }, select: { id: true, status: true, createdAt: true } }),
      prisma.auditEntry.findMany({ where: { entityType: { in: ['project', 'patient_episode', 'pathway_event', 'attestation'] } }, orderBy: { createdAt: 'desc' }, take: 20, include: { actor: { select: { displayName: true } } } }),
      prisma.approval.findMany({ where: { targetType: 'PATHWAY_EVENT' } }),
    ]);
    // Stage distribution
    const stageDistribution: Record<string, { total: number; completed: number; inProgress: number; pending: number }> = {};
    (events ?? []).forEach((e: any) => {
      const st = e?.stageDefinition?.stageType ?? 'UNKNOWN';
      if (!stageDistribution[st]) stageDistribution[st] = { total: 0, completed: 0, inProgress: 0, pending: 0 };
      stageDistribution[st].total++;
      if (e.status === 'COMPLETED') stageDistribution[st].completed++;
      else if (e.status === 'IN_PROGRESS') stageDistribution[st].inProgress++;
      else if (e.status === 'PENDING') stageDistribution[st].pending++;
    });
    // Attestation summary
    const attSummary: Record<string, number> = {};
    (attestations ?? []).forEach((a: any) => { attSummary[a.status] = (attSummary[a.status] ?? 0) + 1; });
    // Approval summary
    const appSummary: Record<string, number> = {};
    (approvals ?? []).forEach((a: any) => { appSummary[a.status] = (appSummary[a.status] ?? 0) + 1; });
    return NextResponse.json({
      project,
      totalEpisodes: episodes?.length ?? 0,
      stageDistribution,
      attestationSummary: attSummary,
      approvalSummary: appSummary,
      recentActivity: recentActivity ?? [],
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
