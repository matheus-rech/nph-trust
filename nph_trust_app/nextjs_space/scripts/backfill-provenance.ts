// ============================================================
// NPH-Trust Provenance Backfill Script
// ============================================================
// Creates retrospective provenance nodes for existing data.
// All backfilled nodes carry metadata.backfilled = true.
//
// Usage:
//   export $(cat .env | grep -v '^#' | xargs)
//   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-provenance.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BACKFILL_TS = new Date().toISOString();
const BACKFILL_SOURCE = 'phase1_final_backfill';

function meta(originalTs?: Date | string | null, confidence: string = 'HIGH', note?: string): Record<string, any> {
  return {
    backfilled: true,
    backfillSource: BACKFILL_SOURCE,
    backfillTimestamp: BACKFILL_TS,
    originalTimestamp: originalTs ? new Date(originalTs as string).toISOString() : undefined,
    confidence,
    completenessNote: note,
  };
}

async function nodeExists(projectId: string, entityType: string, entityId: string): Promise<boolean> {
  const count = await prisma.provenanceNode.count({ where: { projectId, entityType, entityId } });
  return count > 0;
}

async function backfillArtifacts() {
  const artifacts = await prisma.inputArtifact.findMany();
  let created = 0;
  for (const a of artifacts) {
    if (await nodeExists(a.projectId, 'input_artifact', a.id)) continue;
    await prisma.provenanceNode.create({
      data: {
        projectId: a.projectId,
        nodeType: 'INPUT',
        label: a.filename,
        entityType: 'input_artifact',
        entityId: a.id,
        metadata: { ...meta(a.createdAt, 'HIGH', 'Backfilled from InputArtifact record'), sha256: a.sha256Hash, sizeBytes: a.sizeBytes } as any,
        timestamp: a.createdAt,
      },
    });
    created++;
  }
  console.log(`  Artifacts: ${created} INPUT nodes created (${artifacts.length - created} skipped)`);
}

async function backfillImportJobs() {
  const jobs = await prisma.importJob.findMany({
    where: { status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED'] } },
    include: { inputArtifact: true },
  });
  let created = 0;
  for (const job of jobs) {
    if (await nodeExists(job.projectId, 'import_job', job.id)) continue;

    const inputNode = await prisma.provenanceNode.findFirst({
      where: { projectId: job.projectId, entityType: 'input_artifact', entityId: job.inputArtifactId },
    });

    const transformNode = await prisma.provenanceNode.create({
      data: {
        projectId: job.projectId,
        nodeType: 'TRANSFORM',
        label: `CSV Import (${job.processedRows ?? 0} rows)`,
        entityType: 'import_transform',
        entityId: `transform-${job.id}`,
        metadata: meta(job.startedAt ?? job.createdAt, 'HIGH', 'Backfilled from ImportJob record') as any,
        timestamp: job.startedAt ?? job.createdAt,
      },
    });

    const outputNode = await prisma.provenanceNode.create({
      data: {
        projectId: job.projectId,
        nodeType: 'OUTPUT',
        label: `Import Job ${job.id.slice(0, 8)}`,
        entityType: 'import_job',
        entityId: job.id,
        metadata: meta(job.completedAt ?? job.createdAt, 'HIGH', 'Backfilled from ImportJob record') as any,
        timestamp: job.completedAt ?? job.createdAt,
      },
    });

    if (inputNode) {
      await prisma.provenanceEdge.upsert({
        where: { sourceId_targetId_edgeType: { sourceId: inputNode.id, targetId: transformNode.id, edgeType: 'derived_from' } },
        update: {},
        create: { sourceId: inputNode.id, targetId: transformNode.id, edgeType: 'derived_from' },
      });
    }
    await prisma.provenanceEdge.upsert({
      where: { sourceId_targetId_edgeType: { sourceId: transformNode.id, targetId: outputNode.id, edgeType: 'produced' } },
      update: {},
      create: { sourceId: transformNode.id, targetId: outputNode.id, edgeType: 'produced' },
    });

    created++;
  }
  console.log(`  Import jobs: ${created} TRANSFORM+OUTPUT chains created (${jobs.length - created} skipped)`);
}

async function backfillPathwayEvents() {
  const events = await prisma.pathwayEvent.findMany({
    include: { stageDefinition: true, patientEpisode: { select: { projectId: true } } },
  });
  let created = 0;
  for (const evt of events) {
    const projectId = evt.patientEpisode.projectId;
    if (await nodeExists(projectId, 'pathway_event', evt.id)) continue;

    await prisma.provenanceNode.create({
      data: {
        projectId,
        nodeType: 'EVENT',
        label: `${evt.stageDefinition.stageType}: ${evt.status}`,
        entityType: 'pathway_event',
        entityId: evt.id,
        metadata: { ...meta(evt.createdAt, 'HIGH', 'Backfilled from PathwayEvent record'), stageType: evt.stageDefinition.stageType, status: evt.status } as any,
        timestamp: evt.occurredAt ?? evt.createdAt,
      },
    });
    created++;
  }
  console.log(`  Pathway events: ${created} EVENT nodes created (${events.length - created} skipped)`);
}

async function backfillAttestations() {
  const attestations = await prisma.attestation.findMany({ where: { provenanceNodeId: null } });
  let created = 0;
  for (const att of attestations) {
    if (await nodeExists(att.projectId, 'attestation', att.id)) {
      const existingNode = await prisma.provenanceNode.findFirst({
        where: { projectId: att.projectId, entityType: 'attestation', entityId: att.id },
      });
      if (existingNode) {
        await prisma.attestation.update({ where: { id: att.id }, data: { provenanceNodeId: existingNode.id } });
      }
      continue;
    }

    const provNode = await prisma.provenanceNode.create({
      data: {
        projectId: att.projectId,
        nodeType: 'ATTESTATION',
        label: `Attestation: ${att.eventType}`,
        entityType: 'attestation',
        entityId: att.id,
        attestationId: att.id,
        metadata: {
          ...meta(att.createdAt, 'HIGH', 'Backfilled \u2014 original attestation was real-time but provenance node was not recorded'),
          eventType: att.eventType,
          subjectType: att.subjectType,
          status: att.status,
          retrospectiveAttestation: false,
        } as any,
        timestamp: att.createdAt,
      },
    });

    await prisma.attestation.update({ where: { id: att.id }, data: { provenanceNodeId: provNode.id } });

    if (att.pathwayEventId) {
      const eventNode = await prisma.provenanceNode.findFirst({
        where: { projectId: att.projectId, entityType: 'pathway_event', entityId: att.pathwayEventId },
      });
      if (eventNode) {
        await prisma.provenanceEdge.upsert({
          where: { sourceId_targetId_edgeType: { sourceId: eventNode.id, targetId: provNode.id, edgeType: 'attested_by' } },
          update: {},
          create: { sourceId: eventNode.id, targetId: provNode.id, edgeType: 'attested_by' },
        });
      }
    }

    created++;
  }
  console.log(`  Attestations: ${created} ATTESTATION nodes created + back-linked (${attestations.length - created} skipped)`);
}

async function backfillCheckpoints() {
  const checkpoints = await prisma.checkpoint.findMany({ orderBy: { version: 'asc' } });
  let created = 0;
  let prevNodeId: string | null = null;
  for (const cp of checkpoints) {
    if (await nodeExists(cp.projectId, 'checkpoint', cp.id)) {
      const existing = await prisma.provenanceNode.findFirst({
        where: { projectId: cp.projectId, entityType: 'checkpoint', entityId: cp.id },
      });
      prevNodeId = existing?.id ?? null;
      continue;
    }

    const cpNode = await prisma.provenanceNode.create({
      data: {
        projectId: cp.projectId,
        nodeType: 'OUTPUT',
        label: `Checkpoint v${cp.version}`,
        entityType: 'checkpoint',
        entityId: cp.id,
        metadata: { ...meta(cp.createdAt, 'HIGH', 'Backfilled from Checkpoint record'), version: cp.version, sha256Hash: cp.sha256Hash } as any,
        timestamp: cp.createdAt,
      },
    });

    if (prevNodeId) {
      await prisma.provenanceEdge.upsert({
        where: { sourceId_targetId_edgeType: { sourceId: prevNodeId, targetId: cpNode.id, edgeType: 'derived_from' } },
        update: {},
        create: { sourceId: prevNodeId, targetId: cpNode.id, edgeType: 'derived_from' },
      });
    }

    prevNodeId = cpNode.id;
    created++;
  }
  console.log(`  Checkpoints: ${created} OUTPUT nodes created (${checkpoints.length - created} skipped)`);
}

async function main() {
  console.log('\n=== NPH-Trust Provenance Backfill ===');
  console.log(`Timestamp: ${BACKFILL_TS}`);
  console.log(`Source: ${BACKFILL_SOURCE}`);
  console.log('');

  const [nodeCount, edgeCount] = await Promise.all([
    prisma.provenanceNode.count(),
    prisma.provenanceEdge.count(),
  ]);
  console.log(`Existing provenance: ${nodeCount} nodes, ${edgeCount} edges\n`);

  console.log('Backfilling...');
  await backfillArtifacts();
  await backfillImportJobs();
  await backfillPathwayEvents();
  await backfillAttestations();
  await backfillCheckpoints();

  const [finalNodes, finalEdges] = await Promise.all([
    prisma.provenanceNode.count(),
    prisma.provenanceEdge.count(),
  ]);
  console.log(`\nFinal provenance: ${finalNodes} nodes (+${finalNodes - nodeCount}), ${finalEdges} edges (+${finalEdges - edgeCount})`);

  const backfilledCount = await prisma.provenanceNode.count({
    where: { metadata: { path: ['backfilled'], equals: true } },
  });
  console.log(`Native nodes: ${finalNodes - backfilledCount}`);
  console.log(`Backfilled nodes: ${backfilledCount}`);
  console.log('\n=== Backfill complete ===\n');
}

main()
  .catch((e) => { console.error('Backfill failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
