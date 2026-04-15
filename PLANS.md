# NPH-Trust — Project Plans & Agent Handoff Document

> **Last updated:** 2026-04-15
> **Author:** Claude Opus 4.6 (initial architecture + implementation)
> **Purpose:** Give any future agent (human or AI) full context to continue this project without re-reading every file.

---

## 1. What This Project Is

NPH-Trust is a **patient pathway registry** for idiopathic Normal Pressure Hydrocephalus (iNPH). It tracks de-identified patient episodes through a **7-stage clinical pathway**:

```
SYMPTOM_SCREENING → IMAGING → SPECIALIST_REVIEW → CSF_TESTING → TREATMENT_DECISION → SHUNT_INTERVENTION → FOLLOW_UP
```

Every clinical event that completes is **cryptographically attested** (SHA-256 hash + HMAC signature) and optionally **anchored on-chain** (Ethereum L2) for tamper-evidence. The system is designed so a future **"App 2"** can consume the same schema to generate manuscripts from the registry data.

### Who uses it

- **Researchers** — enter and manage patient episodes
- **Coordinators** — manage projects, sites, imports
- **Auditors** — verify attestation integrity, review provenance
- **Admins** — user management, system configuration

---

## 2. Architecture Rationale

### Why these choices were made

| Decision | Rationale |
|----------|-----------|
| **Next.js 14 App Router** | Server components reduce client JS. API routes colocated with pages. Single deployable unit. |
| **PostgreSQL + Prisma** | Relational integrity for complex pathway/attestation/provenance relationships. Prisma gives type-safe queries and migration management. |
| **Service layer pattern** | All state mutations go through `pathway-service.ts` and `attestation-service.ts`. This prevents rogue direct-DB updates that would break lifecycle enforcement. **Never bypass these services.** |
| **Lifecycle state machines** | `lifecycle.ts` defines the ONLY valid transitions. This is enforced, not advisory. Invalid transitions throw `AttestationLifecycleError` or `PathwayEventLifecycleError`. |
| **Pipeline orchestrator** | Multi-step operations (import, export, checkpoint) use composable `PipelineStep` objects. The executor handles retries, rollback, timeouts, and traceability auditing. |
| **Blockchain as optional layer** | `NullProvider` returns graceful no-ops. The system is fully functional without any blockchain. Business logic NEVER imports chain-specific code — only `getDefaultProvider()`. |
| **Canonical JSON for attestations** | Sorted keys, no whitespace. Ensures the same data always produces the same hash, regardless of property insertion order. |
| **Dual provenance tracking** | RunLog = temporal (WHEN), ProvenanceNode/Edge = structural DAG (WHAT → WHAT). Linked via `ProvenanceNode.runLogId`. |
| **Outcome-Based Funding** | Milestone payouts tied to attested pathway events. Uses pseudo-references (SHA-256 of IDs) so no PHI ever touches chain. Dual replay protection via composite key + attestation hash uniqueness. |

### Invariants — things you must NEVER break

1. **All pathway event mutations go through `transitionPathwayEvent()`** — never direct Prisma updates to event status
2. **All attestation mutations go through `attestation-service.ts`** — never direct Prisma updates to attestation status
3. **Lifecycle transitions are enforced** — `lifecycle.ts` is the single source of truth for valid state transitions
4. **COMPLETED is terminal** for pathway events — once an event reaches COMPLETED, it cannot transition to any other state
5. **No PHI on-chain** — only hashes and pseudo-references. Patient identifiers stay in PostgreSQL.
6. **Seed safety guard** — `scripts/safe-seed.ts` blocks any seed file containing `prisma.delete` or `prisma.deleteMany`. Do not bypass this.
7. **Idempotency keys** on attestations prevent duplicate creation
8. **Deterministic serialization** — attestation payloads use canonical JSON (sorted keys, no whitespace)

---

## 3. Current State of the Code

### What is BUILT and working

| Component | Status | Key files |
|-----------|--------|-----------|
| **Database schema** | Complete | `prisma/schema.prisma` — 25+ models covering patients, pathway, attestations, provenance, funding |
| **Auth + RBAC** | Complete | `lib/auth-options.ts`, `lib/rbac.ts`, `middleware.ts` — NextAuth with 4 roles |
| **Pathway service** | Complete | `lib/pathway-service.ts` — lifecycle enforcement, auto-attestation on COMPLETED |
| **Attestation service** | Complete | `lib/attestation-service.ts` — create, transition, anchor, verify with full provenance binding |
| **Lifecycle enforcement** | Complete | `lib/lifecycle.ts` — state machines for both pathway events and attestations |
| **Provenance graph** | Complete | `lib/provenance.ts` — ProvenanceNode/Edge DAG with RunLog linking |
| **Pipeline orchestrator** | Complete | `lib/pipeline/` — executor with retry, rollback, timeout, traceability audit |
| **Import pipeline** | Complete | Includes reconciliation step, deferred edge linking |
| **Blockchain layer** | Structural only | `lib/blockchain/` — provider registry, NullProvider, Base provider stub. No live chain. |
| **Funding layer** | Complete (mock mode) | `lib/funding/` — eligibility checking, payout service, milestone resolution. Uses NullFundingProvider. |
| **Solidity contract** | Written, undeployed | `contracts/NphOutcomeFundingVault.sol` — OZ AccessControl + Pausable + ReentrancyGuard |
| **UI pages** | Scaffolded | Dashboard, projects, episodes, provenance, import, approvals, settings, users |
| **API routes** | Complete | REST endpoints for all CRUD + specialized operations (verify, export, funding claims) |
| **Seed data** | Complete | `scripts/seed.ts` with safe-seed guard |

### What is NOT built yet

| Component | Priority | Notes |
|-----------|----------|-------|
| **Integration tests** | HIGH | Design spec exists (`docs/superpowers/specs/2026-04-15-core-system-refinement-design.md`), implementation pending |
| **Provenance completeness checker** | HIGH | Forward traversal to verify every output traces back to an input |
| **Export/audit endpoints** | MEDIUM | Attestation export exists; full audit summary endpoint pending |
| **Live blockchain integration** | LOW | Base provider stub exists but needs ethers.js wiring + testnet deployment |
| **App 2 (manuscript generation)** | FUTURE | Schema is App 2-ready; no code written for it |
| **Value layer (vRWE, RCR)** | FUTURE | Types defined in `lib/value-layer/types.ts`, no implementation |
| **UI polish** | LOW | Functional but not production-polished |

---

## 4. State Machine Reference

### Pathway Events

```
PENDING ──→ IN_PROGRESS ──→ COMPLETED (terminal)
  │                │
  ├──→ SKIPPED     ├──→ FAILED ──→ PENDING (retry)
  │                │              ──→ IN_PROGRESS (retry)
  └──→ CANCELLED   └──→ CANCELLED

SKIPPED ──→ PENDING (un-skip)
CANCELLED ──→ PENDING (re-open)
```

**Key:** When an event reaches `COMPLETED`, the pathway service automatically creates an attestation and records a provenance node.

### Attestations

```
DRAFT ──→ HASHED ──→ SIGNED ──→ ANCHOR_PENDING ──→ ANCHORED ──→ REVERIFIED
  │         │          │            │
  └→FAILED  └→FAILED   └→FAILED    └→FAILED

FAILED ──→ DRAFT / HASHED / SIGNED / ANCHOR_PENDING (retry paths)
REVERIFIED ──→ ANCHOR_PENDING (re-anchor)
```

**Key:** In practice, `createAttestation()` atomically goes from DRAFT → HASHED → SIGNED in one call. The separate states exist for auditability and retry granularity.

---

## 5. Planned Next Steps (Priority Order)

### Phase 1 — Backend Robustness (do this first)

1. **Integration tests** for the core loop:
   - Create project → add episode → create pathway events → transition through stages → verify attestations are auto-created → verify provenance nodes exist
   - Import CSV → verify reconciliation → verify provenance chain completeness
   - Funding eligibility check → payout submission (mock mode)

2. **Provenance completeness checker:**
   - Traverse the ProvenanceNode/Edge DAG forward from INPUT nodes
   - Verify every ATTESTATION node has a path back to at least one INPUT
   - Flag orphaned nodes (nodes with no inbound edges and no INPUT type)
   - API endpoint: `GET /api/projects/[id]/provenance/completeness`

3. **Backfill script hardening:**
   - `scripts/backfill-provenance.ts` exists but needs idempotency (skip already-created nodes)
   - Should produce a summary report: nodes created, edges created, skipped (already exists), errors

### Phase 2 — Audit & Export

4. **Audit summary endpoint:**
   - `GET /api/projects/[id]/audit/summary` — aggregate counts by action type, date range, actor
   - Should query `AuditEntry` table with filters

5. **Attestation export improvements:**
   - Currently exports attestations as JSON
   - Add: CSV export, filtered by date range / status / stage type
   - Add: Merkle tree root computation over a batch of attestation hashes (for batch anchoring)

6. **Dashboard data completeness:**
   - Funnel chart should show real pathway stage distribution
   - Stage completion rates per site
   - Attestation coverage (% of COMPLETED events that have attestations)

### Phase 3 — Blockchain Activation (when ready)

7. **Base L2 provider implementation:**
   - Wire up `lib/blockchain/providers/base-provider.stub.ts` with ethers.js
   - Connect to Base Sepolia testnet first
   - Implement `submitAnchor()` and `verifyAnchor()`
   - Environment: `BLOCKCHAIN_CHAIN_ID=base`, `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`

8. **Contract deployment:**
   - Deploy `NphOutcomeFundingVault.sol` to Base Sepolia
   - Configure program admin and verifier roles
   - Wire `FundingPayoutService` to use real provider instead of `NullFundingProvider`

9. **Batch anchoring:**
   - Collect N attestation hashes → compute Merkle root → anchor single root on-chain
   - Reduces gas costs by ~100x vs individual anchoring
   - Store Merkle proof alongside each attestation for independent verification

### Phase 4 — App 2 Preparation (future)

10. **Manuscript generation schema:**
    - The current schema is designed to be consumed by App 2
    - Key tables App 2 will read: `PatientEpisode`, `PathwayEvent`, `Attestation`, `ProvenanceNode`
    - App 2 should be read-only against the same database
    - No schema migrations needed — that was a design goal

---

## 6. How to Run in Development

```bash
# 1. Navigate to the app
cd nph_trust_app/nextjs_space

# 2. Install dependencies
npm install    # or yarn

# 3. Set up environment
cp .env.example .env
# Edit .env with:
#   DATABASE_URL="postgresql://user:pass@localhost:5432/nph_trust"
#   NEXTAUTH_SECRET="your-secret-here"
#   NEXTAUTH_URL="http://localhost:3000"
#   HMAC_SECRET_KEY="your-hmac-key"         # for attestation signing
#   BLOCKCHAIN_CHAIN_ID="base"              # optional, NullProvider used if not configured

# 4. Database setup
npx prisma generate
npx prisma migrate dev
npx prisma db seed

# 5. Run
npm run dev    # http://localhost:3000
```

### Key environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | JWT session signing |
| `NEXTAUTH_URL` | Yes | Base URL for auth callbacks |
| `HMAC_SECRET_KEY` | Yes | Signs attestation payloads (HMAC-SHA256) |
| `BLOCKCHAIN_CHAIN_ID` | No | Which chain to use (`base`, `ethereum`). Default: `base`. NullProvider used if not configured. |
| `BLOCKCHAIN_RPC_URL` | No | RPC endpoint for blockchain provider |
| `BLOCKCHAIN_PRIVATE_KEY` | No | Signing key for blockchain transactions |

---

## 7. How to Deploy to Production

### Prerequisites

- PostgreSQL 15+ (managed: Supabase, Neon, RDS, etc.)
- Node.js 18+
- Reverse proxy (nginx, Caddy, or managed platform like Vercel/Railway)

### Deployment steps

```bash
# 1. Build
cd nph_trust_app/nextjs_space
npm run build

# 2. Run migrations against production DB
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# 3. Seed initial data (pathway stage definitions, admin user)
DATABASE_URL="postgresql://..." npx prisma db seed

# 4. Start
npm run start    # or use PM2, Docker, etc.
```

### Production checklist

- [ ] PostgreSQL with SSL and connection pooling (PgBouncer or built-in)
- [ ] `NEXTAUTH_SECRET` set to a cryptographically random 32+ byte string
- [ ] `HMAC_SECRET_KEY` set to a separate cryptographically random key
- [ ] `NEXTAUTH_URL` set to your production domain
- [ ] HTTPS enforced (TLS termination at reverse proxy)
- [ ] Database backups configured (point-in-time recovery recommended)
- [ ] Rate limiting on API routes (especially `/api/auth/login`)
- [ ] `prisma generate` output path updated from hardcoded `/home/ubuntu/...` to relative path in `schema.prisma` (see note below)

### Known issue: Prisma output path

The `schema.prisma` file has a hardcoded output path:
```prisma
output = "/home/ubuntu/nph_trust_app/nextjs_space/node_modules/.prisma/client"
```
**For local/production deployment, remove or comment out this line** so Prisma uses the default output location (`node_modules/.prisma/client` relative to the project).

### Docker deployment (recommended for production)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY nph_trust_app/nextjs_space/ .
RUN npm ci --production
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Vercel deployment

Works out of the box with one caveat:
- Set `PRISMA_GENERATE_DATAPROXY=true` if using Prisma Data Proxy
- Add all env vars in Vercel dashboard
- Remove the hardcoded `output` path from `schema.prisma`

---

## 8. Code Map for Quick Orientation

```
nph_trust_app/nextjs_space/
│
├── lib/                          ← THE CORE — start here
│   ├── pathway-service.ts        ← All pathway event mutations
│   ├── attestation-service.ts    ← All attestation mutations (create, transition, anchor, verify)
│   ├── attestation.ts            ← Low-level: canonical serialization, hashing, signing
│   ├── lifecycle.ts              ← State machine definitions (enforced transitions)
│   ├── provenance.ts             ← ProvenanceNode/Edge creation helpers
│   ├── rbac.ts                   ← Auth guards (requireAuth, checkRole)
│   ├── db.ts                     ← Prisma client singleton
│   ├── types.ts                  ← Shared TypeScript types
│   ├── constants.ts              ← Pathway stage definitions
│   │
│   ├── pipeline/                 ← Multi-step operation orchestrator
│   │   ├── executor.ts           ← Core executor (retry, rollback, traceability audit)
│   │   ├── steps.ts              ← Individual step implementations
│   │   ├── pipelines.ts          ← Pre-composed pipeline definitions
│   │   ├── types.ts              ← PipelineStep, PipelineContext, PipelineResult
│   │   └── steps/                ← Specialized steps (reconcile, link)
│   │
│   ├── blockchain/               ← Chain-agnostic abstraction
│   │   ├── provider-registry.ts  ← Provider selection (getDefaultProvider)
│   │   ├── types.ts              ← BlockchainProvider interface, ChainConfig
│   │   └── providers/
│   │       ├── null-provider.ts  ← Graceful no-op (used when chain not configured)
│   │       └── base-provider.stub.ts  ← Base L2 stub (needs ethers.js wiring)
│   │
│   ├── funding/                  ← Outcome-based funding
│   │   ├── payout-service.ts     ← Eligibility check + payout submission
│   │   ├── null-funding-provider.ts  ← Mock provider
│   │   ├── types.ts              ← Milestone types, mappings, interfaces
│   │   └── index.ts              ← Public exports
│   │
│   └── value-layer/              ← FUTURE: vRWE + reputation (types only)
│       ├── types.ts
│       └── index.ts
│
├── app/                          ← Next.js App Router
│   ├── (app)/                    ← Authenticated pages (wrapped in AppShell)
│   ├── api/                      ← REST API routes
│   └── login/                    ← Public login page
│
├── components/                   ← React components
│   ├── ui/                       ← shadcn/ui primitives
│   └── layouts/                  ← AppShell, PageHeader, etc.
│
├── prisma/schema.prisma          ← Database schema (source of truth)
├── scripts/                      ← Seed, backfill, integration tests
├── contracts/                    ← Solidity (NphOutcomeFundingVault.sol)
└── docs/                         ← Architecture documents
```

---

## 9. API Route Reference

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| POST | `/api/auth/login` | Public | Email/password login |
| POST | `/api/signup` | Public | User registration |
| GET/POST | `/api/projects` | Auth | List / create projects |
| GET/PUT | `/api/projects/[id]` | Auth | Get / update project |
| GET/POST | `/api/projects/[id]/episodes` | Auth | List / create episodes |
| GET/PUT | `/api/projects/[id]/episodes/[episodeId]` | Auth | Get / update episode |
| GET/POST | `/api/projects/[id]/episodes/[episodeId]/events` | Auth | List / create pathway events |
| PUT | `/api/events/[eventId]` | Auth | Transition pathway event status |
| GET/POST | `/api/projects/[id]/attestations` | Auth | List / create attestations |
| GET | `/api/projects/[id]/attestations/export` | Auth | Export attestations |
| POST | `/api/attestations/[id]/verify` | Auth | Verify attestation integrity |
| GET | `/api/projects/[id]/provenance` | Auth | Provenance graph |
| GET | `/api/projects/[id]/provenance/lineage` | Auth | Lineage entries |
| GET | `/api/projects/[id]/provenance/trace` | Auth | Trace provenance path |
| GET/POST | `/api/projects/[id]/checkpoints` | Auth | Checkpoint management |
| POST | `/api/projects/[id]/import` | Auth | Start import job |
| POST | `/api/import/[jobId]/execute` | Auth | Execute import |
| GET/POST | `/api/approvals` | Auth | Approval workflow |
| PUT | `/api/approvals/[id]` | Auth | Approve/reject |
| GET/POST | `/api/funding/programs` | Admin | Funding programs |
| GET/POST | `/api/funding/claims` | Auth | Funding claims |
| POST | `/api/funding/claims/check-eligibility` | Auth | Check milestone eligibility |
| POST | `/api/funding/claims/submit` | Auth | Submit payout |
| GET | `/api/projects/[id]/dashboard` | Auth | Dashboard aggregation |
| GET | `/api/pathway/stages` | Auth | List pathway stage definitions |
| GET/POST | `/api/users` | Admin | User management |

---

## 10. Testing Strategy

### Unit tests (to be written)

- `lifecycle.ts` — all valid/invalid transitions for both state machines
- `attestation.ts` — canonical serialization determinism, hash computation, signature verification
- `payout-service.ts` — eligibility logic, milestone resolution, replay protection
- `pipeline/executor.ts` — retry behavior, rollback on failure, traceability audit

### Integration tests (to be written)

Test the full loop end-to-end against a real PostgreSQL:

1. **Happy path:** project → episode → events → COMPLETED → attestation auto-created → provenance node exists
2. **Import path:** CSV upload → import job → reconciliation → attestations + provenance chain
3. **Funding path:** eligible milestone → claim → mock payout → budget updated
4. **Error paths:** invalid transitions → throws lifecycle error. Duplicate attestation → returns existing (idempotent).
5. **Verification:** create attestation → tamper payload in DB → verify → returns `PAYLOAD_TAMPERED`

### How to run tests (once written)

```bash
cd nph_trust_app/nextjs_space
npm test                    # all tests
npm test -- --grep "lifecycle"  # specific suite
```

---

## 11. Common Tasks for the Next Agent

### "Add a new pathway stage"

1. Add enum value to `PathwayStageType` in `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add_new_stage`
3. Add stage definition to `scripts/seed.ts`
4. If it should trigger funding, add to `FundingMilestoneType` enum and `DEFAULT_EVENT_MILESTONE_MAPPINGS` in `lib/funding/types.ts`

### "Connect to a real blockchain"

1. Install ethers.js: `npm install ethers`
2. Implement the `BlockchainProvider` interface in `lib/blockchain/providers/base-provider.stub.ts`
3. Register the provider in app initialization
4. Set env vars: `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, `BLOCKCHAIN_CHAIN_ID=base`
5. Deploy the Solidity contract to Base Sepolia

### "Add a new API endpoint"

1. Create file in `app/api/your-route/route.ts`
2. Use `requireAuth(['ADMIN', 'RESEARCHER'])` from `lib/rbac.ts` for auth
3. Use service layer functions (never direct Prisma for state mutations)
4. Return `NextResponse.json(...)` with appropriate status codes

### "Import data from a new format"

1. Add the format to `ImportSourceType` enum in schema
2. Create a transform function in the pipeline steps
3. Add the step to the `import_execute` pipeline in `lib/pipeline/pipelines.ts`
4. The reconciliation step will automatically handle attestation creation for COMPLETED events

---

## 12. Gotchas & Lessons Learned

1. **Prisma output path is hardcoded** — `schema.prisma` line 4 points to `/home/ubuntu/...`. Remove this for local dev.

2. **Two toast libraries** — The codebase has both `sonner` and `react-hot-toast`. Use `sonner` (per STYLE_GUIDE.md). The Radix toast in `components/ui/toast.tsx` is the shadcn primitive but `sonner` is the preferred API.

3. **Seed guard is real** — `scripts/safe-seed.ts` literally `grep`s your seed file for delete operations and blocks execution. This is intentional to protect production databases that might be accidentally seeded.

4. **ProvenanceNode unique constraint** — `@@unique([projectId, entityType, entityId])` means you cannot create two provenance nodes for the same entity in the same project. The backfill script and reconciliation step must check before creating.

5. **Attestation auto-creation is non-blocking** — In `pathway-service.ts`, the attestation creation on COMPLETED is wrapped in try/catch. If it fails, the pathway event still transitions. This is intentional — clinical workflow is never blocked by attestation errors.

6. **Column mapping** — Prisma models use camelCase in TypeScript but snake_case in the database via `@map()`. When writing raw SQL, use snake_case column names.

7. **The `ChunkLoadErrorHandler`** in root layout catches Next.js chunk loading failures (common during deployments). Do not remove it.
