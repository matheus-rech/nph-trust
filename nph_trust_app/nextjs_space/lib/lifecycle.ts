// ============================================================
// NPH-Trust Lifecycle Enforcement Module
// ============================================================
// Defines allowed state transitions for pathway events and
// attestations. All transitions are enforced — not descriptive.
// ============================================================

import type { AttestationStatusType, PathwayEventStatusType } from './types';

// ── Attestation Lifecycle ──────────────────────────────────

const ATTESTATION_TRANSITIONS: Record<AttestationStatusType, AttestationStatusType[]> = {
  DRAFT:          ['HASHED', 'FAILED'],
  HASHED:         ['SIGNED', 'FAILED'],
  SIGNED:         ['ANCHOR_PENDING', 'FAILED'],
  ANCHOR_PENDING: ['ANCHORED', 'FAILED'],
  ANCHORED:       ['REVERIFIED'],
  FAILED:         ['DRAFT', 'HASHED', 'SIGNED', 'ANCHOR_PENDING'],  // retry paths
  REVERIFIED:     ['ANCHOR_PENDING'],  // can re-anchor after reverification
};

export function isValidAttestationTransition(
  from: AttestationStatusType,
  to: AttestationStatusType
): boolean {
  return ATTESTATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidAttestationTransitions(
  from: AttestationStatusType
): AttestationStatusType[] {
  return ATTESTATION_TRANSITIONS[from] ?? [];
}

export function enforceAttestationTransition(
  from: AttestationStatusType,
  to: AttestationStatusType
): void {
  if (!isValidAttestationTransition(from, to)) {
    throw new AttestationLifecycleError(
      `Invalid attestation transition: ${from} → ${to}. ` +
      `Allowed from ${from}: [${getValidAttestationTransitions(from).join(', ')}]`
    );
  }
}

// ── Pathway Event Lifecycle ────────────────────────────────

const PATHWAY_EVENT_TRANSITIONS: Record<PathwayEventStatusType, PathwayEventStatusType[]> = {
  PENDING:     ['IN_PROGRESS', 'SKIPPED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED:   [],  // terminal — no further transitions
  SKIPPED:     ['PENDING'],  // can be un-skipped
  CANCELLED:   ['PENDING'],  // can be re-opened
  FAILED:      ['PENDING', 'IN_PROGRESS'],  // retry paths
};

export function isValidPathwayEventTransition(
  from: PathwayEventStatusType,
  to: PathwayEventStatusType
): boolean {
  return PATHWAY_EVENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidPathwayEventTransitions(
  from: PathwayEventStatusType
): PathwayEventStatusType[] {
  return PATHWAY_EVENT_TRANSITIONS[from] ?? [];
}

export function enforcePathwayEventTransition(
  from: PathwayEventStatusType,
  to: PathwayEventStatusType
): void {
  if (!isValidPathwayEventTransition(from, to)) {
    throw new PathwayEventLifecycleError(
      `Invalid pathway event transition: ${from} → ${to}. ` +
      `Allowed from ${from}: [${getValidPathwayEventTransitions(from).join(', ')}]`
    );
  }
}

// ── Error Classes ──────────────────────────────────────────

export class AttestationLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationLifecycleError';
  }
}

export class PathwayEventLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathwayEventLifecycleError';
  }
}
