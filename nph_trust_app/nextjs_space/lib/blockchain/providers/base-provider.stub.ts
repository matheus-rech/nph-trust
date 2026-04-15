// ============================================================
// Base L2 Provider — STUB
// ============================================================
// Real implementation will be added in Phase 1 blockchain work.
// This stub satisfies the interface for type checking.
// ============================================================

import type { BlockchainProvider, TxRef, AnchorStatus } from '../../types';
import type { ChainConfig } from '../types';

export class BaseProvider implements BlockchainProvider {
  readonly chainId: string = 'base';
  private config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
  }

  async submitAnchor(hash: string): Promise<TxRef> {
    // TODO: Phase 1 — implement real contract interaction
    throw new Error('[BaseProvider] Not yet implemented — Phase 1 pending');
  }

  async verifyAnchor(hash: string): Promise<boolean> {
    throw new Error('[BaseProvider] Not yet implemented — Phase 1 pending');
  }

  async getStatus(tx: TxRef): Promise<AnchorStatus> {
    throw new Error('[BaseProvider] Not yet implemented — Phase 1 pending');
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
