# NPH-Trust Outcome-Based Funding Layer — Architecture Document

> **Status:** Implementation complete (mock/disabled-chain mode).  
> **Date:** 2026-04-15  
> **Layer:** Outcome-Based Funding (OBF) — Phase 3 extension  
> **Prerequisites:** Attestation service (Phase 1), Provenance graph (Phase 2), Value-layer types

---

## 1. Design Overview

The Outcome-Based Funding layer enables milestone-gated stablecoin-style payouts for clinical research sites. Each payout is tied to a **cryptographically attested pathway milestone** — a completed clinical event (e.g., imaging done, shunt performed) that has been signed, hashed, and optionally anchored on-chain.

### Core Principle

```
Pathway Event (COMPLETED) → Attestation (SIGNED/ANCHORED) → Eligibility Check → Payout Claim → Vault Disbursement
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **No PHI on-chain** | All on-chain identifiers are SHA-256 pseudo-references (episode/site IDs hashed). Patient data never touches the contract. |
| **Blockchain remains optional** | NullFundingProvider returns mock results when chain is not configured. No clinical workflow disruption. |
| **Dual replay protection** | Both `(programId, episodeId, milestoneType)` composite key AND `attestationHash` uniqueness prevent double-pay. |
| **Attestation as eligibility gate** | A claim cannot proceed without a SIGNED or ANCHORED attestation for the triggering event. This reuses Phase 1 infrastructure. |
| **Off-chain budget mirror** | FundingProgram tracks totalDeposited/totalPaidOut off-chain for dashboard display, even when on-chain state is authoritative. |
| **7 milestone types** | Map 1:1 to iNPH pathway stages (minus TREATMENT_DECISION, which is a decision point, not an outcome). |

---

## 2. Solidity Contract — NphOutcomeFundingVault

**File:** `contracts/NphOutcomeFundingVault.sol`

### Contract Summary

- **Inherits:** AccessControl, Pausable, ReentrancyGuard (OpenZeppelin)
- **Roles:** PROGRAM_ADMIN_ROLE, VERIFIER_ROLE
- **Token:** ERC20 (USDC-style stablecoin)

### Functions

| Function | Access | Description |
|---|---|---|
| `createProgram(id, token, name)` | PROGRAM_ADMIN | Register a funding program with a treasury |
| `setProgramActive(id, active)` | PROGRAM_ADMIN | Activate/pause a program |
| `configureMilestonePayout(programId, milestoneType, amount, enabled)` | PROGRAM_ADMIN | Set payout amount per milestone |
| `depositToTreasury(programId, amount)` | Any (with token approval) | Fund the program treasury |
| `payMilestone(claimId, programId, siteId, episodeRef, milestoneType, attestationHash, recipient)` | VERIFIER | Disburse payout after verification |
| `recoverUnusedFunds(programId, to)` | PROGRAM_ADMIN | Withdraw remaining treasury |

### Replay Protection (On-Chain)

```solidity
mapping(bytes32 => bool) public claimPaid;        // keccak256(programId, siteId, episodeRef, milestoneType)
mapping(bytes32 => bool) public attestationUsed;   // attestationHash
```

### Events

- `ProgramCreated`, `ProgramStatusChanged`
- `MilestonePayoutConfigured`
- `TreasuryDeposited`
- `MilestonePaid` (indexed: programId, siteId, recipient, amount)
- `FundsRecovered`

---

## 3. TypeScript Integration Layer

**Files:** `lib/funding/types.ts`, `lib/funding/null-funding-provider.ts`, `lib/funding/index.ts`

### MilestoneType Enum

Ordinal values match Solidity exactly (0–6):

| Value | Name | Pathway Stage |
|---|---|---|
| 0 | SCREENING_COMPLETED | SYMPTOM_SCREENING |
| 1 | IMAGING_COMPLETED | IMAGING |
| 2 | SPECIALIST_REVIEW_COMPLETED | SPECIALIST_REVIEW |
| 3 | CSF_TEST_COMPLETED | CSF_TESTING |
| 4 | SHUNT_PERFORMED | SHUNT_INTERVENTION |
| 5 | FOLLOWUP_3M_COMPLETED | FOLLOW_UP |
| 6 | VALIDATED_IMPROVEMENT_RECORDED | FOLLOW_UP + outcome=IMPROVED |

### FundingVaultProvider Interface

Mirrors BlockchainProvider pattern:
- `isAvailable()` — returns false for NullFundingProvider
- `payMilestone(params)` — submit payout transaction
- `isMilestonePaid(...)` — on-chain replay check
- `isAttestationUsed(hash)` — on-chain attestation check
- `getProgram(id)` — read program state

### NullFundingProvider

Used when blockchain is not configured. Returns mock transaction references with `success: true`. Logs warnings for auditability.

---

## 4. Backend Payout Service

**File:** `lib/funding/payout-service.ts`

### FundingPayoutService Class

#### `checkEligibility(input)` → `EligibilityCheckResult`

Checks 6 conditions in order:
1. Program exists and is ACTIVE
2. Milestone config exists and is enabled
3. Patient episode exists in the project
4. A COMPLETED pathway event exists for the stage type (+ data conditions if applicable)
5. A SIGNED or ANCHORED attestation exists for the pathway event
6. No duplicate claim exists (replay protection)

#### `submitPayout(input)` → `PayoutSubmissionResult`

1. Upserts FundingClaim with PENDING_SUBMIT status
2. Creates a PayoutAttempt record
3. Calls FundingVaultProvider.payMilestone (or NullFundingProvider mock)
4. Updates claim status: CONFIRMED / MOCK_APPROVED / FAILED
5. Increments program totalPaidOut on success

#### `resolveMilestoneType(stageType, status, data)` → `MilestoneType | null`

Maps pathway events to funding milestones using configurable mappings. Supports data conditions (e.g., outcome=IMPROVED for milestone 6).

#### `buildProvenanceBinding(...)` → `FundingProvenanceBinding`

Walks the provenance graph from the attestation to collect evidence chain node IDs and on-chain anchor references.

#### `generatePseudoRef(id)` → `string`

SHA-256 hash of an identifier, returned as `0x`-prefixed hex. Used for all on-chain references to strip PHI.

---

## 5. Schema / Model Changes

**File:** `prisma/schema.prisma`

### New Enums

- `FundingProgramStatus`: DRAFT, ACTIVE, PAUSED, CLOSED
- `FundingClaimStatus`: ELIGIBLE, PENDING_SUBMIT, SUBMITTED, CONFIRMED, FAILED, REJECTED, MOCK_APPROVED, DUPLICATE
- `PayoutAttemptStatus`: PENDING, SUBMITTED, CONFIRMED, FAILED, REVERTED
- `FundingMilestoneType`: SCREENING_COMPLETED, IMAGING_COMPLETED, SPECIALIST_REVIEW_COMPLETED, CSF_TEST_COMPLETED, SHUNT_PERFORMED, FOLLOWUP_3M_COMPLETED, VALIDATED_IMPROVEMENT_RECORDED

### New Models

| Model | Purpose |
|---|---|
| `FundingProgram` | A funder's program with budget, on-chain refs, validity dates |
| `FundingMilestoneConfig` | Per-milestone payout amounts and mapping rules |
| `FundingClaim` | A claim for payout, linking episode + attestation + milestone |
| `PayoutAttempt` | Individual payout transaction attempts (supports retries) |

### Relation Graph

```
Project ──1:N──> FundingProgram ──1:N──> FundingMilestoneConfig
                     │
                     └──1:N──> FundingClaim ──1:N──> PayoutAttempt
                                    │
                                    ├──> Attestation (evidence)
                                    ├──> User (verifier)
                                    └──> Project
```

---

## 6. Event-to-Milestone Mapping

| # | Milestone | Stage Type | Status | Data Condition |
|---|---|---|---|---|
| 0 | SCREENING_COMPLETED | SYMPTOM_SCREENING | COMPLETED | — |
| 1 | IMAGING_COMPLETED | IMAGING | COMPLETED | — |
| 2 | SPECIALIST_REVIEW_COMPLETED | SPECIALIST_REVIEW | COMPLETED | — |
| 3 | CSF_TEST_COMPLETED | CSF_TESTING | COMPLETED | — |
| 4 | SHUNT_PERFORMED | SHUNT_INTERVENTION | COMPLETED | — |
| 5 | FOLLOWUP_3M_COMPLETED | FOLLOW_UP | COMPLETED | — |
| 6 | VALIDATED_IMPROVEMENT_RECORDED | FOLLOW_UP | COMPLETED | outcome = 'IMPROVED' |

**Note:** TREATMENT_DECISION has no milestone — it is a decision point, not a payable outcome.

---

## 7. API Routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/funding/programs` | Any auth | List programs (filterable by projectId, status) |
| POST | `/api/funding/programs` | ADMIN | Create a program |
| GET | `/api/funding/programs/[id]` | Any auth | Program detail with configs |
| PUT | `/api/funding/programs/[id]` | ADMIN | Update program fields/status |
| GET | `/api/funding/programs/[id]/milestones` | Any auth | List milestone configs |
| POST | `/api/funding/programs/[id]/milestones` | ADMIN | Create/update milestone config |
| GET | `/api/funding/claims` | Any auth | List claims (paginated, filterable) |
| GET | `/api/funding/claims/[id]` | Any auth | Claim detail with payout attempts |
| POST | `/api/funding/claims/check-eligibility` | ADMIN/RESEARCHER/COORDINATOR | Check eligibility |
| POST | `/api/funding/claims/submit` | ADMIN | Submit payout |

---

## 8. Security Considerations

### On-Chain
- **Role-based access:** Only VERIFIER_ROLE can call `payMilestone`. Only PROGRAM_ADMIN_ROLE can create/configure programs.
- **Reentrancy guard:** All state-changing functions use OpenZeppelin's `nonReentrant`.
- **Pausable:** Contract can be paused in emergencies.
- **Replay protection:** Dual-layer — claim key hash + attestation hash both checked.
- **No PHI:** All identifiers are SHA-256 pseudo-references.

### Off-Chain
- **RBAC enforcement:** All API routes use `requireAuth()` with role restrictions.
- **Attestation gate:** No payout without a SIGNED/ANCHORED attestation (cryptographic proof of the clinical event).
- **Budget tracking:** Off-chain mirror prevents overspend even if on-chain state is unreachable.
- **Audit trail:** Every payout attempt is recorded with status, tx details, and timestamps.
- **Blockchain optional:** NullFundingProvider ensures the system degrades gracefully. Mock payouts are explicitly marked.

### Data Governance
- Patient-level data remain off-chain.
- FundingClaim stores `episodePseudoRef` and `sitePseudoRef` (hashed) for on-chain use.
- `provenanceBinding` JSON field preserves the full evidence chain for auditors.

---

## 9. Testing Path

### Unit Tests (recommended)

1. **Milestone resolution:**
   - `resolveMilestoneType('SYMPTOM_SCREENING', 'COMPLETED')` → `0`
   - `resolveMilestoneType('FOLLOW_UP', 'COMPLETED', { outcome: 'IMPROVED' })` → `6`
   - `resolveMilestoneType('FOLLOW_UP', 'COMPLETED', {})` → `5` (fallback)
   - `resolveMilestoneType('TREATMENT_DECISION', 'COMPLETED')` → `null`

2. **Pseudo-reference generation:**
   - Deterministic: same input → same output
   - Format: `0x` + 64 hex chars

3. **Eligibility checking:**
   - Missing program → not eligible
   - Inactive program → not eligible
   - No pathway event → not eligible
   - No attestation → not eligible
   - Duplicate claim → not eligible, `alreadyPaid: true`
   - All conditions met → eligible

4. **Payout submission (mock mode):**
   - Creates FundingClaim + PayoutAttempt
   - Returns `isMock: true`, status `MOCK_APPROVED`
   - Increments program `totalPaidOut`
   - Failed provider → status `FAILED`

### Integration Tests

5. **API route tests:**
   - Create program → configure milestones → check eligibility → submit payout
   - Verify RBAC: non-ADMIN cannot create programs or submit payouts
   - Verify pagination on claims listing

### Contract Tests (Hardhat/Foundry — future)

6. **Solidity contract tests:**
   - Program lifecycle (create → activate → deposit → pay → recover)
   - Replay protection (double-pay reverts)
   - Role enforcement (unauthorized calls revert)
   - Pause/unpause behavior
   - Insufficient treasury reverts

---

## Checkpoint Summary

```
Step: Outcome-Based Funding Layer Implementation
Completed: All core artifacts
Design choices:
  - 7 milestones mapping to iNPH pathway stages
  - Dual replay protection (claim key + attestation hash)
  - NullFundingProvider for mock mode
  - SHA-256 pseudo-references for on-chain identifiers
  - Off-chain budget mirror in FundingProgram
  - Provenance binding captured in claim JSON field
Assumptions:
  - Blockchain activation gated behind explicit admin action
  - ERC20 token (USDC-style) for payouts
  - Single recipient per milestone payout
  - Attestation must be SIGNED or ANCHORED for eligibility
Risks:
  - On-chain/off-chain budget desync if contract is used without the service layer
  - Mock payouts could be confused with real ones (mitigated by isMock flag)
  - Gas costs for on-chain payMilestone not yet estimated
Testing path: Unit → Integration → Contract (see Section 9)
Artifacts created:
  - contracts/NphOutcomeFundingVault.sol
  - lib/funding/types.ts
  - lib/funding/null-funding-provider.ts
  - lib/funding/payout-service.ts
  - lib/funding/index.ts
  - prisma/schema.prisma (4 new models, 4 new enums, reverse relations)
  - app/api/funding/programs/route.ts
  - app/api/funding/programs/[id]/route.ts
  - app/api/funding/programs/[id]/milestones/route.ts
  - app/api/funding/claims/route.ts
  - app/api/funding/claims/[id]/route.ts
  - app/api/funding/claims/check-eligibility/route.ts
  - app/api/funding/claims/submit/route.ts
  - docs/funding-layer-architecture.md
Pending decisions:
  - Which EVM chain to target (Polygon, Base, Arbitrum)
  - Treasury deposit flow (manual or automated)
  - Recipient address management (site-level wallets)
  - Retry policy for failed on-chain transactions
Ready for next step: Yes — contract deployment configuration and UI integration
```
