# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NPH-Trust is a patient pathway registry for idiopathic Normal Pressure Hydrocephalus (iNPH). It tracks de-identified patient episodes through a 7-stage clinical pathway (screening → imaging → specialist review → CSF testing → treatment decision → shunt intervention → follow-up), with cryptographic attestation and optional blockchain anchoring for tamper-evidence. The system is designed so a future "App 2" can consume the same schema for manuscript generation.

## Project Structure

The app lives in `nph_trust_app/nextjs_space/`. The `nph_trust/` directory contains the authoritative architecture document (`ARCHITECTURE.md`/`.pdf`).

```
nph_trust_app/nextjs_space/
├── app/                    # Next.js 14 App Router
│   ├── (app)/              # Authenticated pages (wrapped in AppShell)
│   ├── api/                # REST API routes
│   ├── login/              # Public login page
│   └── page.tsx            # Landing/root page
├── lib/                    # Core business logic (services, lifecycle, types)
│   ├── pipeline/           # Step-based pipeline orchestrator
│   ├── blockchain/         # Chain-agnostic provider registry
│   ├── funding/            # Outcome-based funding layer (OBF)
│   └── value-layer/        # Value layer types (design only, no impl yet)
├── components/             # React components
│   ├── ui/                 # shadcn/ui primitives (Radix-based)
│   └── layouts/            # AppShell, AuthLayout, PageHeader, etc.
├── prisma/schema.prisma    # Database schema (PostgreSQL)
├── scripts/                # Seed, backfill, integration test scripts
└── docs/                   # Architecture docs (value-layer, funding-layer)
```

## Commands

```bash
# All commands run from nph_trust_app/nextjs_space/
cd nph_trust_app/nextjs_space

# Development
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint

# Database
npx prisma generate  # Regenerate Prisma client after schema changes
npx prisma migrate dev --name <name>  # Create and apply migration
npx prisma db seed   # Seed database (runs safe-seed.ts guard first)
npx prisma studio    # Visual DB browser

# Package manager: Yarn (see .yarnrc.yml), but npm scripts work
```

## Architecture

### Service Layer — All Mutations Go Through Services

State is **not freely mutable**. All pathway event and attestation state changes must go through their respective services, never direct Prisma updates:

- **`lib/pathway-service.ts`** — `transitionPathwayEvent()` enforces the event state machine. Auto-creates attestations when events reach COMPLETED.
- **`lib/attestation-service.ts`** — `createAttestation()`, `transitionAttestationStatus()`, `anchorAttestation()`, `verifyAttestation()`. ALL attestation mutations go here.
- **`lib/lifecycle.ts`** — Defines allowed state transitions (enforced, not descriptive). Invalid transitions throw `AttestationLifecycleError` or `PathwayEventLifecycleError`.

### State Machines

**Pathway Events:** PENDING → IN_PROGRESS → COMPLETED (terminal). Also: PENDING → SKIPPED/CANCELLED, FAILED → PENDING/IN_PROGRESS (retry).

**Attestations:** DRAFT → HASHED → SIGNED → ANCHOR_PENDING → ANCHORED → REVERIFIED. FAILED can retry to earlier states.

### Provenance Graph vs RunLog

Two complementary tracking systems:
- **RunLog** = temporal: WHEN did something happen, in what order (execution history)
- **ProvenanceNode/Edge** = structural: WHAT is connected to WHAT (DAG of derivations)
- Linked via `ProvenanceNode.runLogId`

### Pipeline Orchestrator (`lib/pipeline/`)

Composable step-based pipelines for multi-step operations (import, export, approval, checkpoint). Each pipeline is a sequence of `PipelineStep` objects executed by `executePipeline()`. Pre-composed pipelines exported from `lib/pipeline/index.ts`.

### Blockchain Layer

Chain-agnostic via `BlockchainProvider` interface in `lib/blockchain/`. `NullProvider` returns graceful no-ops when blockchain is not configured. Business logic never imports chain-specific code — only uses `getDefaultProvider()` from the provider registry. Configured via `BLOCKCHAIN_CHAIN_ID` env var (default: `base`).

### Outcome-Based Funding (`lib/funding/`)

Milestone-gated payouts tied to attested pathway events. 7 milestone types map to iNPH pathway stages. Uses `NullFundingProvider` when chain is not configured. Dual replay protection: composite key `(programId, episodeId, milestoneType)` + `attestationHash` uniqueness.

### Auth & RBAC

- NextAuth with credentials provider (email/password, bcrypt, JWT sessions)
- 4 roles: ADMIN, RESEARCHER, COORDINATOR, AUDITOR
- `lib/rbac.ts` — `requireAuth(allowedRoles?)` for API route guards
- Middleware protects `/dashboard`, `/projects`, `/episodes`, `/provenance`, `/import`, `/users`, `/approvals`, `/settings`

### Key Design Principles

1. **PostgreSQL is the source of truth** — blockchain is optional anchoring only
2. **All PHI off-chain** — only de-identified pseudoIds and hashes are stored
3. **Deterministic serialization** — canonical JSON (sorted keys, no whitespace) for all attestation payloads
4. **Idempotency** — attestations use `idempotencyKey` to prevent duplicates
5. **Graceful degradation** — system fully functional without blockchain connectivity

## Important Conventions

- **Seed safety:** `scripts/safe-seed.ts` blocks any seed file containing `prisma.delete` or `prisma.deleteMany` to protect shared/production databases. Do not bypass this.
- **Path alias:** `@/*` maps to the nextjs_space root (e.g., `import { prisma } from '@/lib/db'`)
- **Prisma column mapping:** Models use camelCase in TypeScript but snake_case in the database via `@map()`.
- **UI components:** shadcn/ui (Radix primitives) in `components/ui/`. See `STYLE_GUIDE.md` for design tokens, typography, color system, and component API reference.
- **Toasts:** Use `import { toast } from 'sonner'` — not the Radix toast.
- **`ChunkLoadErrorHandler`** in root layout is required — do not remove.
