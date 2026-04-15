export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { executeImportUploadPipeline } from '@/lib/pipeline';
import { getArtifact } from '@/lib/pipeline';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN', 'RESEARCHER', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const result = await executeImportUploadPipeline({
      projectId: params.id,
      userId: auth.id,
      file,
    });

    if (result.status === 'FAILED') {
      return NextResponse.json(
        { error: result.error ?? 'Import upload failed', pipeline: result },
        { status: 500 }
      );
    }

    // Extract pipeline artifacts for the response
    const output = result.output as any;
    return NextResponse.json({
      job: output?.jobId ? { id: output.jobId } : undefined,
      artifact: output?.artifactId ? { id: output.artifactId } : undefined,
      preview: (output?.rows ?? []).slice(0, 10),
      totalRows: output?.rows?.length ?? 0,
      errors: output?.errors ?? [],
      headers: output?.headers ?? [],
      pipeline: {
        pipelineId: result.pipelineId,
        status: result.status,
        steps: result.stepsExecuted,
        provenanceNodeIds: result.provenanceNodeIds,
      },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Import failed: ' + (err?.message ?? 'Unknown') }, { status: 500 });
  }
}
