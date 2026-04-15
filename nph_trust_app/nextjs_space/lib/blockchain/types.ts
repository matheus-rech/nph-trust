// ============================================================
// NPH-Trust Blockchain Abstraction Layer — Types
// ============================================================
// This file defines the CHAIN-AGNOSTIC interface.
// All chain-specific logic lives in provider implementations.
// ============================================================

export type { BlockchainProvider, BlockchainProviderConfig, TxRef, AnchorStatus } from '../types';

// ── Chain Registry ─────────────────────────────────────────

export const SUPPORTED_CHAINS = {
  BASE: 'base',
  OPTIMISM: 'optimism',
  POLYGON: 'polygon',
  LOCALHOST: 'localhost',
} as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

// ── Provider Factory Config ────────────────────────────────

export interface ChainConfig {
  chainId: SupportedChain;
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  explorerUrl?: string;
  gasLimitOverride?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

// ── Anchor Request/Response ────────────────────────────────

export interface AnchorRequest {
  attestationId: string;
  payloadHash: string;
  chainId: SupportedChain;
}

export interface AnchorResponse {
  success: boolean;
  txRef?: string;
  error?: string;
  chainId: SupportedChain;
}
