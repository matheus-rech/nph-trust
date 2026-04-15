export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';
import { executeImportExecutePipeline } from '@/lib/pipeline';

export async function POST(_req: Request, { params }: { params: { jobId: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    // Resolve project from job
    const job = await prisma.importJob.findUnique({
      where: { id: params.jobId },
      select: { id: true, projectId: true, status: true },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (job.status !== 'VALIDATED') {
      return NextResponse.json({ error: 'Job not in VALIDATED state' }, { status: 400 });
    }

    const result = await executeImportExecutePipeline({
      projectId: job.projectId,
      userId: auth.id,
      jobId: params.jobId,
    });

    if (result.status === 'FAILED') {
      return NextResponse.json(
        { error: result.error ?? 'Import execution failed', pipeline: result },
        { status: 500 }
      );
    }

    // Return updated job
    const updatedJob = await prisma.importJob.findUnique({ where: { id: params.jobId } });
    return NextResponse.json({
      ...updatedJob,
      pipeline: {
        pipelineId: result.pipelineId,
        status: result.status,
        steps: result.stepsExecuted,
        provenanceNodeIds: result.provenanceNodeIds,
        attestationIds: result.attestationIds,
        warnings: result.warnings,
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
