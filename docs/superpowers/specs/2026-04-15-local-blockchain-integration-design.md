# Local Blockchain Integration — Design Spec

> **Date:** 2026-04-15
> **Status:** Approved design — **FUTURE WORK, NOT ACTIVE**
> **Scope:** Local-only blockchain integration for the NPH-Trust outcome-based funding layer
> **Prerequisite:** Attestation service, provenance graph, funding layer (all implemented)
> **Activation:** Implementation of this spec is gated behind explicit user approval and is not part of the current default build. Do not begin implementation planning or code changes unless the user explicitly requests: "Proceed to blockchain implementation."

---

## 1. Objective

Enable end-to-end local testing of the funding layer by deploying real smart contracts to a local Ethereum node. The full flow:

```
Pathway Event (COMPLETED)
  → Provenance Node
    → Attestation (SIGNED → ANCHORED)
      → Funding Eligibility Check
        → On-Chain Payout (payMilestone)
          → Token Transfer Confirmed
```

### Constraints

- Blockchain remains **optional** — app works fully without it
- **No PHI on-chain** — only hashes, pseudo-references, enums, amounts
- **Local only** — no Base mainnet, no testnet, no real funds
- **No modifications** to core clinical workflow logic
- Testnet/mainnet support is **intentionally disabled** and requires explicit future code changes (new provider class, `CHAIN_ENV` validation update, new deployment scripts) — not just env var changes

---

## 2. Foundry Project Structure

Top-level `contracts/` directory, sibling to `nph_trust_app/`. Separate toolchain, no build coupling.

```
contracts/
├── foundry.toml
├── src/
│   ├── MockUSDC.sol               # ERC20 mock (6 decimals, owner-only mint)
│   ├── AttestationRegistry.sol    # Anchoring: anchorAttestation, isAnchored
│   └── NphOutcomeFundingVault.sol  # Funding: payMilestone, replay protection
├── script/
│   └── DeployLocal.s.sol          # Forge deployment script
├── deploy-local.sh                # Shell: anvil + deploy + export
├── deployments/
│   └── local.json                 # Auto-generated: addresses + ABIs
└── lib/
    ├── forge-std/
    └── openzeppelin-contracts/
```

### Contracts

**MockUSDC** — Minimal ERC20 with `mint(address to, uint256 amount)` (owner-only). 6 decimals to match real USDC.

**AttestationRegistry** — Attestation anchoring only. Separation of concerns from funding.
- `anchorAttestation(bytes32 hash)` — stores hash, emits event
- `isAnchored(bytes32 hash) view` — returns bool
- Internal: `mapping(bytes32 => bool)`

**NphOutcomeFundingVault** — Funding payouts only. Receives `attestationHash` as opaque input; does not manage anchoring state.
- Inherits: `AccessControl`, `Pausable`, `ReentrancyGuard` (OpenZeppelin)
- Roles: `PROGRAM_ADMIN_ROLE`, `VERIFIER_ROLE`
- Core: `createProgram`, `configureMilestonePayout`, `depositToTreasury`, `payMilestone`
- Queries: `isMilestonePaid`, `isAttestationUsed`, `getProgram`
- Replay protection: `(programId, siteId, episodeRef, milestoneType)` composite key + `attestationHash` uniqueness
- Chain ID guard: `require(block.chainid == 31337)` in deployment script

### Deployment

**DeployLocal.s.sol:**
1. Deploy MockUSDC
2. Mint 1,000,000 USDC to deployer
3. Deploy AttestationRegistry
4. Deploy NphOutcomeFundingVault with MockUSDC as payment token
5. Grant `PROGRAM_ADMIN_ROLE` and `VERIFIER_ROLE` to deployer
6. Broadcast all to local anvil

**deploy-local.sh:**
1. Start `anvil` in background (deterministic accounts)
2. Run `forge script DeployLocal.s.sol --broadcast --rpc-url http://127.0.0.1:8545`
3. Parse output, write `deployments/local.json`
4. Print `.env.local` block ready to paste

**deployments/local.json:**
```json
{
  "chainId": 31337,
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "MockUSDC": {
    "address": "0x...",
    "abi": [...],
    "version": "v1",
    "blockNumber": 1,
    "timestamp": "2026-04-15T..."
  },
  "AttestationRegistry": {
    "address": "0x...",
    "abi": [...],
    "version": "v1",
    "blockNumber": 2,
    "timestamp": "2026-04-15T..."
  },
  "NphOutcomeFundingVault": {
    "address": "0x...",
    "abi": [...],
    "version": "v1",
    "blockNumber": 3,
    "timestamp": "2026-04-15T..."
  }
}
```

### Integration Model

- Next.js app consumes only ABI JSON + addresses via env vars
- No Solidity imports in TypeScript
- No shared build pipeline

---

## 3. Environment Configuration

New env vars in `.env.local` (never committed):

```bash
BLOCKCHAIN_ENABLED=true
CHAIN_ENV=local
RPC_URL=http://127.0.0.1:8545
BLOCKCHAIN_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
REGISTRY_ADDRESS=0x...
VAULT_ADDRESS=0x...
TOKEN_ADDRESS=0x...
```

### Config Validation (inside `initBlockchain()`)

```
if BLOCKCHAIN_ENABLED !== "true" → register null providers, return
if BLOCKCHAIN_ENABLED === "true":
  - CHAIN_ENV must be "local" (only supported value; others throw)
  - RPC_URL must be non-empty
  - BLOCKCHAIN_PRIVATE_KEY must be non-empty (never logged)
  - REGISTRY_ADDRESS must match 0x + 40 hex chars
  - VAULT_ADDRESS must match 0x + 40 hex chars
  - TOKEN_ADDRESS must match 0x + 40 hex chars
  - Any failure → throw with clear message naming the missing/invalid var
```

### Typed Config Object

`initBlockchain()` produces a typed `BlockchainConfig` object stored in a module-level variable. Downstream code accesses it via `getBlockchainConfig()` — no direct `process.env` access for blockchain settings outside `initBlockchain()`.

```typescript
interface BlockchainConfig {
  enabled: boolean;
  chainEnv: 'local';
  rpcUrl: string;
  privateKey: string;
  registryAddress: string;
  vaultAddress: string;
  tokenAddress: string;
}
```

---

## 4. LocalEvmProvider

**File:** `nph_trust_app/nextjs_space/lib/blockchain/providers/local-evm-provider.ts`

Single class implementing both provider interfaces:

```typescript
class LocalEvmProvider implements BlockchainProvider, FundingVaultProvider {
  readonly chainId: string;
  readonly contractAddress: string | null;
}
```

### Construction

Receives `BlockchainConfig`. Creates:
- `ethers.JsonRpcProvider` → `config.rpcUrl`
- `ethers.Wallet` → `config.privateKey`, connected to provider
- `registryContract` → `AttestationRegistry` at `config.registryAddress`
- `vaultContract` → `NphOutcomeFundingVault` at `config.vaultAddress`
- `tokenContract` → `MockUSDC` at `config.tokenAddress`

ABIs loaded from `contracts/deployments/local.json`. If file missing → clear error: `"deployments/local.json not found — run contracts/deploy-local.sh first"`.

### BlockchainProvider Methods (attestation anchoring → AttestationRegistry)

| Method | Implementation |
|--------|---------------|
| `submitAnchor(hash)` | `registryContract.anchorAttestation(hash)` → returns tx hash |
| `verifyAnchor(hash)` | `registryContract.isAnchored(hash)` → returns boolean |
| `getStatus(txRef)` | `provider.getTransactionReceipt(txRef)` → maps to `AnchorStatus` |
| `isAvailable()` | `provider.getBlockNumber()` → true if no error |

### FundingVaultProvider Methods (funding → NphOutcomeFundingVault)

| Method | Implementation |
|--------|---------------|
| `payMilestone(params)` | `vaultContract.payMilestone(...)` → maps to `ContractTxResult` |
| `isMilestonePaid(...)` | Contract view function → boolean |
| `isAttestationUsed(hash)` | Contract view function → boolean |
| `getProgram(programId)` | Contract view function → program details or null |

### Error Handling

- All contract calls wrapped in try/catch
- Transaction failures → structured `ContractTxResult` with `success: false`
- Network errors surface through `isAvailable()` returning false
- Gas estimation failures caught and reported (pattern is production-ready)

---

## 5. Initialization & Provider Wiring

**File:** `nph_trust_app/nextjs_space/lib/blockchain/init.ts`

### `initBlockchain()` Flow

```
initBlockchain()
  ├── already initialized? → return (idempotent)
  ├── BLOCKCHAIN_ENABLED !== "true"?
  │     → register NullProvider in provider-registry
  │     → set funding provider to NullFundingProvider
  │     → mark initialized, return
  ├── validateBlockchainConfig()
  │     → read env vars ONCE → typed BlockchainConfig
  │     → store in module variable (getBlockchainConfig())
  │     → throw on missing/invalid
  ├── create LocalEvmProvider(config)
  │     → load ABIs, create ethers provider/wallet/contracts
  ├── registerProvider('localhost', localProvider)
  ├── setFundingProvider(localProvider)
  └── mark initialized
```

**Idempotency:** Module-level `let initialized = false`. Safe to call multiple times — no duplicate registrations or connections.

### Provider Registry Changes

- Add `'localhost'` to `SUPPORTED_CHAINS` in `lib/blockchain/types.ts`
- `getDefaultProvider()` uses `getBlockchainConfig()` instead of raw `process.env`

### Funding Provider Registry (new module)

**File:** `nph_trust_app/nextjs_space/lib/funding/provider-registry.ts`

```typescript
let fundingProvider: FundingVaultProvider = new NullFundingProvider();

export function setFundingProvider(provider: FundingVaultProvider): void {
  fundingProvider = provider;
}

export function getFundingProvider(): FundingVaultProvider {
  return fundingProvider;
}
```

API routes use `getFundingProvider()` when constructing `FundingPayoutService`.

### Next.js Integration

```typescript
// nph_trust_app/nextjs_space/instrumentation.ts
export async function register() {
  const { initBlockchain } = await import('@/lib/blockchain/init');
  await initBlockchain();
}
```

Called once per server startup. No scattered imports in API routes.

---

## 6. End-to-End Test Flow

**File:** `nph_trust_app/nextjs_space/scripts/test-local-blockchain.ts`
**Run:** `npx tsx scripts/test-local-blockchain.ts`

### Precondition Checks

1. `BLOCKCHAIN_ENABLED=true` and config valid
2. Anvil reachable at `RPC_URL`
3. `deployments/local.json` exists
4. Database reachable (Prisma)

### Test Steps

| Step | Action | Assertions |
|------|--------|------------|
| 1 | Create project + funding program + milestone config | Program ACTIVE, milestone IMAGING_COMPLETED @ 100 USDC, treasury funded 1000 USDC |
| 2 | Create patient episode + pathway event (IMAGING, PENDING) | Records created |
| 3 | Transition event → COMPLETED | Auto-attestation created (SIGNED), provenance node created, RunLog created |
| 4 | Anchor attestation on-chain | SIGNED → ANCHOR_PENDING → ANCHORED, `anchorTxHash` stored |
| 5 | Verify attestation | `payloadIntegrity: true`, `signatureValid: true`, `anchorVerified: true`, status REVERIFIED |
| 6 | Check funding eligibility | `eligible: true`, attestation + pathwayEvent populated |
| 7 | Submit payout | `ContractTxResult.success: true`, real txHash, claim CONFIRMED (not MOCK_APPROVED), tokens transferred |
| 8 | On-chain verification | `isMilestonePaid` true, `isAttestationUsed` true, recipient balance correct, program `totalPaidOut` matches |
| 9 | Duplicate payout rejection | Same `attestationHash` → rejected, no additional tokens transferred |
| 10 | Blockchain-disabled flow | Re-run with `BLOCKCHAIN_ENABLED=false`, system operates correctly with null providers, claim status MOCK_APPROVED |
| 11 | Timing summary | Anchor time, payout time, total flow duration |

### Output Format

Structured console output with step-by-step pass/fail indicators, transaction hashes, block numbers, and timing metrics.

### Cleanup Policy

No test data deletion. Uses timestamped pseudo IDs to avoid collisions on reruns. Keeps data inspectable for debugging.

---

## 7. Safety & Design Rules

### Hard Constraints

| Rule | Enforcement |
|------|-------------|
| Blockchain never required | Null providers registered when disabled. All services default to null. |
| No PHI on-chain | Only SHA-256 hashes, pseudo-references, milestone enums, amounts |
| No production credentials | `CHAIN_ENV` validation rejects non-`"local"` values |
| No mainnet deployment | `deploy-local.sh` hardcodes localhost + chain 31337. Forge script has `require(block.chainid == 31337)` |
| Core workflows unaffected | No modifications to pathway-service, attestation-service, attestation, lifecycle, or provenance core logic |
| Private key never logged | Only config metadata logged, never the key itself |
| Testnet/mainnet intentionally disabled | Requires new provider class + CHAIN_ENV update + deployment scripts — not just env change |

### Architectural Boundaries

| Boundary | Rule |
|----------|------|
| Contract ↔ App | ABI + addresses only. No Solidity imports in TypeScript. No shared build. |
| Provider ↔ Services | Services use interfaces only. No direct `LocalEvmProvider` imports. |
| Config ↔ Code | Env vars read once in `initBlockchain()`. Typed `BlockchainConfig` downstream. |
| Attestation ↔ Funding | Separate contracts. No shared on-chain state. Funding receives `attestationHash` as opaque input. |

### Explicit Non-Goals

- No gas optimization (local anvil has zero gas cost)
- No contract upgradability patterns
- No multi-chain support beyond `localhost`
- No frontend UI changes
- No CI/CD pipeline for contracts
- No WebSocket subscriptions for tx confirmation

---

## 8. File Inventory

### New Files

| File | Purpose |
|------|---------|
| `contracts/foundry.toml` | Foundry project config |
| `contracts/src/MockUSDC.sol` | Mock ERC20 token |
| `contracts/src/AttestationRegistry.sol` | Attestation anchoring contract |
| `contracts/src/NphOutcomeFundingVault.sol` | Funding vault contract |
| `contracts/script/DeployLocal.s.sol` | Deployment script |
| `contracts/deploy-local.sh` | Shell wrapper for local deployment |
| `contracts/deployments/local.json` | Generated addresses + ABIs |
| `nph_trust_app/nextjs_space/lib/blockchain/providers/local-evm-provider.ts` | LocalEvmProvider (both interfaces) |
| `nph_trust_app/nextjs_space/lib/blockchain/init.ts` | `initBlockchain()` + `getBlockchainConfig()` |
| `nph_trust_app/nextjs_space/lib/funding/provider-registry.ts` | Funding provider singleton |
| `nph_trust_app/nextjs_space/instrumentation.ts` | Next.js server startup hook |
| `nph_trust_app/nextjs_space/scripts/test-local-blockchain.ts` | E2E integration test |

### Modified Files

| File | Change |
|------|--------|
| `nph_trust_app/nextjs_space/lib/blockchain/types.ts` | Add `'localhost'` to `SUPPORTED_CHAINS` |
| `nph_trust_app/nextjs_space/lib/blockchain/provider-registry.ts` | `getDefaultProvider()` uses typed config |
| `nph_trust_app/nextjs_space/.env.example` | Add blockchain env var placeholders |
| `nph_trust_app/nextjs_space/package.json` | Add `ethers` dependency |

### Unmodified Files (explicitly)

- `lib/pathway-service.ts` — no changes
- `lib/attestation-service.ts` — no changes
- `lib/attestation.ts` — no changes
- `lib/lifecycle.ts` — no changes
- `lib/provenance.ts` — no changes
- `lib/funding/payout-service.ts` — no changes (uses injected provider)
- `lib/funding/types.ts` — no changes
- `prisma/schema.prisma` — no changes
