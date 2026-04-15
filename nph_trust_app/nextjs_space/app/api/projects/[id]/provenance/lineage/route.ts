export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/rbac';
import { getEntityLineage } from '@/lib/provenance';

/**
 * GET /api/projects/[id]/provenance/lineage?entityType=...&entityId=...&maxDepth=10
 *
 * Returns the full ancestor lineage for a given entity in the provenance graph.
 * Enables input→output trace inspection.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');
  const maxDepth = parseInt(url.searchParams.get('maxDepth') ?? '10', 10);

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: 'entityType and entityId query parameters are required' },
      { status: 400 }
    );
  }

  try {
    const lineage = await getEntityLineage(params.id, entityType, entityId, maxDepth);
    return NextResponse.json({
      projectId: params.id,
      entityType,
      entityId,
      maxDepth,
      nodeCount: lineage.nodes.length,
      edgeCount: lineage.edges.length,
      ancestorCount: lineage.ancestors.length,
      ...lineage,
    });
  } catch (err: any) {
    console.error('Lineage query error:', err);
    return NextResponse.json({ error: 'Failed to query lineage' }, { status: 500 });
  }
}
