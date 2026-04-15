// ============================================================
// NPH-Trust Integration Test
// ============================================================
// End-to-end test: ingestion → event → provenance → attestation
//
// Run: npx tsx scripts/integration-test.ts
//
// This script directly invokes the pipeline layer (not HTTP)
// to validate the full execution chain without a running server.
// ============================================================

import { prisma } from '../lib/db';
import { createPipelineContext, getArtifact } from '../lib/pipeline/context';
import { executePipeline } from '../lib/pipeline/executor';
import {
  ExecuteImportTransformStep,
  CreateAttestationStep,
  RecordImportProvenanceChainStep,
  CreatePathwayEventStep,
  BuildEventAttestationInputStep,
  ConditionalAttestationStep,
  RecordEventProvenanceStep,
  CreateCheckpointStep,
  RecordCheckpointProvenanceStep,
  BuildExportStep,
  RecordExportProvenanceStep,
  AnchorAttestationStep,
  type AttestationInput,
} from '../lib/pipeline/steps';
import { createAttestation } from '../lib/attestation-service';
import { verifyAttestation } from '../lib/attestation-service';
import { getEntityLineage, getProvenanceGraph } from '../lib/provenance';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

let passed = 0;
let failed = 0;
let warnings = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function warn(label: string) {
  console.log(`  ${WARN} ${label}`);
  warnings++;
}

async function main() {
  console.log('\n\x1b[1m=== NPH-Trust Integration Test Suite ===\x1b[0m\n');

  // ── Setup: get a project and user ─────────────────────────
  const project = await prisma.project.findFirst();
  if (!project) {
    console.log(`${FAIL} No project found in database. Run seed first.`);
    process.exit(1);
  }
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log(`${FAIL} No user found in database. Run seed first.`);
    process.exit(1);
  }

  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`User: ${user.email} (${user.id})\n`);

  // Count existing state
  const beforeNodes = await prisma.provenanceNode.count({ where: { projectId: project.id } });
  const beforeAtts = await prisma.attestation.count({ where: { projectId: project.id } });
  const beforeEdges = await prisma.provenanceEdge.count({ where: { source: { projectId: project.id } } });

  // ============================================================
  // TEST 1: Pipeline Context
  // ============================================================
  console.log('\x1b[1m1. Pipeline Context\x1b[0m');
  const ctx = createPipelineContext({
    pipelineName: 'integration_test',
    projectId: project.id,
    userId: user.id,
  });
  assert(ctx.pipelineId.length === 36, 'Pipeline ID is UUID format');
  assert(ctx.artifacts instanceof Map, 'Artifacts is a Map');
  assert(ctx.provenanceNodeIds.length === 0, 'Provenance nodes start empty');
  assert(ctx.attestationIds.length === 0, 'Attestation IDs start empty');
  assert(ctx.stepTimeoutMs === 30000, 'Default timeout is 30s');
  assert(ctx.maxStepRetries === 2, 'Default max retries is 2');
  assert(ctx.skipBlockchain === false, 'Blockchain not skipped by default');

  // ============================================================
  // TEST 2: Attestation Creation + Verification
  // ============================================================
  console.log('\n\x1b[1m2. Attestation Creation + Verification\x1b[0m');
  const testAttResult = await createAttestation({
    projectId: project.id,
    eventType: 'manual_attestation',
    target: {
      subjectType: 'integration_test',
      subjectId: `test-${Date.now()}`,
    },
    canonicalData: {
      testKey: 'testValue',
      timestamp_excluded: true,
    },
    createdById: user.id,
  });
  assert(!testAttResult.isDuplicate, 'Attestation is not a duplicate');
  assert(!!testAttResult.attestation.id, 'Attestation has an ID');
  assert(testAttResult.attestation.status === 'SIGNED', 'Attestation status is SIGNED');
  assert(!!testAttResult.attestation.payloadHash, 'Attestation has payload hash');
  assert(!!testAttResult.attestation.signature, 'Attestation has signature');
  assert(!!testAttResult.attestation.provenanceNodeId, 'Attestation has provenanceNodeId back-reference');
  assert(!!testAttResult.runLogId, 'Attestation creation logged in RunLog');

  // Idempotency: creating same attestation again should return duplicate
  const dupResult = await createAttestation({
    projectId: project.id,
    eventType: 'manual_attestation',
    target: {
      subjectType: 'integration_test',
      subjectId: testAttResult.attestation.subjectId,
    },
    canonicalData: {
      testKey: 'testValue',
      timestamp_excluded: true,
    },
    createdById: user.id,
  });
  assert(dupResult.isDuplicate, 'Duplicate attestation detected (idempotency)');
  assert(dupResult.attestation.id === testAttResult.attestation.id, 'Duplicate returns same attestation ID');

  // Verify attestation integrity
  const verifyResult = await verifyAttestation(testAttResult.attestation.id);
  assert(verifyResult.payloadIntegrity === true, 'Payload integrity verified');
  assert(verifyResult.signatureValid === true, 'Signature verified');
  assert(verifyResult.status === 'UNANCHORED', 'Status is UNANCHORED (no blockchain)');

  // ============================================================
  // TEST 3: Pathway Event Pipeline
  // ============================================================
  console.log('\n\x1b[1m3. Pathway Event Pipeline\x1b[0m');

  // Get an episode to attach event to
  const episode = await prisma.patientEpisode.findFirst({
    where: { projectId: project.id },
  });
  if (!episode) {
    warn('No episodes in project — skipping event pipeline test');
  } else {
    const stages = await prisma.pathwayStageDefinition.findMany();
    const firstStage = stages[0];

    const eventCtx = createPipelineContext({
      pipelineName: 'test_pathway_event',
      projectId: project.id,
      userId: user.id,
    });

    // Build attestation input dynamically after event creation
    const BuildTestEventAttestation: any = {
      name: 'build_test_event_attestation',
      description: 'Build attestation for test event',
      async execute(input: any, ctx: any) {
        const shouldAttest = getArtifact<boolean>(ctx, 'event.shouldAttest');
        if (!shouldAttest) {
          ctx.artifacts.set('attestation.skip', true);
          return input;
        }
        return {
          eventType: 'pathway_event_completed',
          target: {
            subjectType: 'pathway_event',
            subjectId: input.event.id,
            eventId: input.event.id,
          },
          canonicalData: {
            eventId: input.event.id,
            stageType: firstStage.stageType,
            status: 'COMPLETED',
            data: {},
          },
        } as AttestationInput;
      },
    };

    const eventResult = await executePipeline(
      'test_pathway_event',
      [
        CreatePathwayEventStep,
        BuildTestEventAttestation,
        ConditionalAttestationStep,
        RecordEventProvenanceStep,
      ],
      {
        episodeId: episode.id,
        stageType: firstStage.stageType,
        status: 'COMPLETED',
        data: { testField: 'integration_test' },
      },
      eventCtx
    );

    assert(eventResult.status === 'SUCCESS' || eventResult.status === 'PARTIAL', `Event pipeline status: ${eventResult.status}`);
    assert(eventResult.provenanceNodeIds.length > 0, `Event pipeline created ${eventResult.provenanceNodeIds.length} provenance node(s)`);
    assert(eventResult.attestationIds.length > 0, `Event pipeline created ${eventResult.attestationIds.length} attestation(s)`);
    assert(!!eventResult.traceability, 'Event pipeline has traceability report');
    if (eventResult.traceability) {
      assert(eventResult.traceability.hasProvenance === true, 'Event traceability: hasProvenance=true');
      assert(eventResult.traceability.hasAttestation === true, 'Event traceability: hasAttestation=true');
    }

    // Verify step outcomes
    const executedSteps = eventResult.stepsExecuted.filter((s) => s.status === 'executed');
    assert(executedSteps.length >= 3, `At least 3 steps executed (got ${executedSteps.length})`);
    assert(
      eventResult.stepsExecuted.some((s) => s.stepName === 'create_pathway_event' && s.status === 'executed'),
      'create_pathway_event step executed'
    );

    // Check step timing
    for (const step of eventResult.stepsExecuted) {
      assert(step.durationMs >= 0, `Step '${step.stepName}' has valid duration (${step.durationMs}ms)`);
    }
  }

  // ============================================================
  // TEST 4: Checkpoint Pipeline
  // ============================================================
  console.log('\n\x1b[1m4. Checkpoint Pipeline\x1b[0m');

  const cpCtx = createPipelineContext({
    pipelineName: 'test_checkpoint',
    projectId: project.id,
    userId: user.id,
  });

  const BuildCpAttestation: any = {
    name: 'build_cp_attestation',
    description: 'Build attestation for checkpoint',
    async execute(_input: any, ctx: any) {
      const checkpointId = getArtifact<string>(ctx, 'checkpoint.id');
      const version = getArtifact<number>(ctx, 'checkpoint.version');
      const hash = getArtifact<string>(ctx, 'checkpoint.hash');
      const attestationIds = getArtifact<string[]>(ctx, 'checkpoint.attestationIds');
      return {
        eventType: 'checkpoint_created',
        target: {
          subjectType: 'checkpoint',
          subjectId: checkpointId!,
          sourceArtifactIds: attestationIds ?? [],
        },
        canonicalData: {
          checkpointId, version, snapshotHash: hash,
        },
      } as AttestationInput;
    },
  };

  const cpResult = await executePipeline(
    'test_checkpoint',
    [
      CreateCheckpointStep,
      BuildCpAttestation,
      CreateAttestationStep,
      RecordCheckpointProvenanceStep,
      AnchorAttestationStep,
    ],
    { label: 'Integration Test Checkpoint', description: 'Created by integration test' },
    cpCtx
  );

  assert(cpResult.status === 'SUCCESS' || cpResult.status === 'PARTIAL', `Checkpoint pipeline status: ${cpResult.status}`);
  assert(cpResult.provenanceNodeIds.length > 0, 'Checkpoint created provenance node(s)');
  assert(cpResult.attestationIds.length > 0, 'Checkpoint created attestation');
  assert(cpResult.runLogIds.length > 0, 'Checkpoint created RunLog entry');

  // Anchor step uses severity='optional' → should be 'skipped' (not 'failed')
  const anchorStep = cpResult.stepsExecuted.find((s) => s.stepName === 'anchor_attestation');
  if (anchorStep) {
    assert(
      anchorStep.status === 'skipped',
      `Anchor step recorded as 'skipped' (optional severity, blockchain disabled) — got '${anchorStep.status}'`
    );
  }

  // Verify traceability report is present and correct
  assert(!!cpResult.traceability, 'Checkpoint pipeline has traceability report');
  if (cpResult.traceability) {
    assert(cpResult.traceability.hasProvenance === true, 'Checkpoint traceability: hasProvenance=true');
    assert(cpResult.traceability.hasAttestation === true, 'Checkpoint traceability: hasAttestation=true');
    assert(cpResult.traceability.wasDowngraded === false, 'Checkpoint traceability: not downgraded');
  }

  // ============================================================
  // TEST 5: Provenance Graph Connectivity
  // ============================================================
  console.log('\n\x1b[1m5. Provenance Graph Connectivity\x1b[0m');

  const graph = await getProvenanceGraph(project.id);
  assert(graph.nodes.length > beforeNodes, `Graph has new nodes (${beforeNodes} → ${graph.nodes.length})`);
  assert(graph.edges.length >= beforeEdges, `Graph has edges (${graph.edges.length})`);

  // Check node type distribution
  const nodeTypes = new Map<string, number>();
  graph.nodes.forEach((n: any) => nodeTypes.set(n.nodeType, (nodeTypes.get(n.nodeType) ?? 0) + 1));
  assert((nodeTypes.get('ATTESTATION') ?? 0) > 0, `Graph has ATTESTATION nodes (${nodeTypes.get('ATTESTATION')})`);
  assert((nodeTypes.get('EVENT') ?? 0) > 0, `Graph has EVENT nodes (${nodeTypes.get('EVENT')})`);

  // Check edge connectivity: at least some edges link different node types
  const crossTypeEdges = graph.edges.filter((e: any) => {
    const src = graph.nodes.find((n: any) => n.id === e.sourceId);
    const tgt = graph.nodes.find((n: any) => n.id === e.targetId);
    return src && tgt && src.nodeType !== tgt.nodeType;
  });
  assert(crossTypeEdges.length > 0, `Cross-type edges exist (${crossTypeEdges.length})`);

  // ============================================================
  // TEST 6: Entity Lineage Traversal
  // ============================================================
  console.log('\n\x1b[1m6. Entity Lineage Traversal\x1b[0m');

  // Trace lineage of the checkpoint we just created
  const cpId = getArtifact<string>(cpCtx, 'checkpoint.id');
  if (cpId) {
    const lineage = await getEntityLineage(project.id, 'checkpoint', cpId, 5);
    assert(lineage.nodes.length > 0, `Checkpoint lineage has nodes (${lineage.nodes.length})`);
    // Checkpoint OUTPUT node should exist
    const cpNodes = lineage.nodes.filter((n: any) => n.entityId === cpId);
    assert(cpNodes.length > 0, 'Checkpoint entity found in lineage');
  } else {
    warn('No checkpoint ID in context — skipping lineage test');
  }

  // ============================================================
  // TEST 7: Partial Regeneration (Export idempotency)
  // ============================================================
  console.log('\n\x1b[1m7. Partial Regeneration (Export Idempotency)\x1b[0m');

  const exportCtx1 = createPipelineContext({
    pipelineName: 'test_export_1',
    projectId: project.id,
    userId: user.id,
  });
  const BuildExportAttestation: any = {
    name: 'build_export_attestation',
    description: 'Build export attestation',
    async execute(_input: any, ctx: any) {
      const hash = getArtifact<string>(ctx, 'export.hash');
      const format = getArtifact<string>(ctx, 'export.format');
      const episodeCount = getArtifact<number>(ctx, 'export.episodeCount');
      return {
        eventType: 'data_exported',
        target: {
          subjectType: 'export',
          subjectId: `export-${ctx.projectId}-${format}-${(hash ?? '').slice(0, 16)}`,
        },
        canonicalData: { format, episodeCount, outputHash: hash },
      } as AttestationInput;
    },
  };

  const export1 = await executePipeline(
    'test_export_1',
    [BuildExportStep, BuildExportAttestation, CreateAttestationStep, RecordExportProvenanceStep],
    { format: 'json' as const },
    exportCtx1
  );
  assert(export1.status === 'SUCCESS' || export1.status === 'PARTIAL', 'First export succeeded');
  assert(export1.attestationIds.length > 0, 'First export created attestation');
  assert(!!export1.traceability, 'Export pipeline has traceability report');
  if (export1.traceability) {
    assert(export1.traceability.hasProvenance === true, 'Export traceability: hasProvenance=true');
    assert(export1.traceability.hasAttestation === true, 'Export traceability: hasAttestation=true');
  }

  // Run same export again — attestation should be idempotent (duplicate)
  const exportCtx2 = createPipelineContext({
    pipelineName: 'test_export_2',
    projectId: project.id,
    userId: user.id,
  });
  const export2 = await executePipeline(
    'test_export_2',
    [BuildExportStep, BuildExportAttestation, CreateAttestationStep, RecordExportProvenanceStep],
    { format: 'json' as const },
    exportCtx2
  );
  assert(export2.status === 'SUCCESS' || export2.status === 'PARTIAL', 'Second export succeeded');

  // The attestation should be deduplicated (same content hash)
  const isDup = getArtifact<boolean>(exportCtx2, 'attestation.isDuplicate');
  assert(isDup === true, 'Second export attestation is detected as duplicate (idempotency)');

  // ============================================================
  // TEST 8: Error Handling
  // ============================================================
  console.log('\n\x1b[1m8. Error Handling\x1b[0m');

  // Test with invalid event stage
  const errCtx = createPipelineContext({
    pipelineName: 'test_error',
    projectId: project.id,
    userId: user.id,
  });

  const errResult = await executePipeline(
    'test_error',
    [CreatePathwayEventStep],
    {
      episodeId: episode?.id ?? 'nonexistent',
      stageType: 'NONEXISTENT_STAGE_TYPE_12345',
      status: 'PENDING',
    },
    errCtx
  );
  assert(errResult.status === 'FAILED', 'Pipeline correctly fails on invalid input');
  assert(errResult.error?.includes('Invalid stage type') ?? false, 'Error message contains reason');
  assert(errResult.stepsExecuted[0]?.status === 'failed', 'First step recorded as failed');

  // ============================================================
  // TEST 9: Degraded Step Detection (missing provenance context)
  // ============================================================
  console.log('\n\x1b[1m9. Degraded Step Detection\x1b[0m');

  // Run a provenance step with deliberately missing context → should degrade
  const degradedCtx = createPipelineContext({
    pipelineName: 'test_degraded',
    projectId: project.id,
    userId: user.id,
  });

  // RecordEventProvenanceStep expects 'event.id' in context — omit it to trigger degraded
  const degradedResult = await executePipeline(
    'test_degraded',
    [RecordEventProvenanceStep],
    {},
    degradedCtx
  );
  assert(degradedResult.status === 'PARTIAL', `Degraded pipeline status is PARTIAL (got ${degradedResult.status})`);
  assert(degradedResult.traceability?.degradedSteps.length === 1, 'One degraded step recorded');
  assert(
    degradedResult.stepsExecuted.some((s) => s.stepName === 'record_event_provenance' && s.status === 'degraded'),
    'record_event_provenance marked as degraded'
  );

  // ============================================================
  // TEST 10: Traceability Audit Downgrade (SUCCESS → PARTIAL)
  // ============================================================
  console.log('\n\x1b[1m10. Traceability Audit Downgrade\x1b[0m');

  // Run a pipeline named 'import_execute' (provenance-required) but with only
  // a no-op step that creates no provenance nodes → audit should downgrade
  const NoOpStep: any = {
    name: 'noop',
    description: 'Does nothing',
    async execute(input: any) { return input; },
  };
  const auditCtx = createPipelineContext({
    pipelineName: 'test_audit_downgrade',
    projectId: project.id,
    userId: user.id,
  });
  // Use the pipeline name 'import_execute' so the audit kicks in
  const auditResult = await executePipeline(
    'import_execute',
    [NoOpStep],
    {},
    auditCtx
  );
  assert(auditResult.status === 'PARTIAL', `Audit downgrade: status is PARTIAL (got ${auditResult.status})`);
  assert(auditResult.traceability?.wasDowngraded === true, 'Traceability audit flagged wasDowngraded=true');
  assert(auditResult.traceability?.hasProvenance === false, 'Traceability audit: hasProvenance=false');

  // ============================================================
  // TEST 11: Duplicate Attestation Path — Provenance Skip OK
  // ============================================================
  console.log('\n\x1b[1m11. Duplicate Attestation — Provenance Skip\x1b[0m');

  // Re-run the same export again (3rd time) — attestation is duplicate,
  // provenance step should silently skip (isDuplicate), NOT degrade
  const exportCtx3 = createPipelineContext({
    pipelineName: 'test_export_dup',
    projectId: project.id,
    userId: user.id,
  });
  const export3 = await executePipeline(
    'test_export_dup',
    [BuildExportStep, BuildExportAttestation, CreateAttestationStep, RecordExportProvenanceStep],
    { format: 'json' as const },
    exportCtx3
  );
  assert(export3.status === 'SUCCESS' || export3.status === 'PARTIAL', `Dup export status: ${export3.status}`);
  // The export provenance step should NOT be degraded — it silently skips for isDuplicate
  const exportProvStep = export3.stepsExecuted.find((s) => s.stepName === 'record_export_provenance');
  assert(
    exportProvStep?.status === 'executed',
    `Export provenance step is 'executed' (not degraded) for duplicate — got '${exportProvStep?.status}'`
  );

  // ============================================================
  // RESULTS
  // ============================================================
  console.log('\n\x1b[1m=== Results ===\x1b[0m');
  console.log(`  ${PASS} Passed: ${passed}`);
  console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  ${WARN} Warnings: ${warnings}`);

  // Cleanup
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
