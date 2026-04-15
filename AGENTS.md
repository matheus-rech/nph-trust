# AGENTS.md

Operating guide for all AI agents (Claude, Codex, Abacus, and others) working on the NPH-Trust repository. Every modification to this codebase must conform to the rules below.

---

## 1. System Overview

NPH-Trust is a patient pathway registry for idiopathic Normal Pressure Hydrocephalus (iNPH). It is **App 1** of a two-application architecture.

**App 1 (this repository)** tracks de-identified patient episodes through a 7-stage clinical pathway, with cryptographic attestation and a provenance graph that records the full derivation history of every data point.

| Pathway Stage | Enum |
|---|---|
| Symptom Screening | `SYMPTOM_SCREENING` |
| Imaging | `IMAGING` |
| Specialist Review | `SPECIALIST_REVIEW` |
| CSF Testing | `CSF_TESTING` |
| Treatment Decision | `TREATMENT_DECISION` |
| Shunt Intervention | `SHUNT_INTERVENTION` |
| Follow-Up | `FOLLOW_UP` |

The application lives in `nph_trust_app/nextjs_space/` (Next.js 14 App Router, Prisma, PostgreSQL). The `nph_trust/` directory contains the authoritative architecture document.

---

## 2. Core Principles

### 2.1 PostgreSQL Is the Source of Truth

All canonical state lives in PostgreSQL. Blockchain is an optional anchoring layer that may or may not be available. The system must be fully functional with blockchain disabled. No agent may introduce code that requires blockchain connectivity for core operations.

### 2.2 Provenance Is First-Class

Every mutation that creates, transforms, or attests data must produce a corresponding `ProvenanceNode` and, where applicable, `ProvenanceEdge` entries. Provenance is not an afterthought or a logging concern; it is a structural requirement of the data model. If a code path creates data without recording provenance, it is a bug.

### 2.3 Determinism and Idempotency

- Attestation payloads are serialized using **canonical JSON**: keys sorted lexicographically at all levels, `undefined` stripped, dates converted to ISO strings, no whitespace.
- Identical input must produce an identical hash. Attestation payloads contain **no timestamps** in the hashed body; timestamps live on the `Attestation` record metadata.
- Every attestation carries an `idempotencyKey` derived from `SHA-256(projectId:eventType:payloadHash)`. Duplicate creation attempts return the existing record.
- Re-running any pipeline step or service call with the same input must not produce duplicate records.

### 2.4 Strict Separation of Concerns

| Layer | Responsibility | Must NOT Touch |
|---|---|---|
| `lib/attestation.ts` | Canonical serialization, hashing, signing, idempotency key generation | Database, blockchain |
| `lib/attestation-service.ts` | Attestation CRUD, lifecycle transitions, provenance node creation | Blockchain provider internals |
| `lib/pathway-service.ts` | Pathway event lifecycle transitions, auto-attestation on COMPLETED | Direct Prisma updates to attestation status |
| `lib/provenance.ts` | ProvenanceNode/Edge CRUD, graph queries, lineage traversal | Blockchain, attestation signing |
| `lib/lifecycle.ts` | State machine definitions and enforcement | Database, business logic |
| `lib/blockchain/` | Chain-agnostic provider interface, NullProvider fallback | Business logic, attestation content |
| `lib/pipeline/` | Step-based pipeline orchestration (import, export, approval, checkpoint) | Direct Prisma updates that bypass services |

Business logic must never import chain-specific code. All blockchain access goes through `getDefaultProvider()` from the provider registry.

### 2.5 Lifecycle Enforcement

State transitions are **enforced, not descriptive**. Invalid transitions throw typed errors.

**Pathway Events:**

```
PENDING → IN_PROGRESS → COMPLETED (terminal)
PENDING → SKIPPED | CANCELLED
SKIPPED → PENDING
CANCELLED → PENDING
FAILED → PENDING | IN_PROGRESS
```

**Attestations:**

```
DRAFT → HASHED → SIGNED → ANCHOR_PENDING → ANCHORED → REVERIFIED
Any state → FAILED (on error)
FAILED → DRAFT | HASHED | SIGNED | ANCHOR_PENDING (retry)
REVERIFIED → ANCHOR_PENDING (re-anchor)
```

All pathway event mutations go through `transitionPathwayEvent()`. All attestation mutations go through `transitionAttestationStatus()`. Direct Prisma updates to `status` fields on these models are forbidden.

---

## 3. Architecture Summary

### Pipeline Flow

Every data operation follows this flow:

```
Input → Canonical Transform → Event → Provenance → Attestation → Output
```

Concretely:

1. **Input**: Raw data arrives (CSV upload, API call, manual entry).
2. **Canonical Transform**: Data is normalized and validated.
3. **Event**: A `PathwayEvent` is created or transitioned via `pathway-service.ts`.
4. **Provenance**: A `ProvenanceNode` is created, edges link it to its inputs and any parent nodes.
5. **Attestation**: On `COMPLETED` transitions, `attestation-service.ts` creates a signed attestation with deterministic payload, hash, and idempotency key.
6. **Output**: Results are persisted; `RunLog` records the temporal execution trace.

Pre-composed pipelines are exported from `lib/pipeline/index.ts`:

| Pipeline | Purpose |
|---|---|
| `executeImportUploadPipeline` | File upload + artifact registration |
| `executeImportExecutePipeline` | Parse, transform, reconcile imported data |
| `executePathwayEventPipeline` | Pathway event transitions |
| `executeApprovalPipeline` | Approval workflow |
| `executeCheckpointPipeline` | Snapshot creation |
| `executeExportPipeline` | Data export with provenance |

### Dual Tracking Systems

| System | Role | Answers |
|---|---|---|
| **RunLog** | Temporal execution history | WHEN did something happen, in what order? |
| **ProvenanceNode/Edge** | Structural derivation graph (DAG) | WHAT is connected to WHAT? |

These are linked via `ProvenanceNode.runLogId`. Both must be populated for any tracked operation.

---

## 4. Provenance Model

### Node Types

| `ProvenanceNodeType` | When Created |
|---|---|
| `INPUT` | External data enters the system (file upload, API payload) |
| `EVENT` | A pathway event fires or transitions |
| `TRANSFORM` | A data transformation step executes |
| `OUTPUT` | A derived artifact is produced (export, checkpoint) |
| `ATTESTATION` | An attestation record is created |

### Origin Types

Every provenance node carries an `origin` field in its metadata that classifies how the node was created:

| Origin | Meaning | Created By |
|---|---|---|
| `NATIVE` | Created in real-time by service calls | `pathway-service.ts`, `attestation-service.ts`, pipeline steps |
| `IMPORT_RECONCILED` | Created during post-import batch reconciliation | `ReconcileImportedEventsStep` |
| `BACKFILLED` | Retrospectively reconstructed from historical data | Backfill scripts |
| `LEGACY_UNCLASSIFIED` | Pre-existing node with no origin flag | Requires manual review |

### Provenance Rules

1. Every `PathwayEvent` that reaches `COMPLETED` must have a corresponding provenance node.
2. Every `Attestation` must have a provenance node, back-linked via `Attestation.provenanceNodeId`.
3. Edges use the standard types defined in `lib/provenance.ts`: `derived_from`, `attested_by`, `produced`, `transformed_to`, `triggered`, `consumed`.
4. Provenance nodes are uniquely constrained by `(projectId, entityType, entityId)`. Use `ensureProvenanceNode()` for upsert-safe creation under concurrency.
5. Never create orphan nodes. Every node must have at least one edge connecting it to the graph, except for root `INPUT` nodes.

---

## 5. Attestation Rules

### Hashing

- Algorithm: `SHA-256` on canonical JSON payload.
- Signing: `HMAC-SHA-256` with institutional key (`HMAC_SECRET` env var).
- Verification uses timing-safe comparison (`crypto.timingSafeEqual`).
- The attestation payload schema:

```json
{
  "schemaVersion": "1.0.0",
  "eventType": "<AttestationEventType>",
  "subjectType": "<string>",
  "subjectId": "<string>",
  "projectId": "<string>",
  "canonicalData": { ... }
}
```

### Idempotency

- `idempotencyKey = SHA-256(projectId:eventType:payloadHash)`
- Enforced by a unique constraint on `Attestation.idempotencyKey`.
- If a creation request matches an existing key, the existing record is returned with `isDuplicate: true`. No new record is created.

### No PHI

- Attestation payloads contain only `pseudoId` references and hashed data.
- No patient names, dates of birth, addresses, or other protected health information may appear in attestation payloads, provenance metadata, or any data sent to the blockchain layer.
- `FundingClaim` uses `episodePseudoRef` and `sitePseudoRef` for on-chain references.

---

## 6. Import Rules

### Duplicate Detection

- Patient episodes are uniquely constrained by `(projectId, pseudoId)`.
- Import pipelines must check for existing episodes before creating new ones.
- `ReconcileImportedEventsStep` filters out events that already have provenance nodes before processing.

### Reconciliation Behavior

After import execution, `ReconcileImportedEventsStep` runs:

1. Scans only events created by the current import job (scoped by `createdEventIds`).
2. Validates lifecycle state of each event.
3. Creates `IMPORT_RECONCILED` provenance nodes for all eligible events.
4. Creates attestations only for events with `COMPLETED` status.
5. Links event provenance nodes to attestation provenance nodes via `attested_by` edges.
6. Records a `ReconciliationSummary` with counts and any warnings.

Individual event failures during reconciliation are non-blocking (severity: `degraded`). The pipeline continues and reports warnings.

---

## 7. Backfill Rules

### Conservative Labeling

When reconstructing provenance from historical data:

1. Mark every node with `origin: 'BACKFILLED'` in metadata.
2. Include required `BackfillMetadata` fields:
   - `backfilled: true`
   - `backfillSource` (e.g., `'seed_data'`, `'import_migration'`, `'manual_backfill'`)
   - `backfillTimestamp` (ISO string of when the backfill ran)
   - `confidence` (`'HIGH'` for direct DB records, `'MEDIUM'` for inferred, `'LOW'` for estimated)
3. Optionally include `originalTimestamp` (from the source record) and `completenessNote`.
4. Never assign `NATIVE` origin to backfilled data.
5. Never fabricate attestation hashes for historical events that were not originally attested. If the original data did not go through the attestation pipeline, the backfilled provenance node must not have an `attestationId`.

---

## 8. Testing Requirements

### Integration Tests

- All service functions (`transitionPathwayEvent`, `createAttestation`, `transitionAttestationStatus`, `anchorAttestation`, `verifyAttestation`) must have integration tests that run against a real PostgreSQL instance.
- Pipeline tests must execute full pipeline flows, not mock individual steps.
- Test scripts live in `scripts/`.

### Idempotency Checks

- Every test that creates an attestation must verify that calling the same creation function with the same input returns `isDuplicate: true` and does not produce a second record.
- Every test that creates a provenance node must verify that `ensureProvenanceNode()` with the same input returns `created: false`.

### Provenance Completeness

- After any pipeline execution test, verify that every `COMPLETED` pathway event has:
  - A corresponding `ProvenanceNode` with `entityType: 'pathway_event'`.
  - A corresponding `Attestation` linked via `provenanceNodeId`.
  - At least one `ProvenanceEdge` connecting it to the graph.

### Blockchain-Disabled Mode

- All tests must pass with `isBlockchainConfigured()` returning `false`.
- Tests must verify that `anchorAttestation()` returns `{ anchored: false }` gracefully when no provider is registered.
- No test may require a live blockchain connection.

---

## 9. What NOT to Do

These are hard guardrails. Violations are treated as regressions.

| Do NOT | Reason |
|---|---|
| Update `PathwayEvent.status` or `Attestation.status` via direct Prisma calls | Bypasses lifecycle enforcement; breaks state machine invariants |
| Put timestamps inside attestation payload bodies | Breaks deterministic hashing; identical data must produce identical hashes |
| Store PHI in attestation payloads, provenance metadata, or blockchain-bound data | Regulatory and compliance violation |
| Import chain-specific code outside `lib/blockchain/` | Breaks separation of concerns; couples business logic to a specific chain |
| Skip provenance node creation when creating or transitioning events | Provenance is structural, not optional |
| Delete or bypass `scripts/safe-seed.ts` | Protects shared/production databases from destructive seed operations |
| Use `prisma.delete` or `prisma.deleteMany` in seed files | Blocked by `safe-seed.ts` guard |
| Create attestations without an `idempotencyKey` | Breaks duplicate prevention |
| Assume blockchain is available | System must function identically with blockchain disabled |
| Modify the lifecycle state machine without updating both `lifecycle.ts` and all dependent services/tests | Creates silent state machine divergence |
| Add new pipeline steps that bypass `attestation-service.ts` or `pathway-service.ts` | Services are the single entry point for their respective domains |

---

## 10. Future Work (Explicitly Gated)

The following features are designed but not active. Do not implement them unless explicitly instructed.

### Blockchain Activation

The `BlockchainProvider` interface and `NullProvider` fallback are in place. Real provider implementations exist behind the `lib/blockchain/providers/` directory. Activation requires:

- Environment configuration (`BLOCKCHAIN_CHAIN_ID`, RPC URL, contract address, private key).
- Explicit project decision to enable anchoring.
- No changes to business logic are needed; the provider registry handles the switch.

Agents must not add blockchain-specific code to any file outside `lib/blockchain/`.

### App 2 (Manuscript Engine)

App 2 will consume the same Prisma schema to generate manuscripts from attested pathway data. The provenance graph's `getEntityLineage()` function is designed to support this use case. Agents must not modify the schema or provenance model in ways that would break downstream lineage traversal.

---

## 11. Agent Instructions

When modifying this repository, agents must:

1. **Read before writing.** Understand the existing service layer, lifecycle rules, and provenance model before proposing changes. Read the relevant service file, not just the API route.

2. **Route all mutations through services.** Pathway event changes go through `pathway-service.ts`. Attestation changes go through `attestation-service.ts`. Provenance changes go through `provenance.ts`. There are no exceptions.

3. **Preserve idempotency.** Any new function that creates records must handle the case where the record already exists. Use `idempotencyKey` for attestations and `ensureProvenanceNode()` for provenance nodes.

4. **Maintain provenance completeness.** If you add a new data creation path, it must create provenance nodes and edges. If you add a new attestation event type, add it to the `AttestationEventType` union in `lib/types.ts`.

5. **Respect the type system.** Do not use `any` to bypass TypeScript checks on lifecycle states, provenance node types, or attestation status values. These types exist to enforce correctness.

6. **Do not introduce new dependencies without justification.** The system is deliberately conservative in its dependency footprint.

7. **Do not refactor beyond scope.** Fix what is asked. Do not reorganize files, rename modules, or "improve" adjacent code unless specifically instructed.

8. **Test what you change.** If you modify a service function, verify the corresponding integration test still passes. If no test exists for the path you changed, flag it.

---

## 12. Development Workflow

Every change follows this sequence:

```
Design → Implement → Review → Test → Validate → Commit
```

| Phase | Action |
|---|---|
| **Design** | Identify which services, models, and pipeline steps are affected. Verify the change respects lifecycle rules and provenance requirements. |
| **Implement** | Write the change, routing all mutations through the appropriate service layer. |
| **Review** | Verify no direct Prisma status updates, no missing provenance, no broken idempotency. |
| **Test** | Run integration tests. Verify idempotency (re-run produces no duplicates). Verify provenance completeness. Verify blockchain-disabled mode. |
| **Validate** | Confirm the change does not break existing pipeline flows or state machine transitions. |
| **Commit** | Use conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). |

---

## 13. Final Rule

**Correctness and traceability over convenience.**

Every shortcut that bypasses the service layer, skips provenance, or breaks idempotency creates a regression that is harder to find than it was to prevent. When in doubt, take the slower path that preserves the audit trail.
