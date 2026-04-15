// ============================================================
// NPH-Trust AttestationService
// ============================================================
// Central service that orchestrates:
//   1. Attestation creation (with strong binding validation)
//   2. Lifecycle transitions (enforced, not descriptive)
//   3. Blockchain anchoring (via BlockchainProvider)
//   4. Verification
//   5. Idempotency
//   6. Execution logging (RunLog) with provenance linkage
//
// ALL attestation state mutations go through this service.
// No direct Prisma updates to attestation status elsewhere.
// ============================================================

import { prisma } from './db';
import {
  createAttestationData,
  computeHash,
  verifySignature,
  type CreateAttestationInput,
} from './attestation';
import {
  enforceAttestationTransition,
  AttestationLifecycleError,
} from './lifecycle';
import { createProvenanceNode, createProvenanceEdge } from './provenance';
import { getDefaultProvider, isBlockchainConfigured } from './blockchain/provider-registry';
import type { AttestationStatusType, VerificationResult, AttestationTarget } from './types';

// ============================================================
// Attestation Creation
// ============================================================

export interface CreateAttestationParams {
  projectId: string;
  eventType: string;
  target: AttestationTarget;
  canonicalData: Record<string, unknown>;
  createdById: string;
}

export interface AttestationCreateResult {
  attestation: any;
  isDuplicate: boolean;
  runLogId?: string;
}

/**
 * Create an attestation with full enforcement:
 *   1. Validate target binding (subjectId required)
 *   2. Generate deterministic payload, hash, signature
 *   3. Check idempotency (prevent duplicates)
 *   4. Persist with lifecycle state SIGNED
 *   5. Log execution in RunLog
 *   6. Create provenance node
 */
export async function createAttestation(
  params: CreateAttestationParams
): Promise<AttestationCreateResult> {
  const { projectId, eventType, target, canonicalData, createdById } = params;

  // 1. Strong binding validation
  if (!target.subjectType || !target.subjectId) {
    throw new Error('Attestation requires a clear target: subjectType and subjectId are mandatory');
  }

  // 2. Generate attestation data (canonical payload, hash, signature)
  const attData = createAttestationData({
    projectId,
    eventType,
    subjectType: target.subjectType,
    subjectId: target.subjectId,
    canonicalData,
    createdById,
  });

  // 3. Idempotency: check for existing attestation with same key
  const existing = await prisma.attestation.findUnique({
    where: { idempotencyKey: attData.idempotencyKey },
  });
  if (existing) {
    return { attestation: existing, isDuplicate: true };
  }

  // 4. Create execution log entry
  const runLog = await prisma.runLog.create({
    data: {
      projectId,
      action: `attestation.create.${eventType}`,
      status: 'SUCCESS',
      inputSummary: {
        eventType,
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        sourceArtifactIds: target.sourceArtifactIds ?? [],
      } as any,
      outputSummary: {
        payloadHash: attData.payloadHash,
        idempotencyKey: attData.idempotencyKey,
      } as any,
      triggeredBy: createdById,
    },
  });

  // 5. Persist attestation at SIGNED status
  //    (DRAFT → HASHED → SIGNED happens atomically in createAttestationData)
  const attestation = await prisma.attestation.create({
    data: {
      projectId,
      pathwayEventId: target.eventId ?? null,
      createdById,
      eventType: attData.eventType,
      subjectType: target.subjectType,
      subjectId: target.subjectId,
      payloadCanonical: attData.payloadCanonical,
      payloadHash: attData.payloadHash,
      algorithmVersion: attData.algorithmVersion,
      signatureAlgo: 'HMAC_SHA256_v1',
      signature: attData.signature,
      signerId: attData.signerId,
      status: 'SIGNED',
      sourceArtifactIds: target.sourceArtifactIds ?? [],
      idempotencyKey: attData.idempotencyKey,
    },
  });

  // 6. Create provenance node linked to the attestation AND run log
  const provNode = await createProvenanceNode({
    projectId,
    nodeType: 'ATTESTATION',
    label: `Attestation: ${eventType}`,
    entityType: 'attestation',
    entityId: attestation.id,
    attestationId: attestation.id,
    runLogId: runLog.id,
  });

  // 7. Back-link: store provenanceNodeId on the attestation for strong binding
  const updatedAttestation = await prisma.attestation.update({
    where: { id: attestation.id },
    data: { provenanceNodeId: provNode.id },
  });

  return { attestation: updatedAttestation, isDuplicate: false, runLogId: runLog.id };
}

// ============================================================
// Lifecycle Transitions
// ============================================================

/**
 * Transition an attestation to a new status.
 * Enforces the lifecycle state machine — invalid transitions throw.
 */
export async function transitionAttestationStatus(
  attestationId: string,
  newStatus: AttestationStatusType,
  metadata?: { error?: string; txHash?: string; chainId?: string; blockNumber?: number }
): Promise<any> {
  const att = await prisma.attestation.findUnique({ where: { id: attestationId } });
  if (!att) throw new Error(`Attestation ${attestationId} not found`);

  // Enforce lifecycle transition
  enforceAttestationTransition(att.status as AttestationStatusType, newStatus);

  const updateData: Record<string, any> = { status: newStatus };

  if (newStatus === 'ANCHOR_PENDING') {
    updateData.anchorRetryCount = att.anchorRetryCount + 1;
  }
  if (newStatus === 'ANCHORED' && metadata) {
    updateData.anchorTxHash = metadata.txHash;
    updateData.anchorChainId = metadata.chainId;
    updateData.anchorBlockNumber = metadata.blockNumber;
    updateData.anchorTimestamp = new Date();
  }
  if (newStatus === 'FAILED' && metadata?.error) {
    updateData.anchorError = metadata.error;
  }

  return prisma.attestation.update({
    where: { id: attestationId },
    data: updateData,
  });
}

// ============================================================
// Blockchain Anchoring
// ============================================================

/**
 * Submit an attestation's hash to the blockchain.
 * Uses the configured BlockchainProvider.
 * Returns immediately if blockchain is not configured (graceful degradation).
 */
export async function anchorAttestation(attestationId: string): Promise<{ anchored: boolean; txRef?: string; error?: string }> {
  if (!isBlockchainConfigured()) {
    return { anchored: false, error: 'Blockchain not configured — operating in local-only mode' };
  }

  const att = await prisma.attestation.findUnique({ where: { id: attestationId } });
  if (!att) throw new Error(`Attestation ${attestationId} not found`);

  // Must be SIGNED to submit
  try {
    await transitionAttestationStatus(attestationId, 'ANCHOR_PENDING');
  } catch (e) {
    if (e instanceof AttestationLifecycleError) {
      return { anchored: false, error: e.message };
    }
    throw e;
  }

  const provider = getDefaultProvider();
  try {
    const available = await provider.isAvailable();
    if (!available) {
      await transitionAttestationStatus(attestationId, 'FAILED', { error: 'Provider unavailable' });
      return { anchored: false, error: 'Blockchain provider unavailable' };
    }

    const txRef = await provider.submitAnchor(att.payloadHash);
    await transitionAttestationStatus(attestationId, 'ANCHORED', {
      txHash: txRef,
      chainId: provider.chainId,
    });

    return { anchored: true, txRef };
  } catch (err: any) {
    await transitionAttestationStatus(attestationId, 'FAILED', { error: err?.message ?? 'Unknown error' });
    return { anchored: false, error: err?.message };
  }
}

// ============================================================
// Verification
// ============================================================

/**
 * Full verification of an attestation's integrity:
 *   1. Recompute hash from stored canonical payload
 *   2. Verify signature
 *   3. Check blockchain anchor (if applicable)
 */
export async function verifyAttestation(attestationId: string): Promise<VerificationResult> {
  const att = await prisma.attestation.findUnique({ where: { id: attestationId } });
  if (!att) throw new Error(`Attestation ${attestationId} not found`);

  const recomputedHash = computeHash(att.payloadCanonical);
  const payloadIntegrity = recomputedHash === att.payloadHash;

  let signatureValid = false;
  if (att.signature) {
    try {
      signatureValid = verifySignature(att.payloadHash, att.signature, att.algorithmVersion);
    } catch {
      signatureValid = false;
    }
  }

  let anchorVerified: boolean | null = null;
  if (att.anchorTxHash && isBlockchainConfigured()) {
    try {
      const provider = getDefaultProvider();
      anchorVerified = await provider.verifyAnchor(att.payloadHash);
    } catch {
      anchorVerified = false;
    }
  }

  let status: VerificationResult['status'] = 'VERIFIED';
  if (!payloadIntegrity) status = 'PAYLOAD_TAMPERED';
  else if (!signatureValid) status = 'SIGNATURE_MISMATCH';
  else if (anchorVerified === false) status = 'ANCHOR_MISMATCH';
  else if (!att.anchorTxHash) status = 'UNANCHORED';

  // Update verification metadata
  const updateData: Record<string, any> = {
    lastVerifiedAt: new Date(),
    verificationNote: status,
  };
  if (status === 'VERIFIED' && att.status === 'ANCHORED') {
    updateData.status = 'REVERIFIED';
  }
  await prisma.attestation.update({ where: { id: attestationId }, data: updateData });

  return {
    attestationId: att.id,
    payloadHash: att.payloadHash,
    payloadIntegrity,
    signatureValid,
    anchorVerified,
    status,
    verifiedAt: new Date().toISOString(),
    details: {
      recomputedHash,
      storedHash: att.payloadHash,
      algorithmVersion: att.algorithmVersion,
      anchorChainId: att.anchorChainId ?? undefined,
      anchorTxHash: att.anchorTxHash ?? undefined,
    },
  };
}
