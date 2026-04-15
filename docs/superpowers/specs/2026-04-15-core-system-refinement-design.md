# Core System Refinement — Design Spec

> **Date:** 2026-04-15
> **Status:** Approved — ready for implementation planning
> **Scope:** Pipeline reliability, provenance completeness, idempotency, backfill, export/audit, integration tests
> **Prerequisite:** Existing pipeline orchestrator, attestation service, provenance graph, lifecycle enforcement

---

## 1. Objective

Make the non-blockchain pipeline robust, testable, and complete. Every output must be traceable back to its source through a verified provenance chain with cryptographic attestation.

### Constraints

- Do not activate blockchain
- Do not start App 2
- Do not focus on UI polish
- Prioritize backend robustness, traceability, and tests
- No schema changes to clinical data models (only provenance index additions)

### Phased Implementation

| Phase | Scope | Depends on |
|-------|-------|-----------|
| Phase 1 | Pipeline reliability, import reconciliation step, lifecycle enforcement for imports | — |
| Phase 2 | Provenance completeness checker, forward traversal, origin system, backfill improvements, idempotency hardening | Phase 1 |
| Phase 3 | Integration tests, export improvements, audit summary, audit endpoint | Phase 1 + 2 |

Testing is specified throughout but the heavier test implementation lands in Phase 3.

---

## 2. Post-Import Reconciliation Step (Phase 1)

### New pipeline step: `ReconcileImportedEventsStep`

Runs after `ExecuteImportTransformStep` in the `import_execute` pipeline. Sweeps all newly created PathwayEvents for the import job and:

1. **Validates lifecycle state** — Confirms stage definition exists and status is valid. Invalid/impossible states logged and excluded from attestation.
2. **Creates attestations** — Batch-generates attestations for eligible COMPLETED events via `createAttestation()`. Idempotency keys prevent duplicates.
3. **Creates provenance nodes** — EVENT nodes with `origin: 'IMPORT_RECONCILED'` and metadata:
   ```json
   {
     "origin": "IMPORT_RECONCILED",
     "importJobId": "cl...",
     "reconciliationTimestamp": "2026-04-15T...",
     "confidence": "HIGH"
   }
   ```
4. **Deferred edge linking** — Event-level nodes are created first (without edges to the import chain). After `RecordImportProvenanceChainStep` runs, a deferred pass connects event nodes to the import chain's OUTPUT node via `EDGE_TYPES.DERIVED_FROM`.

### Eligibility criteria

| Event status | Attestation | Provenance node |
|-------------|-------------|-----------------|
| COMPLETED | Yes | Yes |
| IN_PROGRESS / PENDING | No | Yes (labeled) |
| SKIPPED / CANCELLED | No | Yes (labeled) |
| Invalid state | No | No (logged in errors) |

### Updated pipeline order

```
ExecuteImportTransformStep          (bulk create episodes + events)
ReconcileImportedEventsStep         (NEW: validate + attest + provenance nodes)
BuildImportAttestationStep          (attestation for the import job itself)
CreateAttestationStep               (persist import-level attestation)
RecordImportProvenanceChainStep     (INPUT → TRANSFORM → OUTPUT chain)
LinkReconciledEventsStep            (NEW: connect event nodes to import chain — skips with degraded warning if OUTPUT node missing)
AnchorAttestationStep               (optional blockchain)
```

**Edge case:** If `RecordImportProvenanceChainStep` fails (degraded), the OUTPUT node may not exist. `LinkReconciledEventsStep` checks for `getArtifact(ctx, 'provenance.outputNodeId')` — if undefined, skips with a warning (severity: `degraded`). Event provenance nodes still exist but lack the upstream edge to the import chain.

### Reconciliation summary

Step returns and stores in context a machine-readable `ReconciliationSummary`:

```typescript
interface ReconciliationSummary {
  totalScanned: number;
  eligible: number;
  reconciled: number;
  skipped: number;
  invalid: number;
  attestationsCreated: number;
  provenanceNodesCreated: number;
  provenanceEdgesCreated: number;
  warnings: string[];
  errors: Array<{ eventId: string; reason: string; errorClass: string }>;
}
```

**Invariant:** `invalid + reconciled + skipped === totalScanned`. No negative counts.

### Error handling

- Individual event failures: severity `degraded`. Pipeline continues, downgrades to PARTIAL.
- Zero eligible events: warning, not failure.
- Idempotent: re-running produces no duplicates (attestation idempotency keys + `ensureProvenanceNode()` upsert).

---

## 3. Provenance Origin System (Phase 1 + 2)

### First-class `ProvenanceOrigin` type

```typescript
type ProvenanceOrigin = 'NATIVE' | 'IMPORT_RECONCILED' | 'BACKFILLED' | 'LEGACY_UNCLASSIFIED';
```

Stored in `metadata.origin` on every ProvenanceNode.

| Origin | Created by |
|--------|-----------|
| `NATIVE` | Real-time service calls (pathway-service, attestation-service, pipeline steps) |
| `IMPORT_RECONCILED` | Post-import reconciliation batch step |
| `BACKFILLED` | Retrospective backfill script |
| `LEGACY_UNCLASSIFIED` | Pre-existing nodes with no origin flag (requires manual review) |

### Migration rules

- `metadata.backfilled === true` and no `origin` → `BACKFILLED`
- `origin` already exists → preserved
- No `backfilled` flag and no `origin` → `LEGACY_UNCLASSIFIED` (not silently assumed NATIVE)
- Only nodes from known native codepaths are tagged `NATIVE`

---

## 4. Provenance Completeness & Lineage (Phase 2)

### 4a. Rule-driven completeness checker

**New function:** `verifyProvenanceCompleteness(projectId, entityType, entityId)`

Completeness rules defined in a central `COMPLETENESS_RULES` map:

```typescript
interface CompletenessRule {
  requiredNodeTypes: ProvenanceNodeKind[];
  conditionalRequirements: Array<{
    condition: string;    // e.g., 'status === COMPLETED'
    requires: ProvenanceNodeKind;
  }>;
  requiresUpstreamConnection: boolean;
}

const COMPLETENESS_RULES: Record<string, CompletenessRule> = {
  pathway_event: {
    requiredNodeTypes: ['EVENT'],
    conditionalRequirements: [{ condition: 'status === COMPLETED', requires: 'ATTESTATION' }],
    requiresUpstreamConnection: false,
  },
  import_job: {
    requiredNodeTypes: ['INPUT', 'TRANSFORM', 'OUTPUT'],
    conditionalRequirements: [{ condition: 'always', requires: 'ATTESTATION' }],
    requiresUpstreamConnection: true,
  },
  checkpoint: {
    requiredNodeTypes: ['OUTPUT'],
    conditionalRequirements: [{ condition: 'always', requires: 'ATTESTATION' }],
    requiresUpstreamConnection: true,  // must connect to upstream events/attestations
  },
  export: {
    requiredNodeTypes: ['OUTPUT'],
    conditionalRequirements: [{ condition: 'always', requires: 'ATTESTATION' }],
    requiresUpstreamConnection: true,  // must connect to source entities
  },
  attestation: {
    requiredNodeTypes: ['ATTESTATION'],
    conditionalRequirements: [],
    requiresUpstreamConnection: true,  // must reach source event/artifact
  },
};
```

### Return type

```typescript
interface CompletenessReport {
  entityType: string;
  entityId: string;
  complete: boolean;
  healthy: boolean;
  chain: {
    hasSourceArtifact: boolean;
    hasTransformOrEvent: boolean;
    hasAttestation: boolean;
    hasRunLog: boolean;
  };
  gaps: string[];
  anomalies: string[];   // orphan nodes, conflicting attestations, cycles, invalid origin combos
  origin: ProvenanceOrigin | null;
  depth: number;
}
```

`complete` = required chain elements exist per rules. `healthy` = no structural anomalies detected.

### 4b. Forward traversal

**New function:** `getEntityDescendants(projectId, entityType, entityId, opts?)`

Options: `maxDepth` (default 10), `filterNodeType?`, `filterOrigin?`. Cycle protection via visited set. Stable ordering by `timestamp` ascending.

### 4c. Origin-filtered queries

- `getProvenanceGraphByOrigin(projectId, origin)` — nodes matching specified origin
- `getProvenanceStats(projectId)` — full-project counts:

```typescript
interface ProvenanceStats {
  byOrigin: Record<ProvenanceOrigin | 'LEGACY_UNCLASSIFIED', number>;
  byNodeType: Record<string, number>;
  totalNodes: number;
  totalEdges: number;
  orphanNodes: number;
  orphanEdges: number;
  nodesMissingRunLog: number;
  unattestedCompletedEvents: number;
  importReconciledWithoutChain: number;
}
```

---

## 5. Idempotency & Deduplication (Phase 2)

### 5a. Hash determinism guarantee

**Identity rule:** Given identical `(projectId, eventType, subjectType, subjectId, canonicalData)`, `createAttestationData()` produces identical `payloadHash` and `idempotencyKey` regardless of invocation time, key order, or undefined values. No code changes — test coverage only.

**Attestation identity boundary:** `idempotencyKey = SHA-256("${projectId}:${eventType}:${payloadHash}")`. Note: `subjectType` and `subjectId` are NOT separate key components — they are embedded inside `canonicalData` which flows into `payloadHash`. Two attestations with different `subjectId` but identical full canonical payload would be deduped (this cannot happen in practice since `subjectId` is part of the payload). A new attestation is legitimate when `canonicalData` changes (different `payloadHash`). Same data = same key = guaranteed dedup.

### 5b. Import-level deduplication

`IngestCSVStep` checks for existing `InputArtifact` with same `sha256Hash + projectId` before creating. Detects byte-identical duplicates only (semantic dedup explicitly out of scope — same data with different formatting may not hash the same).

Duplicate response:
```typescript
{
  isDuplicate: true,
  duplicateArtifactId: string,
  duplicateImportJobId: string,
  duplicateHandling: 'REUSED_EXISTING'
}
```

### 5c. Concurrency-safe provenance upsert

**New function:** `ensureProvenanceNode(input)` in `lib/provenance.ts`

Backed by a new `@@unique([projectId, entityType, entityId])` constraint on `provenance_nodes` (Prisma migration required). Uses `prisma.provenanceNode.upsert()` with this composite key.

Replaces the `nodeExists()` + `createProvenanceNode()` two-step pattern in: reconciliation step, backfill script, and future provenance-creating code.

---

## 6. Backfill Improvements (Phase 2)

### 6a. Migrate to `ProvenanceOrigin`

All backfill functions updated to use `metadata.origin: 'BACKFILLED'` instead of `metadata.backfilled: true`. One-time migration function at script start upgrades existing nodes per the conservative migration rules (Section 3).

### 6b. Use `ensureProvenanceNode()`

Replace `nodeExists()` + `create()` two-step pattern with the upsert helper.

### 6c. Post-backfill completeness report

After backfill, run `verifyProvenanceCompleteness()` on a sample (first N by `createdAt`, default N=10, configurable via `--sample-size`). Report includes `sampleSize` and `totalPopulation` per entity type.

### 6d. Verification modes

- `--verify` — summary mode, exit 0 always
- `--verify-strict` — non-zero exit if critical anomalies > 0 or completeness < threshold (default 90%)

### 6e. Machine-readable verification artifact

Written to `scripts/output/backfill-report-{timestamp}.json`:
```json
{
  "projectId": "...",
  "timestamp": "...",
  "schemaVersion": "1.0.0",
  "originDistribution": { "NATIVE": 45, "IMPORT_RECONCILED": 12, "BACKFILLED": 28, "LEGACY_UNCLASSIFIED": 0 },
  "completenessSummaries": { ... },
  "anomalyCounts": { ... },
  "integrityMetrics": { ... },
  "samplingMethod": "first_n_by_created_at",
  "sampleSize": 10
}
```

---

## 7. Export & Audit Summary (Phase 3)

### 7a. Export with provenance references

`executeExportPipeline()` gains `includeProvenance: 'none' | 'minimal' | 'full'` (default `'none'`).

**Detail levels:**
- `none` — no `_provenance` field, no `_provenanceSummary`
- `minimal` — `origin`, `provenanceNodeId`, `attestationStatus`
- `full` — adds `attestationId`, `attestationHash`, completeness flags, `runLogId`

**Provenance status per entity:**
```typescript
provenanceStatus: 'INCLUDED' | 'EXCLUDED' | 'MISSING' | 'NOT_APPLICABLE'
```
- `INCLUDED` — provenance exists and is in the output
- `EXCLUDED` — provenance exists but `includeProvenance='none'`
- `MISSING` — no provenance node found
- `NOT_APPLICABLE` — entity type doesn't require provenance (e.g., PENDING event)

**Export-level summary:**
```json
{
  "_provenanceSummary": {
    "exportHash": "...",
    "exportAttestationId": "...",
    "totalEntities": 42,
    "provenanceEligibleEntities": 38,
    "entitiesWithProvenance": 35,
    "entitiesWithAttestation": 33,
    "originDistribution": { "NATIVE": 30, "IMPORT_RECONCILED": 5, "BACKFILLED": 3 },
    "completenessRate": 0.921
  }
}
```

`completenessRate` denominator is `provenanceEligibleEntities` (COMPLETED events + checkpoints + exports + import jobs). Explicitly defined.

### 7b. Project audit summary

**New file:** `lib/audit.ts`
**New function:** `generateProjectAuditSummary(projectId, opts?)`

```typescript
interface ProjectAuditSummary {
  projectId: string;
  generatedAt: string;

  // Full-population counts
  episodes: { total: number; bySite: Record<string, number> };
  events: { total: number; byStage: Record<string, number>; byStatus: Record<string, number>; completedCount: number };
  attestations: { total: number; byStatus: Record<string, number>; byEventType: Record<string, number>; anchored: number; verified: number };
  checkpoints: { total: number; latestVersion: number };
  imports: { total: number; byStatus: Record<string, number>; totalRowsProcessed: number };
  provenance: ProvenanceStats;  // full-population
  originDistribution: Record<ProvenanceOrigin | 'LEGACY_UNCLASSIFIED', number>;

  // Sample-based integrity
  completenessSample: {
    sampleSize: number;
    totalPopulation: number;
    samplingMethod: 'first_n_by_created_at';
    sampleEntityTypes: string[];
    completeCount: number;
    healthyCount: number;
    completenessRate: number;
    healthRate: number;
    anomalies: string[];
  };

  // Funding (null if blockchain disabled)
  funding: { programs: number; claims: number; totalPaidOut: string; byStatus: Record<string, number> } | null;
}
```

### 7c. Audit API endpoint

**New route:** `GET /api/projects/[id]/audit`

- Requires `ADMIN` or `AUDITOR` role
- Read-only, no write operations
- Optional query filters: `siteId`, `origin`, `stageType`, `sampleSize` (default 20)
- Cache headers: `Cache-Control: no-store`

---

## 8. Integration Tests (Phase 3)

All tests in `scripts/integration-test.ts`. Two categories:

### `[INVARIANCE]` tests (pure function, no workflow setup)

| Test | Description |
|------|------------|
| 20 | Hash determinism: identical input → identical `payloadHash` and `idempotencyKey` across invocations, key order, undefined stripping |
| 21 | Provenance stats integrity: counts consistent, `unattestedCompletedEvents === 0`, `orphanNodes === 0`, `importReconciledWithoutChain === 0` |
| 30 | `ensureProvenanceNode()` upsert-on-duplicate: call twice with identical input, assert no error thrown, same node ID returned, only one row in DB |

### `[INTEGRATION]` tests (full pipeline workflows)

| Test | Description |
|------|------------|
| 12 | Import → reconciliation → provenance → attestation. 3-row CSV, 2 COMPLETED eligible. Assert reconciliation summary counts, origin `IMPORT_RECONCILED`, pipeline SUCCESS. Assert edge exists from import chain OUTPUT node to each reconciled event node (edgeType `derived_from`). |
| 13 | Reconciliation idempotency. Re-run same import. Assert 0 new attestations, 0 new nodes, `reconciled === 0`. |
| 14 | Duplicate file import. Upload same CSV again. Assert `isDuplicate: true`, `duplicateHandling: 'REUSED_EXISTING'`, no new records. |
| 15 | Lifecycle validation during reconciliation. Invalid stage definition. Assert: flagged in `errors` with error class, pipeline continues (degraded), `invalid + reconciled + skipped === totalScanned`. |
| 16 | Invalid lifecycle transitions rejected. COMPLETED → IN_PROGRESS. Assert `PathwayEventLifecycleError` thrown, DB unchanged. |
| 17 | Provenance completeness checker. COMPLETED event: `complete: true`, `hasAttestation: true`. PENDING event: `complete: true` (attestation not required). |
| 18 | Forward traversal from INPUT node. Assert reaches TRANSFORM, OUTPUT, EVENT, ATTESTATION. No cycles. |
| 19 | Origin-filtered queries. `IMPORT_RECONCILED` filter returns only reconciled nodes. |
| 22 | Export with `includeProvenance: 'full'`. Assert `_provenance` with `provenanceStatus: 'INCLUDED'`, `_provenanceSummary` correct. |
| 23 | Export with `includeProvenance: 'minimal'`. Assert minimal fields only. |
| 24 | Export with `includeProvenance: 'none'`. Assert no `_provenance`, no `_provenanceSummary`. |
| 25 | Project audit summary. Assert non-negative counts, correct sampling method, origin distribution sums to total. |
| 26 | Backfilled vs native distinction. Assert origin totals sum to total, JSON verification artifact written with required fields. |
| 27 | Blockchain-disabled full pipeline. Import → reconciliation → checkpoint → export. All anchor steps skipped, attestations SIGNED not ANCHORED, pipeline SUCCESS. |
| 28 | Partial reconciliation failure. Corrupt one event's stage ID. Assert 2 reconciled, 1 invalid, pipeline PARTIAL, error array populated. |
| 29 | Scoped audit filters. `?origin=IMPORT_RECONCILED` returns filtered stats. `?stageType=IMAGING` filters events. `?sampleSize=5` limits sample. |

---

## 9. Schema Migration

One Prisma migration required:

```prisma
// Add unique constraint for ensureProvenanceNode() upsert safety
@@unique([projectId, entityType, entityId])  // on provenance_nodes table
```

This is an additive index. No destructive changes. Existing data must be checked for duplicates before migration (the backfill script's `nodeExists()` checks should have prevented duplicates, but verify).

---

## 10. File Inventory

### New Files

| File | Purpose | Phase |
|------|---------|-------|
| `lib/pipeline/steps/reconcile-imported-events.ts` | ReconcileImportedEventsStep | 1 |
| `lib/pipeline/steps/link-reconciled-events.ts` | LinkReconciledEventsStep (deferred edge linking) | 1 |
| `lib/audit.ts` | `generateProjectAuditSummary()` | 3 |
| `app/api/projects/[id]/audit/route.ts` | Audit API endpoint | 3 |

### Modified Files

| File | Change | Phase |
|------|--------|-------|
| `lib/provenance.ts` | Add `ensureProvenanceNode()`, `verifyProvenanceCompleteness()`, `getEntityDescendants()`, `getProvenanceGraphByOrigin()`, `getProvenanceStats()`, completeness rules | 1–2 |
| `lib/types.ts` | Add `ProvenanceOrigin` type | 1 |
| `lib/pipeline/pipelines.ts` | Insert ReconcileImportedEventsStep + LinkReconciledEventsStep in import_execute pipeline | 1 |
| `lib/pipeline/steps.ts` | Add import dedup check in IngestCSVStep (Phase 1), export provenance support in BuildExportStep (Phase 3) | 1, 3 |
| `lib/pipeline/index.ts` | Export new steps and types | 1 |
| `scripts/backfill-provenance.ts` | Migrate to ProvenanceOrigin, use ensureProvenanceNode(), add verification modes + JSON artifact | 2 |
| `scripts/integration-test.ts` | Add tests 12–29 | 3 |
| `prisma/schema.prisma` | Add `@@unique([projectId, entityType, entityId])` on ProvenanceNode | 1 |

### Unmodified Files (explicitly)

- `lib/attestation.ts` — no changes (deterministic engine is correct)
- `lib/attestation-service.ts` — no changes (uses injected services correctly)
- `lib/lifecycle.ts` — no changes (enforcement logic is correct)
- `lib/pathway-service.ts` — no changes (transition logic is correct)
- `lib/pipeline/executor.ts` — no changes (retry/severity/rollback/traceability audit all correct)
- `lib/pipeline/types.ts` — no changes
- `lib/pipeline/context.ts` — no changes
- `lib/funding/` — no changes (blockchain not activated)

---

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| Unique constraint migration fails on duplicate provenance nodes | Pre-migration check: query for duplicates, merge/delete before applying |
| Reconciliation step slows import for large CSVs | Batch attestation creation (collect eligible events, process in chunks of 50). Monitor timing in ReconciliationSummary. |
| `LEGACY_UNCLASSIFIED` nodes pollute audit results | Verification report flags them. Manual review process documented. Backfill script can reclassify after review. |
| Forward traversal on large graphs is expensive | maxDepth default 10, cycle protection, optional node type filter to prune early |
| Export with full provenance becomes very large | `includeProvenance: 'none'` is default. Minimal mode available. |

---

## 12. Completion Criteria

### Phase 1 complete when:
- Import pipeline includes ReconcileImportedEventsStep + LinkReconciledEventsStep
- COMPLETED imported events have attestations and IMPORT_RECONCILED provenance nodes
- Invalid imported states are flagged and excluded
- ReconciliationSummary is machine-readable and internally consistent
- Unique constraint migration applied successfully
- `ensureProvenanceNode()` is concurrency-safe

### Phase 2 complete when:
- `verifyProvenanceCompleteness()` returns correct results for all entity types
- Forward traversal works with cycle protection and filters
- `getProvenanceStats()` includes all integrity metrics
- Backfill script uses ProvenanceOrigin, ensureProvenanceNode(), produces JSON verification artifact
- Import dedup returns structured duplicate result
- `INVARIANCE` tests 20–21 pass

### Phase 3 complete when:
- All 30 integration tests pass (11 existing + 19 new, including tests 28–30)
- Export supports none/minimal/full provenance with correct provenanceStatus
- Audit summary is correct for full-population and sampled metrics
- Audit endpoint supports scope filters
- Blockchain-disabled mode passes full pipeline test
