# NPH-Trust Value Layer

Design-only module defining how attestation-backed clinical events
create real-world value through blockchain.

## Status

**DESIGN ONLY** — TypeScript interfaces defined, no runtime implementation.

## Contents

- `types.ts` — All interfaces for OBF, vRWE, and RCR use cases
- `index.ts` — Barrel export
- `../docs/value-layer-architecture.md` — Full architecture document

## Use Cases

1. **Outcome-Based Funding (OBF)**: Verified pathway milestones trigger payments
2. **Verifiable Real-World Evidence (vRWE)**: Dataset hashes and analysis runs anchored on-chain
3. **Research Contribution / Reputation (RCR)**: Contributors and validators attested

## Integration Points

- Attestation engine (`lib/attestation-service.ts`)
- Provenance graph (`lib/provenance.ts`)
- Pipeline orchestrator (`lib/pipeline/`)
- BlockchainProvider interface (`lib/blockchain/types.ts`)

## No PHI On-Chain

All on-chain data is hash-only. Patient-identifying information stays in the database.
