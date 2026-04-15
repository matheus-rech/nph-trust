# NPH-Trust Value Layer Architecture

> **Status**: DESIGN ONLY — interfaces defined, no implementation yet.  
> **Date**: 2026-04-15  
> **Prerequisite**: Phases 1–2 complete (attestation engine, provenance graph, pipeline orchestrator).  
> **Blockchain**: Remains OPTIONAL. System continues to function fully without it.

---

## 1. Architecture Overview

The value layer sits **above** the existing attestation + provenance foundation and **below** any smart contract deployment. It translates clinical workflow events into three categories of verifiable value:

```
┌──────────────────────────────────────────────────────────────┐
│                    SMART CONTRACTS (future)                   │
│  AttestationRegistry · OutcomeFunding · ReputationRegistry    │
├──────────────────────────────────────────────────────────────┤
│                      VALUE LAYER (this design)                │
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ Outcome-Based│  │  Verifiable   │  │   Contribution   │  │
│  │   Funding    │  │   Real-World  │  │   / Reputation   │  │
│  │   (OBF)      │  │   Evidence    │  │     (RCR)        │  │
│  │              │  │   (vRWE)      │  │                  │  │
│  └──────┬───────┘  └──────┬────────┘  └────────┬─────────┘  │
│         │                 │                     │            │
├─────────┴─────────────────┴─────────────────────┴────────────┤
│              ATTESTATION + PROVENANCE FOUNDATION              │
│                                                              │
│  Attestation Engine · Provenance Graph · Pipeline Orchestrator│
│  BlockchainProvider interface · Lifecycle Enforcement         │
├──────────────────────────────────────────────────────────────┤
│                    DATABASE (PostgreSQL)                       │
│  Attestation · ProvenanceNode · ProvenanceEdge · RunLog       │
│  PathwayEvent · Checkpoint · Approval · PatientEpisode        │
└──────────────────────────────────────────────────────────────┘
```

### Core Principle: Hash-Only On-Chain

Nothing patient-identifiable ever touches the blockchain. The on-chain layer stores only:
- **Hashes** (SHA-256 of canonical payloads)
- **Event type classifiers** (e.g., `pathway_event_completed`)
- **Aggregated scores** (reputation numbers, not the underlying data)
- **Escrow/payment references** (amounts + milestone hashes)

Verification works by:
1. Retrieving the off-chain record from the database
2. Re-computing the canonical hash
3. Checking the hash against the on-chain anchor
4. Confirming the provenance lineage connects the evidence

---

## 2. Event → Value Mapping

This table maps existing NPH-Trust pipeline events to value-layer concepts:

| System Event | Attestation eventType | OBF Value | vRWE Value | RCR Value |
|---|---|---|---|---|
| Pathway event COMPLETED | `pathway_event_completed` | **Milestone trigger** — satisfies stage completion conditions | Evidence node — proves a clinical observation occurred | **data_collection** contribution for the performer |
| Pathway event created | `pathway_event_created` | Pre-condition tracking | Evidence node (non-terminal) | **data_collection** contribution (lower weight) |
| Import executed | `import_completed` | Bulk evidence ingestion | Dataset provenance chain (INPUT→TRANSFORM→OUTPUT) | **data_curation** contribution |
| Approval granted | `approval_granted` | **Approval condition** — required by some milestones | Validation layer — data quality signal | **approval_review** contribution |
| Approval rejected | `approval_rejected` | Blocks milestone claim | Quality gate | **approval_review** contribution (lower weight) |
| Checkpoint created | `checkpoint_created` | Snapshot for audit trail | **Dataset anchor** — content hash at point in time | **data_curation** contribution |
| Data exported | `data_exported` | Audit evidence | **Dataset anchor** — output hash for reproducibility | **data_curation** contribution (lower weight) |
| Attestation verified | `manual_attestation` | Integrity confirmation | Independent verification signal | **attestation_verification** contribution |
| Blockchain anchored | (via AnchorAttestationStep) | Immutability proof for milestone evidence | Timestamp proof for dataset existence | Proof-of-contribution permanence |

---

## 3. Attestation → Blockchain Mapping

How each attestation type flows through the blockchain layer:

```
                  OFF-CHAIN                          ON-CHAIN
┌─────────────────────────────────────────┐    ┌─────────────────────────┐
│                                         │    │                         │
│  Attestation (SIGNED)                   │    │  AttestationRegistry    │
│  ├─ payloadHash ─────────────────────────┼──▶│  ├─ anchor(hash, type)  │
│  ├─ eventType                           │    │  └─ verify(hash) ✓/✗   │
│  ├─ signature (HMAC)                    │    │                         │
│  └─ provenanceNodeId ──┐                │    │  OutcomeFunding         │
│                        │                │    │  ├─ milestoneHash ◀────┐│
│  ProvenanceNode ◀──────┘                │    │  ├─ evidenceHash ◀───┐ ││
│  ├─ nodeType (EVENT/OUTPUT/...)         │    │  └─ escrow/release    │ ││
│  ├─ entityType                          │    │                      │ ││
│  ├─ edges[] (lineage)                   │    │  ReputationRegistry   │ ││
│  └─ runLogId                            │    │  ├─ reputationHash ◀┐│ ││
│                                         │    │  └─ score, count    ││ ││
│  MilestoneEvidence ─────────────────────┼──┐ │                      ││ ││
│  ├─ conditionResults[]                  │  │ │                      ││ ││
│  ├─ attestationRefs[] ──────────────────┼──┼─┼──────────────────────┘│ ││
│  └─ provenanceChainIds[]               │  └─┼───────────────────────┘ ││
│                                         │    │                         ││
│  MilestoneClaim.evidence ───────────────┼────┼─────────────────────────┘│
│                                         │    │                          │
│  ReputationProfile ─────────────────────┼────┼──────────────────────────┘
│  ├─ contributionMerkleRoot             │    │
│  └─ totalScore                          │    │
└─────────────────────────────────────────┘    └─────────────────────────┘
```

### Anchoring Rules

| What gets anchored | Contract | Trigger | Required conditions |
|---|---|---|---|
| Attestation hash | AttestationRegistry | Pipeline AnchorAttestationStep | Attestation status ≥ SIGNED |
| Milestone evidence hash | OutcomeFunding | MilestoneClaim verified | All conditions met + all attestation refs anchored |
| Reputation hash | ReputationRegistry | Periodic or on-demand | Profile computed, contribution count > threshold |
| Dataset hash | AttestationRegistry | Checkpoint/export pipeline | Checkpoint or export attestation exists |
| Analysis run hash | AttestationRegistry | Analysis pipeline (future App 2) | Input dataset anchors exist |

---

## 4. Use Case 1: Outcome-Based Funding (OBF)

### Concept

Funders (health systems, insurers, research councils) commit funds contingent on verified patient outcomes. Instead of paying for procedures, they pay for results — e.g., "patient shows gait improvement at 6 months post-shunt."

The NPH-Trust system provides the cryptographic proof that the outcome occurred, without exposing patient identity.

### Flow

```
1. AGREEMENT SETUP (off-chain)
   Funder + Registry → define FundingAgreement with milestones
   Each milestone → set of MilestoneConditions
   Agreement hash → anchored on OutcomeFunding contract

2. CLINICAL WORKFLOW (existing system)
   Patient → enters pathway → events recorded → attested → provenance tracked
   Each COMPLETED event → attestation → optional anchor

3. MILESTONE EVALUATION (new value-layer logic)
   System detects: all conditions for milestone X met for episode Y
   → Assembles MilestoneEvidence (attestation refs + provenance chain)
   → Creates MilestoneClaim with status PENDING_VERIFICATION

4. VERIFICATION (oracle or auditor)
   Verifier checks:
     a) Each condition is satisfied by a valid attestation
     b) Attestation hashes match on-chain anchors
     c) Provenance chain is connected and complete
     d) No duplicate claims for same episode+milestone
   → Updates claim to VERIFIED

5. PAYMENT RELEASE (smart contract)
   Oracle submits evidenceHash to OutcomeFunding contract
   Contract verifies:
     a) Agreement is active and has budget
     b) Milestone hash matches registered milestone
     c) Evidence hash is new (no double-claim)
   → Releases funds from escrow
   → Updates claim to PAID
```

### Example Milestone

```typescript
const shuntOutcomeMilestone: FundingMilestone = {
  milestoneId: 'ms-shunt-6mo-improved',
  label: '6-month post-shunt improvement',
  conditions: [
    { type: 'stage_completed', stageType: 'SHUNT_INTERVENTION', requiredStatus: 'COMPLETED' },
    { type: 'stage_completed', stageType: 'FOLLOW_UP', requiredStatus: 'COMPLETED' },
    { type: 'attestation_exists', eventType: 'pathway_event_completed', minimumStatus: 'SIGNED' },
    { type: 'approval_granted', targetType: 'PATHWAY_EVENT', requiredStatus: 'APPROVED' },
    { type: 'data_field', fieldPath: 'data.outcome', operator: 'eq', value: 'IMPROVED' },
    { type: 'data_field', fieldPath: 'data.followUpMonths', operator: 'gte', value: 6 },
    { type: 'anchor_confirmed' },
  ],
  paymentAmount: 5000,
  paymentCurrency: 'GBP',
  isRecurring: true,
  maxClaims: 100,
};
```

### Smart Contract Design (Conceptual)

```
contract OutcomeFunding {
  struct Agreement {
    bytes32 agreementHash;
    bytes32[] milestoneHashes;
    uint256 totalBudget;
    uint256 released;
    address funder;
    address oracle;          // Authorized verifier
    bool active;
  }

  mapping(bytes32 => Agreement) public agreements;
  mapping(bytes32 => mapping(bytes32 => bool)) public claimedMilestones;

  // Funder deposits funds and registers agreement
  function registerAgreement(bytes32 agreementHash, bytes32[] milestoneHashes)
    external payable;

  // Oracle submits verified milestone claim
  function submitClaim(
    bytes32 agreementHash,
    bytes32 milestoneHash,
    bytes32 evidenceHash,    // Hash of MilestoneEvidence
    uint256 amount,
    address payable recipient
  ) external onlyOracle(agreementHash);

  // Events emitted for off-chain tracking
  event AgreementRegistered(bytes32 indexed agreementHash, uint256 budget);
  event MilestoneClaimed(bytes32 indexed agreementHash, bytes32 milestoneHash, uint256 amount);
  event FundsReleased(bytes32 indexed agreementHash, address recipient, uint256 amount);
}
```

**Key constraint**: The oracle (NPH-Trust backend) is the ONLY entity that can submit claims. Patients never interact with the contract. The contract trusts the oracle's verification but the oracle's decisions are auditable via the attestation chain.

---

## 5. Use Case 2: Verifiable Real-World Evidence (vRWE)

### Concept

Clinical datasets and analyses are cryptographically anchored so that:
- Regulators can verify dataset integrity at any point
- Manuscript reviewers can confirm that claimed results match the data
- Reproducibility is provable: same input hash + same code hash → same output hash

### Flow

```
1. DATA COLLECTION (existing system)
   Events → attestations → provenance nodes
   Import pipeline → INPUT→TRANSFORM→OUTPUT chain

2. DATASET SNAPSHOT (existing checkpoint/export pipeline)
   Checkpoint → snapshotData hashed → attestation → optional anchor
   Export → output hashed → attestation → optional anchor
   → Creates DatasetAnchor

3. ANALYSIS RUN (future: App 2)
   Researcher runs analysis on a specific checkpoint
   → Input: DatasetAnchor[] (verified input datasets)
   → Process: analysis code/config hashed
   → Output: results hashed
   → Creates AnalysisRunAnchor with attestation for full run

4. MANUSCRIPT CLAIMS (future: App 2)
   Author writes: "73% of patients showed gait improvement"
   → Links to: DatasetAnchor + AnalysisRunAnchor + event attestations
   → Creates ManuscriptClaim with evidence chain

5. VERIFICATION / CHALLENGE
   Reviewer can:
     a) Check dataset hash matches on-chain anchor
     b) Verify analysis inputs match the claimed dataset
     c) Re-run analysis (same code hash → same output hash)
     d) Challenge claims with ClaimChallenge
```

### What Gets Anchored

| Artifact | Hash Source | Existing Support | Needs |
|---|---|---|---|
| Dataset snapshot | Checkpoint.sha256Hash | ✅ Already computed | Anchor step already in pipeline |
| Export output | Export content hash | ✅ Already computed | Anchor step already in pipeline |
| Analysis code | SHA-256 of code/config | ❌ Future (App 2) | New attestation type |
| Analysis output | SHA-256 of results | ❌ Future (App 2) | New attestation type |
| Manuscript claim | Hash of ManuscriptClaim | ❌ Future (App 2) | New attestation type |

### Integration with Existing Provenance

The provenance graph already tracks:
- INPUT → TRANSFORM → OUTPUT chains for imports
- EVENT nodes for pathway events
- ATTESTATION nodes linked to all of the above

The vRWE layer adds a **higher-level interpretation**: these provenance chains become "evidence chains" that back specific claims.

---

## 6. Use Case 3: Research Contribution / Reputation (RCR)

### Concept

Every meaningful action in the system — collecting data, reviewing approvals, curating imports, verifying attestations — generates a contribution record backed by an attestation. These contributions aggregate into a reputation profile that can optionally be published on-chain.

### Flow

```
1. ACTION (existing system)
   User performs action → pipeline executes → attestation created

2. CONTRIBUTION EXTRACTION (new value-layer logic)
   Pipeline result → match eventType to ContributionMapping
   → Create ContributionRecord with weight + attestation ref

3. REPUTATION AGGREGATION (new value-layer logic)
   Periodic or on-demand: sum contributions per user per project
   → Compute ReputationProfile

4. REPUTATION ANCHORING (optional, on-chain)
   Publish ReputationAttestationPayload:
     userId (system ID, not PII) + projectId + score + merkle root
   → Anchor on ReputationRegistry contract
   → Third parties can verify: "user X contributed Y times with score Z"
```

### Contribution Weights

The `DEFAULT_CONTRIBUTION_MAPPINGS` in `lib/value-layer/types.ts` define base weights:

| Event Type | Contribution Type | Base Weight | Rationale |
|---|---|---|---|
| pathway_event_completed | data_collection | 0.3 | High-value: terminal clinical observation |
| pathway_event_created | data_collection | 0.1 | Lower: initial recording, not validated |
| approval_granted | approval_review | 0.4 | High-value: quality gate decision |
| approval_rejected | approval_review | 0.3 | Still valuable: prevents bad data |
| import_completed | data_curation | 0.5 | High-value: bulk validated data entry |
| checkpoint_created | data_curation | 0.4 | High-value: point-in-time snapshot |
| data_exported | data_curation | 0.2 | Lower: output generation |
| manual_attestation | attestation_verification | 0.3 | Verification effort |

Weights can be adjusted per project. Future: role-based multipliers, time-decay.

### Smart Contract Design (Conceptual)

```
contract ReputationRegistry {
  struct ReputationRecord {
    bytes32 reputationHash;    // Hash of full payload
    uint256 score;             // Scaled integer (e.g., score * 1000)
    uint256 contributionCount;
    uint256 publishedAt;
  }

  // userId → projectId → reputation
  mapping(bytes32 => mapping(bytes32 => ReputationRecord)) public reputations;

  // Only authorized publisher (NPH-Trust backend)
  function publishReputation(
    bytes32 userId,
    bytes32 projectId,
    bytes32 reputationHash,
    uint256 score,
    uint256 contributionCount
  ) external onlyPublisher;

  function verifyReputation(bytes32 userId, bytes32 projectId)
    external view
    returns (bool exists, bytes32 reputationHash, uint256 score);

  event ReputationPublished(bytes32 indexed userId, bytes32 indexed projectId, uint256 score);
}
```

**Privacy note**: `userId` on-chain is a hash of the internal system ID, not a name or email. The mapping from hash → identity exists only in the off-chain database.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **PHI leakage via hash correlation** | HIGH | Canonical payloads exclude timestamps and patient IDs. Only project-scoped hashes are anchored. Attestation payloads are designed to be non-invertible. |
| **Oracle trust centralization** | MEDIUM | The NPH-Trust backend is the single oracle for milestone claims and reputation publishing. Mitigation: multi-sig oracle in future, plus full off-chain audit trail via RunLog + provenance graph. |
| **Milestone gaming** | MEDIUM | Users could fabricate pathway events to trigger milestone payments. Mitigation: approval_granted condition requires independent reviewer; data_field conditions check specific clinical outcomes; provenance chain must be connected and complete. |
| **Reputation inflation** | LOW | Users could spam low-weight events. Mitigation: weights are system-assigned (not user-chosen); minimum thresholds for anchoring; time-decay in future. |
| **Smart contract bugs** | HIGH | Standard risk. Mitigation: design-only phase (no deployment yet); formal verification planned; upgradeable proxy pattern; time-locked admin functions. |
| **Blockchain unavailability** | LOW | System already handles this via NullProvider + optional severity. Value layer degrades gracefully: claims stay in PENDING_VERIFICATION; reputation stays off-chain. |
| **Double-claim for same outcome** | MEDIUM | One patient+milestone combination should pay once. Mitigation: idempotency check in MilestoneClaim (episodePseudoId + milestoneId must be unique); on-chain duplicate check in contract. |
| **Stale reputation after contribution reversal** | LOW | If an approval is later overturned, the contribution record should be invalidated. Mitigation: contribution records reference specific attestation IDs; reputation recomputation excludes invalidated attestations. |

---

## 8. Testing Path

### Phase A: Unit tests for value-layer logic (pre-blockchain)
1. **Milestone condition evaluation**: Given a set of attestations + events + approvals, does the evaluator correctly determine if all conditions are met?
2. **Contribution extraction**: Given a pipeline result, does the mapper produce the correct ContributionRecord with appropriate weight?
3. **Reputation aggregation**: Given a set of contribution records, does the aggregator produce the correct ReputationProfile?
4. **Evidence assembly**: Given a milestone claim, does the evidence builder correctly collect attestation refs and provenance chain IDs?
5. **Idempotency**: Submitting the same milestone claim twice should not create a duplicate.

### Phase B: Integration tests with existing pipeline
6. **End-to-end milestone**: Create episode → complete stages → verify milestone conditions → assemble claim → verify evidence chain.
7. **vRWE dataset anchor**: Run export pipeline → verify DatasetAnchor references correct checkpoint hash and attestation.
8. **Contribution from pipeline**: Execute pathway_event pipeline → verify ContributionRecord created with correct mapping.

### Phase C: Smart contract tests (when implemented)
9. **Contract unit tests**: Register agreement → submit claim → verify payment release.
10. **Reputation contract**: Publish reputation → verify → update → verify again.
11. **Gas optimization**: Batch anchoring vs. individual anchoring cost comparison.

### Phase D: End-to-end integration
12. **Full flow**: Clinical workflow → attestation → anchor → milestone claim → contract verification → payment release.
13. **Degraded mode**: Repeat with blockchain disabled → verify system functions correctly with value layer in "unanchored" mode.

---

## 9. Checkpoint Summary

### Step: Value Layer Architecture Design
**Completed:** Yes (design only — no runtime implementation)

### Design Choices
| Decision | Rationale |
|---|---|
| Hash-only on-chain | PHI protection is non-negotiable; hashes are sufficient for verification |
| Oracle-mediated claims | Clinical users never touch wallets; backend submits verified claims |
| Condition-based milestones | Flexible composition of stage, attestation, approval, and data conditions |
| Contribution weights system-assigned | Prevents gaming; weights reflect objective value of actions |
| Three separate contracts | Separation of concerns; AttestationRegistry is foundational, others optional |
| DatasetAnchor reuses Checkpoint/Export | No new data model needed — existing pipeline already produces the hashes |
| ContributionMapping driven by eventType | Natural integration point — pipeline already produces typed attestations |

### Assumptions
- Blockchain implementation will use the existing `BlockchainProvider` interface
- Smart contracts will be deployed on an L2 (Base, as per existing chain registry)
- Oracle authorization will use a single backend address initially, multi-sig later
- App 2 (manuscript generation) will produce `AnalysisRunAnchor` and `ManuscriptClaim` records
- Funder payments are in stablecoin or native token on the L2

### Artifacts Created
- `lib/value-layer/types.ts` — All TypeScript interfaces (540+ lines)
- `lib/value-layer/index.ts` — Barrel export
- `docs/value-layer-architecture.md` — This document

### Pending Decisions
1. **Oracle multi-sig**: How many signers required for milestone claims? (Deferred to implementation)
2. **Contribution time-decay**: Should older contributions lose weight? (Deferred to implementation)
3. **Cross-project reputation**: Should reputation be aggregated across projects? (Deferred to design review)
4. **Funder onboarding**: How do funders register agreements and deposit funds? (Deferred to implementation)
5. **Challenge resolution process**: Who adjudicates manuscript claim challenges? (Deferred to App 2 design)

### Ready for Next Step
Yes — value layer design is complete. Implementation options:
1. **Implement contribution extraction** (can be done now, no blockchain needed)
2. **Implement milestone condition evaluator** (can be done now, no blockchain needed)
3. **Deploy AttestationRegistry contract** (requires blockchain activation)
4. **Build App 2** with vRWE + manuscript claims (separate conversation, shared DB)
