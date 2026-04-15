// ============================================================
// NPH-Trust Attestation Engine
// ============================================================
// Responsibilities (chain-AGNOSTIC):
//   1. Deterministic canonical JSON serialization
//   2. SHA-256 hashing
//   3. HMAC signing with versioned algorithm
//   4. Signature verification
//   5. Idempotency key generation
//
// This module NEVER touches blockchain logic.
// That boundary is enforced by the BlockchainProvider interface.
// ============================================================

import crypto from 'crypto';
import type { AttestationPayload, SigningResult } from './types';

// ── Configuration ──────────────────────────────────────────

const CURRENT_ALGORITHM_VERSION = 'HMAC_SHA256_v1';
const SCHEMA_VERSION = '1.0.0';

function getHmacSecret(): string {
  const secret = process.env.HMAC_SECRET;
  if (!secret) {
    throw new Error(
      'CRITICAL: HMAC_SECRET environment variable is not set. ' +
      'Attestation signing cannot proceed without a secret key. ' +
      'Set HMAC_SECRET in your .env file.'
    );
  }
  return secret;
}

// ── Deterministic Canonical Serialization ──────────────────

function deepSortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((item) => deepSortKeys(item));
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    Object.keys(obj as Record<string, unknown>)
      .sort()
      .forEach((key: string) => {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== undefined) {
          sorted[key] = deepSortKeys(val);
        }
      });
    return sorted;
  }
  return obj;
}

/**
 * Produces a deterministic JSON string from any object.
 * Rules:
 *   - Keys sorted lexicographically at all levels
 *   - Dates → ISO strings
 *   - undefined values stripped
 *   - Identical input → identical output (idempotent)
 */
export function canonicalize(payload: Record<string, unknown>): string {
  const sorted = deepSortKeys(payload);
  return JSON.stringify(sorted);
}

// ── Hashing ────────────────────────────────────────────────

/** Compute SHA-256 hex digest of a canonical string */
export function computeHash(canonical: string): string {
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Compute SHA-256 hex digest of raw file content */
export function computeFileHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ── Signing ────────────────────────────────────────────────

/**
 * Sign a hash with the institutional HMAC key.
 * Returns versioned signature metadata.
 */
export function signHash(hash: string): SigningResult {
  const secret = getHmacSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(hash, 'utf8')
    .digest('hex');
  return {
    signature,
    signerId: 'nph-trust-institutional-signer',
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
  };
}

/**
 * Verify a signature against a hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySignature(
  hash: string,
  signature: string,
  _algorithmVersion?: string
): boolean {
  // Currently only HMAC_SHA256_v1 is supported.
  // Future versions can branch on _algorithmVersion.
  const expected = signHash(hash);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected.signature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

// ── Attestation Payload Builder ────────────────────────────

/**
 * Build a deterministic AttestationPayload.
 * The payload itself contains NO timestamps — timestamps live
 * on the Attestation record, not inside the hashed content.
 * This ensures identical data always produces the same hash.
 */
export function buildAttestationPayload(
  eventType: string,
  subjectType: string,
  subjectId: string,
  projectId: string,
  canonicalData: Record<string, unknown>
): AttestationPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventType: eventType as AttestationPayload['eventType'],
    subjectType,
    subjectId,
    projectId,
    canonicalData,
  };
}

// ── Idempotency ────────────────────────────────────────────

/**
 * Generate a deterministic idempotency key from payload hash + event type.
 * Identical payload → identical key → prevents duplicate attestations.
 */
export function generateIdempotencyKey(
  projectId: string,
  eventType: string,
  payloadHash: string
): string {
  const input = `${projectId}:${eventType}:${payloadHash}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// ── Full Attestation Pipeline (chain-agnostic) ─────────────

export interface CreateAttestationInput {
  projectId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  canonicalData: Record<string, unknown>;
  pathwayEventId?: string;
  createdById: string;
}

export interface CreateAttestationResult {
  payloadCanonical: string;
  payloadHash: string;
  signature: string;
  signerId: string;
  algorithmVersion: string;
  idempotencyKey: string;
  eventType: string;
}

/**
 * Execute the full chain-agnostic attestation pipeline:
 *   1. Build payload
 *   2. Canonicalize
 *   3. Hash
 *   4. Sign
 *   5. Generate idempotency key
 *
 * Returns everything needed to create the DB record.
 * Does NOT interact with the database or blockchain.
 */
export function createAttestationData(
  input: CreateAttestationInput
): CreateAttestationResult {
  const payload = buildAttestationPayload(
    input.eventType,
    input.subjectType,
    input.subjectId,
    input.projectId,
    input.canonicalData
  );

  const payloadCanonical = canonicalize(payload as unknown as Record<string, unknown>);
  const payloadHash = computeHash(payloadCanonical);
  const sig = signHash(payloadHash);
  const idempotencyKey = generateIdempotencyKey(
    input.projectId,
    input.eventType,
    payloadHash
  );

  return {
    payloadCanonical,
    payloadHash,
    signature: sig.signature,
    signerId: sig.signerId,
    algorithmVersion: sig.algorithmVersion,
    idempotencyKey,
    eventType: input.eventType,
  };
}

export { CURRENT_ALGORITHM_VERSION, SCHEMA_VERSION };
