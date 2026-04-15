// ============================================================
// NPH-Trust Outcome-Based Funding — Payout Service
// ============================================================
// Orchestrates:
//   1. Eligibility checking (attestation + pathway + provenance)
//   2. Milestone resolution (event → milestone mapping)
//   3. Replay protection (claim key + attestation hash)
//   4. Payout submission (via FundingVaultProvider or mock)
//   5. Claim lifecycle management
//
// ALL funding state mutations go through this service.
// ============================================================

import { createHash } from 'crypto';
import { prisma } from '../db';
import type {
  EligibilityCheckInput,
  EligibilityCheckResult,
  PayoutSubmissionInput,
  PayoutSubmissionResult,
  FundingVaultProvider,
  FundingProvenanceBinding,
  EventToMilestoneMapping,
  MilestoneType,
} from './types';
import { DEFAULT_EVENT_MILESTONE_MAPPINGS } from './types';
import { NullFundingProvider } from './null-funding-provider';

// ============================================================
// Service Class
// ============================================================

export class FundingPayoutService {
  private provider: FundingVaultProvider;
  private mappings: EventToMilestoneMapping[];

  constructor(
    provider?: FundingVaultProvider,
    mappings?: EventToMilestoneMapping[],
  ) {
    this.provider = provider ?? new NullFundingProvider();
    this.mappings = mappings ?? DEFAULT_EVENT_MILESTONE_MAPPINGS;
  }

  // ----------------------------------------------------------
  // Pseudo-reference generation (strips PHI for on-chain use)
  // ----------------------------------------------------------

  /**
   * Produces a deterministic bytes32-compatible hex string from
   * an arbitrary identifier. Used to derive episodePseudoRef,
   * sitePseudoRef, etc. so that no PHI appears on-chain.
   */
  static generatePseudoRef(id: string): string {
    return '0x' + createHash('sha256').update(id).digest('hex');
  }

  // ----------------------------------------------------------
  // Milestone resolution
  // ----------------------------------------------------------

  /**
   * Given a pathway stage type, status, and event data, determine
   * which MilestoneType (if any) this event satisfies.
   *
   * Returns null if no mapping matches.
   */
  resolveMilestoneType(
    stageType: string,
    status: string,
    data?: Record<string, unknown> | null,
  ): MilestoneType | null {
    // Iterate mappings in order; first match wins (unless data
    // conditions exist and fail). The FOLLOW_UP stage can map
    // to two milestones — the one with data conditions is more
    // specific and should be tried first if conditions match.
    let fallback: MilestoneType | null = null;

    for (const mapping of this.mappings) {
      if (mapping.stageType !== stageType) continue;
      if (mapping.requiredStatus !== status) continue;

      if (mapping.dataConditions && mapping.dataConditions.length > 0) {
        // Check all data conditions
        const conditionsMet = mapping.dataConditions.every((cond) => {
          const value = getNestedValue(data, cond.fieldPath);
          if (cond.operator === 'eq') return value === cond.value;
          if (cond.operator === 'in') return Array.isArray(cond.value) && (cond.value as unknown[]).includes(value);
          return false;
        });
        if (conditionsMet) return mapping.milestoneType;
      } else {
        // No conditions — this is the fallback for this stageType
        fallback = mapping.milestoneType;
      }
    }

    return fallback;
  }

  // ----------------------------------------------------------
  // Eligibility checking
  // ----------------------------------------------------------

  /**
   * Check whether a milestone payout is eligible for a given
   * episode within a funding program.
   *
   * Checks:
   *   1. Program exists and is ACTIVE
   *   2. Milestone config exists and is enabled
   *   3. A SIGNED attestation exists for this milestone
   *   4. A completed pathway event exists
   *   5. No duplicate claim (program + episode + milestone)
   *   6. Attestation hash not already used
   */
  async checkEligibility(
    input: EligibilityCheckInput,
  ): Promise<EligibilityCheckResult> {
    const { projectId, episodeId, milestoneType, programId } = input;

    const milestoneKey = milestoneType.toString();

    // 1. Program existence and status
    const program = await prisma.fundingProgram.findUnique({
      where: { id: programId },
      include: { milestoneConfigs: true },
    });

    if (!program || program.projectId !== projectId) {
      return notEligible('Funding program not found or project mismatch');
    }
    if (program.status !== 'ACTIVE') {
      return notEligible(`Funding program is not active (status: ${program.status})`);
    }

    // 2. Milestone config
    const msConfig = program.milestoneConfigs.find(
      (mc) => mc.milestoneType === milestoneKey,
    );
    if (!msConfig || !msConfig.enabled) {
      return notEligible(`Milestone type ${milestoneKey} is not configured or disabled`);
    }

    // 3. Find the episode
    const episode = await prisma.patientEpisode.findUnique({
      where: { id: episodeId },
    });
    if (!episode || episode.projectId !== projectId) {
      return notEligible('Patient episode not found or project mismatch');
    }

    // 4. Find matching pathway event via stageDefinition
    //    PathwayEvent references stageDefinition (which has stageType).
    //    We join through stageDefinition to filter by stageType.
    const pathwayEvent = await prisma.pathwayEvent.findFirst({
      where: {
        patientEpisodeId: episodeId,
        stageDefinition: { stageType: msConfig.stageType as any },
        status: 'COMPLETED',
      },
      include: {
        stageDefinition: { select: { stageType: true } },
      },
      orderBy: { completedAt: 'desc' },
    });

    if (!pathwayEvent) {
      return notEligible(
        `No completed pathway event found for stage ${msConfig.stageType}`,
      );
    }

    // 4b. Check data conditions (for milestones like VALIDATED_IMPROVEMENT)
    if (msConfig.dataConditions) {
      const conditions = msConfig.dataConditions as {
        fieldPath: string;
        operator: string;
        value: unknown;
      }[];
      const eventData = pathwayEvent.data as Record<string, unknown> | null;
      const conditionsMet = conditions.every((cond) => {
        const value = getNestedValue(eventData, cond.fieldPath);
        if (cond.operator === 'eq') return value === cond.value;
        if (cond.operator === 'in') return Array.isArray(cond.value) && (cond.value as unknown[]).includes(value);
        return false;
      });
      if (!conditionsMet) {
        return notEligible(
          `Data conditions not met for milestone ${milestoneKey}`,
        );
      }
    }

    // 5. Find attestation for this event (must be SIGNED or ANCHORED)
    const attestation = await prisma.attestation.findFirst({
      where: {
        projectId,
        pathwayEventId: pathwayEvent.id,
        status: { in: ['SIGNED', 'ANCHORED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!attestation) {
      return notEligible(
        'No signed/anchored attestation found for this pathway event',
      );
    }

    // 6. Replay protection — check for existing claim
    const existingClaim = await prisma.fundingClaim.findUnique({
      where: {
        programId_episodeId_milestoneType: {
          programId,
          episodeId,
          milestoneType: milestoneKey as any,
        },
      },
    });

    const alreadyPaid = !!existingClaim && [
      'CONFIRMED',
      'MOCK_APPROVED',
      'SUBMITTED',
    ].includes(existingClaim.status);

    // 6b. Check attestation hash reuse
    const attestationAlreadyUsed = await prisma.fundingClaim.count({
      where: {
        attestationHash: attestation.payloadHash,
        status: { in: ['CONFIRMED', 'MOCK_APPROVED', 'SUBMITTED'] },
      },
    }) > 0;

    if (alreadyPaid) {
      return {
        eligible: false,
        reason: 'A payout for this program+episode+milestone already exists',
        attestation: {
          id: attestation.id,
          payloadHash: attestation.payloadHash,
          status: attestation.status,
          provenanceNodeId: attestation.provenanceNodeId,
          eventType: attestation.eventType,
        },
        pathwayEvent: {
          id: pathwayEvent.id,
          stageType: pathwayEvent.stageDefinition.stageType,
          status: pathwayEvent.status,
          completedAt: pathwayEvent.completedAt?.toISOString() ?? null,
        },
        alreadyPaid: true,
        attestationAlreadyUsed,
      };
    }

    // Eligible!
    return {
      eligible: true,
      reason: 'All conditions met — milestone payout is eligible',
      attestation: {
        id: attestation.id,
        payloadHash: attestation.payloadHash,
        status: attestation.status,
        provenanceNodeId: attestation.provenanceNodeId,
        eventType: attestation.eventType,
      },
      pathwayEvent: {
        id: pathwayEvent.id,
        stageType: pathwayEvent.stageDefinition.stageType,
        status: pathwayEvent.status,
        completedAt: pathwayEvent.completedAt?.toISOString() ?? null,
      },
      alreadyPaid: false,
      attestationAlreadyUsed,
    };
  }

  // ----------------------------------------------------------
  // Payout submission
  // ----------------------------------------------------------

  /**
   * Submit a funding payout. This:
   *   1. Creates or updates the FundingClaim record
   *   2. Creates a PayoutAttempt
   *   3. Calls the FundingVaultProvider (or NullFundingProvider)
   *   4. Updates claim status based on result
   *   5. Updates program budget tracking
   */
  async submitPayout(
    input: PayoutSubmissionInput,
  ): Promise<PayoutSubmissionResult> {
    const isMock = !(await this.provider.isAvailable());

    // 1. Upsert claim record
    const claim = await prisma.fundingClaim.upsert({
      where: { id: input.claimId },
      create: {
        id: input.claimId,
        programId: input.programId,
        projectId: await this.getProjectIdForProgram(input.programId),
        episodeId: input.episodeRef,
        milestoneType: this.getMilestoneKey(input.milestoneType),
        status: 'PENDING_SUBMIT',
        attestationId: '', // Will be updated from eligibility
        attestationHash: input.attestationHash,
        pathwayEventId: '',
        amount: input.amount,
        recipientAddress: input.recipient,
        episodePseudoRef: FundingPayoutService.generatePseudoRef(input.episodeRef),
        sitePseudoRef: input.siteId ? FundingPayoutService.generatePseudoRef(input.siteId) : null,
      },
      update: {
        status: 'PENDING_SUBMIT',
      },
    });

    // 2. Create payout attempt
    const attemptCount = await prisma.payoutAttempt.count({
      where: { claimId: claim.id },
    });

    const attempt = await prisma.payoutAttempt.create({
      data: {
        claimId: claim.id,
        attemptNumber: attemptCount + 1,
        status: 'PENDING',
        isMock,
        submittedAt: new Date(),
      },
    });

    // 3. Call provider
    let txResult;
    try {
      txResult = await this.provider.payMilestone({
        claimId: claim.id,
        programId: input.programId,
        siteId: input.siteId,
        episodeRef: input.episodeRef,
        milestoneType: input.milestoneType,
        attestationHash: input.attestationHash,
        recipient: input.recipient,
      });
    } catch (err: any) {
      // Provider call failed
      await prisma.payoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          errorDetail: err.message ?? 'Unknown provider error',
        },
      });

      await prisma.fundingClaim.update({
        where: { id: claim.id },
        data: { status: 'FAILED' },
      });

      return {
        claimId: claim.id,
        status: 'FAILED',
        txResult: null,
        isMock,
        error: err.message ?? 'Unknown provider error',
      };
    }

    // 4. Update records based on result
    const finalClaimStatus = txResult.success
      ? (isMock ? 'MOCK_APPROVED' : 'CONFIRMED')
      : 'FAILED';

    const finalAttemptStatus = txResult.success ? (isMock ? 'CONFIRMED' : 'CONFIRMED') : 'FAILED';

    await prisma.payoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: finalAttemptStatus,
        txHash: txResult.txHash,
        blockNumber: txResult.blockNumber,
        gasUsed: txResult.gasUsed,
        confirmedAt: txResult.success ? new Date() : undefined,
        errorDetail: txResult.error,
      },
    });

    await prisma.fundingClaim.update({
      where: { id: claim.id },
      data: {
        status: finalClaimStatus,
        txHash: txResult.txHash,
        blockNumber: txResult.blockNumber,
        onChainClaimId: txResult.txHash ? `claim-${txResult.txHash.slice(0, 10)}` : null,
        paidAt: txResult.success ? new Date() : undefined,
      },
    });

    // 5. Update program budget tracking (if successful)
    if (txResult.success) {
      await prisma.fundingProgram.update({
        where: { id: input.programId },
        data: {
          totalPaidOut: {
            increment: parseFloat(input.amount),
          },
        },
      });
    }

    return {
      claimId: claim.id,
      status: finalClaimStatus,
      txResult,
      isMock,
      error: txResult.error,
    };
  }

  // ----------------------------------------------------------
  // Build provenance binding for a claim
  // ----------------------------------------------------------

  /**
   * Constructs the provenance binding JSON for a claim,
   * capturing the full evidence chain.
   */
  async buildProvenanceBinding(
    attestationId: string,
    attestationHash: string,
    pathwayEventId: string,
  ): Promise<FundingProvenanceBinding> {
    const attestation = await prisma.attestation.findUnique({
      where: { id: attestationId },
      select: {
        provenanceNodeId: true,
        anchorTxHash: true,
        anchorChainId: true,
        anchorBlockNumber: true,
        anchorContractAddr: true,
      },
    });

    // Collect provenance node IDs from the attestation's provenance graph
    const provenanceNodeIds: string[] = [];
    if (attestation?.provenanceNodeId) {
      provenanceNodeIds.push(attestation.provenanceNodeId);

      // Walk upstream edges to collect parent nodes
      const edges = await prisma.provenanceEdge.findMany({
        where: { targetId: attestation.provenanceNodeId },
        select: { sourceId: true },
      });
      for (const edge of edges) {
        provenanceNodeIds.push(edge.sourceId);
      }
    }

    return {
      attestationId,
      attestationHash,
      attestationProvenanceNodeId: attestation?.provenanceNodeId ?? null,
      pathwayEventId,
      provenanceNodeIds,
      onChainRef: attestation?.anchorTxHash
        ? {
            attestationId,
            payloadHash: attestationHash,
            txHash: attestation.anchorTxHash,
            chainId: attestation.anchorChainId ?? null,
            blockNumber: attestation.anchorBlockNumber ?? null,
            anchorTimestamp: null,
          }
        : null,
    };
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private async getProjectIdForProgram(programId: string): Promise<string> {
    const prog = await prisma.fundingProgram.findUniqueOrThrow({
      where: { id: programId },
      select: { projectId: true },
    });
    return prog.projectId;
  }

  private getMilestoneKey(milestoneType: MilestoneType): any {
    // Map numeric enum back to Prisma enum string
    const map: Record<number, string> = {
      0: 'SCREENING_COMPLETED',
      1: 'IMAGING_COMPLETED',
      2: 'SPECIALIST_REVIEW_COMPLETED',
      3: 'CSF_TEST_COMPLETED',
      4: 'SHUNT_PERFORMED',
      5: 'FOLLOWUP_3M_COMPLETED',
      6: 'VALIDATED_IMPROVEMENT_RECORDED',
    };
    return map[milestoneType] ?? 'SCREENING_COMPLETED';
  }
}

// ============================================================
// Utility functions
// ============================================================

function notEligible(reason: string): EligibilityCheckResult {
  return {
    eligible: false,
    reason,
    attestation: null,
    pathwayEvent: null,
    alreadyPaid: false,
    attestationAlreadyUsed: false,
  };
}

/**
 * Access a nested field in an object using dot notation.
 * e.g. getNestedValue({ a: { b: 1 } }, 'a.b') => 1
 */
function getNestedValue(
  obj: Record<string, unknown> | null | undefined,
  path: string,
): unknown {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
