export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { executeApprovalPipeline } from '@/lib/pipeline';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth(['ADMIN', 'COORDINATOR']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { status, comment } = body ?? {};
    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Valid status required (APPROVED/REJECTED)' }, { status: 400 });
    }

    const result = await executeApprovalPipeline({
      userId: auth.id,
      input: {
        approvalId: params.id,
        status: status as 'APPROVED' | 'REJECTED',
        comment,
      },
    });

    if (result.status === 'FAILED') {
      // Check for specific error types
      const failedStep = result.stepsExecuted.find((s) => s.status === 'failed');
      if (failedStep?.error?.includes('not found')) {
        return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
      }
      if (failedStep?.error?.includes('already reviewed')) {
        return NextResponse.json({ error: 'Approval already reviewed' }, { status: 409 });
      }
      return NextResponse.json(
        { error: result.error ?? 'Approval failed', pipeline: result },
        { status: 500 }
      );
    }

    const pipelineOutput = result.output as any;
    const approval = pipelineOutput?.approval ?? pipelineOutput;

    return NextResponse.json({
      ...approval,
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
