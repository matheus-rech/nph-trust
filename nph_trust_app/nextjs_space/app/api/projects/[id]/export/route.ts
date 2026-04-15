export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { executeExportPipeline, getArtifact, createPipelineContext } from '@/lib/pipeline';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const format = (url.searchParams.get('format') ?? 'json') as 'json' | 'csv';
  try {
    const result = await executeExportPipeline({
      projectId: params.id,
      userId: auth.id,
      format,
    });

    if (result.status === 'FAILED') {
      return NextResponse.json(
        { error: result.error ?? 'Export failed', pipeline: result },
        { status: 500 }
      );
    }

    const pipelineOutput = result.output as any;
    const content = pipelineOutput?.content;
    const episodes = pipelineOutput?.episodes;

    if (format === 'csv') {
      return new Response(content, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="export-${params.id}.csv"`,
        },
      });
    }

    return NextResponse.json({
      projectId: params.id,
      exportedAt: new Date().toISOString(),
      episodes,
      pipeline: {
        pipelineId: result.pipelineId,
        status: result.status,
        steps: result.stepsExecuted,
        provenanceNodeIds: result.provenanceNodeIds,
        attestationIds: result.attestationIds,
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
