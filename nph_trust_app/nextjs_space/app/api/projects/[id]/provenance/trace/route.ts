export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/rbac';

/**
 * GET /api/projects/[id]/provenance/trace
 *
 * Traceability report: validates that every output (checkpoint, export, attestation)
 * has a provenance node and is traceable back to input artifacts.
 * Returns coverage metrics and any orphan outputs.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const [attestations, checkpoints, provenanceNodes, provenanceEdges] = await Promise.all([
      prisma.attestation.findMany({
        where: { projectId: params.id },
        select: { id: true, eventType: true, subjectType: true, subjectId: true, provenanceNodeId: true, status: true },
      }),
      prisma.checkpoint.findMany({
        where: { projectId: params.id },
        select: { id: true, version: true, sha256Hash: true },
      }),
      prisma.provenanceNode.findMany({
        where: { projectId: params.id },
        select: { id: true, nodeType: true, entityType: true, entityId: true, attestationId: true },
      }),
      prisma.provenanceEdge.findMany({
        where: { source: { projectId: params.id } },
        select: { id: true, sourceId: true, targetId: true, edgeType: true },
      }),
    ]);

    // Build lookup maps
    const nodesByEntity = new Map<string, any>();
    provenanceNodes.forEach((n: any) => {
      const key = `${n.entityType}:${n.entityId}`;
      if (!nodesByEntity.has(key)) nodesByEntity.set(key, []);
      nodesByEntity.get(key)!.push(n);
    });

    // Check attestation → provenance binding
    const attestationCoverage = attestations.map((att: any) => {
      const hasProvNode = !!att.provenanceNodeId;
      const graphNodes = nodesByEntity.get(`attestation:${att.id}`) ?? [];
      return {
        attestationId: att.id,
        eventType: att.eventType,
        subjectType: att.subjectType,
        status: att.status,
        hasProvenanceNodeId: hasProvNode,
        graphNodeCount: graphNodes.length,
        traceable: hasProvNode || graphNodes.length > 0,
      };
    });

    // Check checkpoint → provenance
    const checkpointCoverage = checkpoints.map((cp: any) => {
      const graphNodes = nodesByEntity.get(`checkpoint:${cp.id}`) ?? [];
      return {
        checkpointId: cp.id,
        version: cp.version,
        graphNodeCount: graphNodes.length,
        traceable: graphNodes.length > 0,
      };
    });

    // Compute node connectivity (how many nodes have at least one edge)
    const nodesWithEdges = new Set<string>();
    provenanceEdges.forEach((e: any) => {
      nodesWithEdges.add(e.sourceId);
      nodesWithEdges.add(e.targetId);
    });
    const connectedNodes = provenanceNodes.filter((n: any) => nodesWithEdges.has(n.id)).length;
    const isolatedNodes = provenanceNodes.filter((n: any) => !nodesWithEdges.has(n.id)).length;

    const totalAttestations = attestations.length;
    const traceableAttestations = attestationCoverage.filter((a: any) => a.traceable).length;
    const totalCheckpoints = checkpoints.length;
    const traceableCheckpoints = checkpointCoverage.filter((c: any) => c.traceable).length;

    return NextResponse.json({
      projectId: params.id,
      summary: {
        totalProvenanceNodes: provenanceNodes.length,
        totalProvenanceEdges: provenanceEdges.length,
        connectedNodes,
        isolatedNodes,
        attestationCoverageRate: totalAttestations > 0 ? (traceableAttestations / totalAttestations * 100).toFixed(1) + '%' : 'N/A',
        checkpointCoverageRate: totalCheckpoints > 0 ? (traceableCheckpoints / totalCheckpoints * 100).toFixed(1) + '%' : 'N/A',
        totalAttestations,
        traceableAttestations,
        orphanAttestations: totalAttestations - traceableAttestations,
        totalCheckpoints,
        traceableCheckpoints,
        orphanCheckpoints: totalCheckpoints - traceableCheckpoints,
      },
      attestationCoverage,
      checkpointCoverage,
      nodeTypeDistribution: provenanceNodes.reduce((acc: Record<string, number>, n: any) => {
        acc[n.nodeType] = (acc[n.nodeType] || 0) + 1;
        return acc;
      }, {}),
      edgeTypeDistribution: provenanceEdges.reduce((acc: Record<string, number>, e: any) => {
        acc[e.edgeType] = (acc[e.edgeType] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err: any) {
    console.error('Traceability report error:', err);
    return NextResponse.json({ error: 'Failed to generate traceability report' }, { status: 500 });
  }
}
