// ============================================================
// NullProvider — graceful degradation when blockchain is
// unavailable or not configured.
// ============================================================

import type { BlockchainProvider, TxRef, AnchorStatus } from '../../types';

export class NullProvider implements BlockchainProvider {
  readonly chainId: string;

  constructor(chainId: string) {
    this.chainId = `null:${chainId}`;
  }

  async submitAnchor(_hash: string): Promise<TxRef> {
    console.warn(`[NullProvider:${this.chainId}] submitAnchor called — blockchain not configured`);
    return `null-tx-${Date.now()}`;
  }

  async verifyAnchor(_hash: string): Promise<boolean> {
    console.warn(`[NullProvider:${this.chainId}] verifyAnchor called — blockchain not configured`);
    return false;
  }

  async getStatus(_tx: TxRef): Promise<AnchorStatus> {
    return { state: 'NOT_FOUND' };
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
