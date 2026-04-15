// ============================================================
// NPH-Trust Provenance Graph Service
// ============================================================
// Manages the ProvenanceNode/ProvenanceEdge graph for STRUCTURAL
// relationships (what derived from what, what attested what).
//
// DISTINCTION from RunLog (execution history):
//   - RunLog = temporal: WHEN did something happen, in what order
//   - Provenance = structural: WHAT is connected to WHAT
//   - ProvenanceNode.runLogId links the two layers
//
// This is a PURE DATA LAYER service. It does NOT touch
// blockchain or attestation signing logic.
// ============================================================

import { prisma } from './db';
import type { ProvenanceNodeKind } from './types';

interface CreateNodeInput {
  projectId: string;
  nodeType: ProvenanceNodeKind;
  label?: string;
  entityType: string;
  entityId: string;
  attestationId?: string;
  runLogId?: string;
  metadata?: Record<string, unknown>;
}

interface CreateEdgeInput {
  sourceId: string;
  targetId: string;
  edgeType: string;
  metadata?: Record<string, unknown>;
}

// ── Standard Edge Types ────────────────────────────────────

export const EDGE_TYPES = {
  DERIVED_FROM: 'derived_from',
  ATTESTED_BY: 'attested_by',
  PRODUCED: 'produced',
  TRANSFORMED_TO: 'transformed_to',
  TRIGGERED: 'triggered',
  CONSUMED: 'consumed',
} as const;

// ── Node Operations ───────────────────────────────────────

export async function createProvenanceNode(input: CreateNodeInput) {
  return prisma.provenanceNode.create({
    data: {
      projectId: input.projectId,
      nodeType: input.nodeType as any,
      label: input.label ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      attestationId: input.attestationId ?? null,
      runLogId: input.runLogId ?? null,
      metadata: (input.metadata as any) ?? undefined,
      timestamp: new Date(),
    },
  });
}

/**
 * Upsert-safe provenance node creation.
 * Uses the @@unique([projectId, entityType, entityId]) constraint.
 * Safe under concurrent writes. Replaces the nodeExists() + create() two-step pattern.
 */
export async function ensureProvenanceNode(input: CreateNodeInput): Promise<{ node: any; created: boolean }> {
  // Check existence first, then create if missing.
  // This avoids timestamp heuristics — the created flag is deterministic.
  const existing = await prisma.provenanceNode.findUnique({
    where: {
      projectId_entityType_entityId: {
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
  });

  if (existing) {
    // Optionally update metadata on existing node
    if (input.metadata) {
      const updated = await prisma.provenanceNode.update({
        where: { id: existing.id },
        data: { metadata: input.metadata as any },
      });
      return { node: updated, created: false };
    }
    return { node: existing, created: false };
  }

  // Create new node. Use try/catch for race condition safety —
  // if a concurrent write created the node between findUnique and create,
  // the unique constraint will reject, and we fall back to a read.
  try {
    const node = await prisma.provenanceNode.create({
      data: {
        projectId: input.projectId,
        nodeType: input.nodeType as any,
        label: input.label ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        attestationId: input.attestationId ?? null,
        runLogId: input.runLogId ?? null,
        metadata: (input.metadata as any) ?? undefined,
        timestamp: new Date(),
      },
    });
    return { node, created: true };
  } catch (err: any) {
    // Unique constraint violation — node was created by a concurrent write
    if (err?.code === 'P2002') {
      const fallback = await prisma.provenanceNode.findUnique({
        where: {
          projectId_entityType_entityId: {
            projectId: input.projectId,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        },
      });
      if (fallback) return { node: fallback, created: false };
    }
    throw err;
  }
}

// ── Edge Operations ───────────────────────────────────────

export async function createProvenanceEdge(input: CreateEdgeInput) {
  return prisma.provenanceEdge.upsert({
    where: {
      sourceId_targetId_edgeType: {
        sourceId: input.sourceId,
        targetId: input.targetId,
        edgeType: input.edgeType,
      },
    },
    update: { metadata: (input.metadata as any) ?? undefined },
    create: {
      sourceId: input.sourceId,
      targetId: input.targetId,
      edgeType: input.edgeType,
      metadata: (input.metadata as any) ?? undefined,
    },
  });
}

// ── Composite Operations ──────────────────────────────────

/**
 * Record a full provenance chain:
 * input → transform → output, optionally → attestation.
 * Each node can link to a RunLog entry for execution-provenance bridging.
 */
export async function recordProvenanceChain(params: {
  projectId: string;
  inputEntity: { type: string; id: string; label?: string };
  transformLabel: string;
  outputEntity: { type: string; id: string; label?: string };
  attestationId?: string;
  runLogId?: string;
}) {
  const inputNode = await createProvenanceNode({
    projectId: params.projectId,
    nodeType: 'INPUT',
    label: params.inputEntity.label,
    entityType: params.inputEntity.type,
    entityId: params.inputEntity.id,
    runLogId: params.runLogId,
  });

  const transformNode = await createProvenanceNode({
    projectId: params.projectId,
    nodeType: 'TRANSFORM',
    label: params.transformLabel,
    entityType: 'transform',
    entityId: `transform-${inputNode.id}`,
    runLogId: params.runLogId,
  });

  const outputNode = await createProvenanceNode({
    projectId: params.projectId,
    nodeType: 'OUTPUT',
    label: params.outputEntity.label,
    entityType: params.outputEntity.type,
    entityId: params.outputEntity.id,
    runLogId: params.runLogId,
  });

  await createProvenanceEdge({
    sourceId: inputNode.id,
    targetId: transformNode.id,
    edgeType: EDGE_TYPES.DERIVED_FROM,
  });

  await createProvenanceEdge({
    sourceId: transformNode.id,
    targetId: outputNode.id,
    edgeType: EDGE_TYPES.PRODUCED,
  });

  if (params.attestationId) {
    const attNode = await createProvenanceNode({
      projectId: params.projectId,
      nodeType: 'ATTESTATION',
      label: 'Attestation',
      entityType: 'attestation',
      entityId: params.attestationId,
      attestationId: params.attestationId,
      runLogId: params.runLogId,
    });

    await createProvenanceEdge({
      sourceId: outputNode.id,
      targetId: attNode.id,
      edgeType: EDGE_TYPES.ATTESTED_BY,
    });
  }

  return { inputNode, transformNode, outputNode };
}

/**
 * Record an event node with optional attestation linkage.
 * Used when a pathway event fires and needs to be tracked in the graph.
 */
export async function recordEventNode(params: {
  projectId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  label: string;
  parentNodeIds?: string[];
  attestationId?: string;
  runLogId?: string;
}) {
  const eventNode = await createProvenanceNode({
    projectId: params.projectId,
    nodeType: 'EVENT',
    label: params.label,
    entityType: params.entityType,
    entityId: params.entityId,
    runLogId: params.runLogId,
  });

  // Link to parent nodes
  if (params.parentNodeIds) {
    for (const parentId of params.parentNodeIds) {
      await createProvenanceEdge({
        sourceId: parentId,
        targetId: eventNode.id,
        edgeType: EDGE_TYPES.TRIGGERED,
      });
    }
  }

  // Link to attestation
  if (params.attestationId) {
    const attNode = await createProvenanceNode({
      projectId: params.projectId,
      nodeType: 'ATTESTATION',
      label: 'Event attestation',
      entityType: 'attestation',
      entityId: params.attestationId,
      attestationId: params.attestationId,
      runLogId: params.runLogId,
    });

    await createProvenanceEdge({
      sourceId: eventNode.id,
      targetId: attNode.id,
      edgeType: EDGE_TYPES.ATTESTED_BY,
    });
  }

  return eventNode;
}

// ── Query Operations ──────────────────────────────────────

export async function getProvenanceGraph(projectId: string) {
  const [nodes, edges] = await Promise.all([
    prisma.provenanceNode.findMany({
      where: { projectId },
      include: {
        attestation: { select: { id: true, payloadHash: true, status: true, eventType: true } },
        runLog: { select: { id: true, action: true, status: true, createdAt: true } },
      },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.provenanceEdge.findMany({
      where: { source: { projectId } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return { nodes, edges };
}

/**
 * Full lineage traversal: walk backwards from an entity to find all ancestors.
 * Supports audit inspection and downstream manuscript linkage.
 */
export async function getEntityLineage(
  projectId: string,
  entityType: string,
  entityId: string,
  maxDepth: number = 10
) {
  const entityNodes = await prisma.provenanceNode.findMany({
    where: { projectId, entityType, entityId },
    include: { attestation: { select: { id: true, payloadHash: true, status: true } } },
  });

  if (entityNodes.length === 0) return { nodes: [], edges: [], ancestors: [] };

  // BFS to collect all ancestors up to maxDepth
  const visited = new Set<string>();
  const allNodes: any[] = [...entityNodes];
  const allEdges: any[] = [];
  let frontier = entityNodes.map((n: any) => n.id);

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const incomingEdges = await prisma.provenanceEdge.findMany({
      where: { targetId: { in: frontier } },
      include: {
        source: {
          include: {
            attestation: { select: { id: true, payloadHash: true, status: true } },
            runLog: { select: { id: true, action: true, status: true, createdAt: true } },
          },
        },
      },
    });

    const nextFrontier: string[] = [];
    for (const edge of incomingEdges) {
      allEdges.push(edge);
      if (!visited.has(edge.sourceId)) {
        visited.add(edge.sourceId);
        allNodes.push(edge.source);
        nextFrontier.push(edge.sourceId);
      }
    }
    frontier = nextFrontier;
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    ancestors: allNodes.filter((n: any) => !entityNodes.some((en: any) => en.id === n.id)),
  };
}
