// ============================================================
// NPH-Trust Blockchain Provider Registry
// ============================================================
// Configuration-driven provider selection.
// Isolates chain-specific logic behind the BlockchainProvider
// interface. Business logic NEVER imports chain-specific code.
// ============================================================

import type { BlockchainProvider } from '../types';
import type { SupportedChain, ChainConfig } from './types';
import { NullProvider } from './providers/null-provider';

const providers = new Map<string, BlockchainProvider>();

/**
 * Register a provider for a specific chain.
 * Called during app initialization.
 */
export function registerProvider(
  chainId: SupportedChain,
  provider: BlockchainProvider
): void {
  providers.set(chainId, provider);
}

/**
 * Get the provider for a chain. Returns NullProvider if none registered.
 * Business logic should handle NullProvider gracefully (system works
 * even if blockchain is unavailable).
 */
export function getProvider(chainId: SupportedChain): BlockchainProvider {
  return providers.get(chainId) ?? new NullProvider(chainId);
}

/**
 * Get the default/active provider based on environment config.
 */
export function getDefaultProvider(): BlockchainProvider {
  const defaultChain = (process.env.BLOCKCHAIN_CHAIN_ID ?? 'base') as SupportedChain;
  return getProvider(defaultChain);
}

/**
 * Check if any real (non-null) provider is available.
 */
export function isBlockchainConfigured(): boolean {
  for (const [, provider] of providers) {
    if (!(provider instanceof NullProvider)) return true;
  }
  return false;
}

/**
 * List all registered chain IDs.
 */
export function listRegisteredChains(): string[] {
  return Array.from(providers.keys());
}
