// ============================================================
// Null Funding Provider — Mock for disabled blockchain
// ============================================================
// Mirrors NullProvider pattern. When blockchain is not configured,
// payout calls succeed as mocks with deterministic fake tx refs.
// ============================================================

import type {
  FundingVaultProvider,
  PayMilestoneParams,
  ContractTxResult,
  MilestoneType,
} from './types';

export class NullFundingProvider implements FundingVaultProvider {
  readonly chainId: string;
  readonly contractAddress: string | null = null;

  constructor(chainId: string = 'null') {
    this.chainId = `null:${chainId}`;
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async payMilestone(params: PayMilestoneParams): Promise<ContractTxResult> {
    console.warn(
      `[NullFundingProvider] payMilestone called — blockchain not configured. ` +
      `ClaimId: ${params.claimId}, Milestone: ${params.milestoneType}`
    );
    return {
      success: true,
      txHash: `mock-tx-${params.claimId}-${Date.now()}`,
      blockNumber: null,
      gasUsed: null,
      error: null,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async isMilestonePaid(
    _programId: string,
    _siteId: string,
    _episodeRef: string,
    _milestoneType: MilestoneType,
  ): Promise<boolean> {
    return false;
  }

  async isAttestationUsed(_attestationHash: string): Promise<boolean> {
    return false;
  }

  async getProgram(_programId: string) {
    return null;
  }
}
