import { ReceiptAlreadyUsedError, claimReceiptNonce, usernameFromCanonicalKey } from './guestCreateService';
import { ensureScrapedProfileLink } from './scrapedProfileLink';

/**
 * Copy an extraction result onto pitches that were created while the scrape
 * was still running.
 *
 * Safe to call again. A pitch whose metrics are already set, or whose
 * pendingExtractionId no longer matches, is left alone.
 */

export const PENDING_FAILURE_STATUSES = [
  'INSUFFICIENT_DATA',
  'FAILED',
  'CANCELLED',
  'STALE',
] as const;

export interface PendingPitchApplyStore {
  guestProfileExtraction: {
    findUnique(args: { where: { id: string } }): Promise<any | null>;
    updateMany(args: { where: any; data: any }): Promise<{ count: number }>;
  };
  pitch: {
    findMany(args: { where: any; include?: any }): Promise<any[]>;
    update(args: { where: any; data: any }): Promise<any>;
    updateMany(args: { where: any; data: any }): Promise<{ count: number }>;
  };
  user: {
    update(args: { where: any; data: any }): Promise<any>;
  };
  creator: {
    findUnique(args: { where: any; select?: any }): Promise<any | null>;
    update(args: { where: any; data: any }): Promise<any>;
  };
  creditTier: {
    findFirst(args: { where: any; orderBy?: any }): Promise<any | null>;
  };
  shortListedCreator: {
    updateMany(args: { where: any; data: any }): Promise<{ count: number }>;
  };
  guestCreatorMetricAudit: {
    create(args: { data: any }): Promise<any>;
  };
  $transaction<T>(fn: (tx: PendingPitchApplyStore) => Promise<T>): Promise<T>;
}

const isEmptyMetric = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

async function assignCreditTier(
  tx: PendingPitchApplyStore,
  userId: string,
  followerCount: number,
  platform: 'instagram' | 'tiktok' | string | null,
): Promise<void> {
  const tier = await tx.creditTier.findFirst({
    where: {
      isActive: true,
      minFollowers: { lte: followerCount },
      OR: [{ maxFollowers: { gte: followerCount } }, { maxFollowers: null }],
    },
    orderBy: [{ minFollowers: 'desc' }],
  });

  await tx.creator.update({
    where: { userId },
    data: {
      manualFollowerCount: followerCount,
      ...(platform === 'tiktok'
        ? { manualTiktokFollowerCount: followerCount }
        : { manualInstagramFollowerCount: followerCount }),
      ...(tier && { creditTierId: tier.id, tierUpdatedAt: new Date() }),
    },
  });
}

async function applyReadyToPitch(
  tx: PendingPitchApplyStore,
  pitch: any,
  extraction: any,
): Promise<void> {
  const [fresh] = await tx.pitch.findMany({
    where: { id: pitch.id, pendingExtractionId: extraction.id },
    include: { user: true },
  });
  if (!fresh) return;

  const followerCount = extraction.resultFollowerCount ?? null;
  const engagementRate = extraction.resultEngagementRate ?? null;
  const resultName = typeof extraction.resultName === 'string' ? extraction.resultName.trim() : '';
  const placeholder = usernameFromCanonicalKey(extraction.canonicalProfileKey ?? '');
  const writeFollowers = isEmptyMetric(fresh.followerCount) && followerCount != null;
  const writeRate = isEmptyMetric(fresh.engagementRate) && Boolean(engagementRate);
  const alreadyComplete = !isEmptyMetric(fresh.followerCount) && !isEmptyMetric(fresh.engagementRate);

  const updated = await tx.pitch.updateMany({
    where: { id: fresh.id, pendingExtractionId: extraction.id },
    data: {
      ...(writeFollowers ? { followerCount: String(followerCount) } : {}),
      ...(writeRate ? { engagementRate } : {}),
      pendingExtractionId: null,
    },
  });
  if (updated.count === 0) return;

  await ensureScrapedProfileLink(
    tx,
    fresh.userId,
    fresh.selectedPlatform ?? extraction.platform,
    extraction.canonicalProfileUrl,
  );

  if (alreadyComplete) return;

  if (writeFollowers && followerCount != null) {
    await assignCreditTier(tx, fresh.userId, followerCount, fresh.selectedPlatform);
    await tx.shortListedCreator.updateMany({
      where: { userId: fresh.userId, campaignId: fresh.campaignId },
      data: { followerCount },
    });
  }

  const currentName = fresh.user?.name ?? '';
  if (resultName && currentName.toLowerCase() === placeholder.toLowerCase()) {
    await tx.user.update({
      where: { id: fresh.userId },
      data: { name: resultName },
    });
  }

  await tx.guestCreatorMetricAudit.create({
    data: {
      pitchId: fresh.id,
      extractionId: extraction.id,
      guestUserId: fresh.userId,
      canonicalProfileKey: extraction.canonicalProfileKey ?? null,
      platform: fresh.selectedPlatform ?? extraction.platform ?? null,
      originalName: extraction.resultName ?? null,
      originalFollowerCount: extraction.resultFollowerCount ?? null,
      originalEngagementRate: extraction.resultEngagementRate ?? null,
      finalName: resultName || currentName || null,
      finalFollowerCount: writeFollowers ? followerCount : parseStoredFollowerCount(fresh.followerCount),
      finalEngagementRate: writeRate ? engagementRate : fresh.engagementRate ?? null,
      source: 'automatic',
      overrideReason: null,
      actorId: extraction.actorId ?? null,
      actorBuild: extraction.actorBuild ?? null,
      actorRunId: extraction.actorRunId ?? null,
      formulaVersion: extraction.formulaVersion ?? null,
      performedByUserId: extraction.requestedByUserId,
      reviewerUserId: extraction.requestedByUserId,
    },
  });
}

function parseStoredFollowerCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

async function applyFailureToPitch(
  tx: PendingPitchApplyStore,
  pitch: any,
  extraction: any,
): Promise<void> {
  const updated = await tx.pitch.updateMany({
    where: { id: pitch.id, pendingExtractionId: extraction.id },
    data: { pendingExtractionId: null },
  });
  if (updated.count === 0) return;

  await tx.guestCreatorMetricAudit.create({
    data: {
      pitchId: pitch.id,
      extractionId: extraction.id,
      guestUserId: pitch.userId,
      canonicalProfileKey: extraction.canonicalProfileKey ?? null,
      platform: pitch.selectedPlatform ?? extraction.platform ?? null,
      originalName: null,
      originalFollowerCount: null,
      originalEngagementRate: null,
      finalName: pitch.user?.name ?? null,
      finalFollowerCount: null,
      finalEngagementRate: null,
      source: 'unavailable',
      overrideReason: extraction.failureCode
        ? `No metric available: ${extraction.failureCode}.`
        : 'The fetch finished without a usable result.',
      actorId: extraction.actorId ?? null,
      actorBuild: extraction.actorBuild ?? null,
      actorRunId: extraction.actorRunId ?? null,
      formulaVersion: extraction.formulaVersion ?? null,
      performedByUserId: extraction.requestedByUserId,
      reviewerUserId: extraction.requestedByUserId,
    },
  });
}

export async function applyExtractionToPendingPitches(
  extractionId: string,
  store: PendingPitchApplyStore,
): Promise<boolean> {
  const extraction = await store.guestProfileExtraction.findUnique({ where: { id: extractionId } });
  if (!extraction) return false;

  const pitches = await store.pitch.findMany({
    where: { pendingExtractionId: extractionId },
    include: { user: true },
  });
  if (pitches.length === 0) return false;

  if (extraction.status === 'READY') {
    await store.$transaction(async (tx) => {
      if (typeof extraction.receiptNonce === 'string' && extraction.receiptNonce.length > 0) {
        try {
          await claimReceiptNonce(tx, {
            extractionId,
            nonce: extraction.receiptNonce,
            profileLabel: extraction.canonicalProfileUrl ?? extractionId,
          });
        } catch (error) {
          if (!(error instanceof ReceiptAlreadyUsedError)) throw error;
        }
      }

      for (const pitch of pitches) {
        // eslint-disable-next-line no-await-in-loop
        await applyReadyToPitch(tx, pitch, extraction);
      }
    });
    return true;
  }

  if ((PENDING_FAILURE_STATUSES as readonly string[]).includes(extraction.status)) {
    await store.$transaction(async (tx) => {
      for (const pitch of pitches) {
        // eslint-disable-next-line no-await-in-loop
        await applyFailureToPitch(tx, pitch, extraction);
      }
    });
    return true;
  }

  return false;
}

/** Prisma Client was generated before Pitch.pendingExtractionId existed. */
export function isStalePendingExtractionClient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unknown argument `pendingExtractionId`');
}

/**
 * Apply metrics without failing a stale Prisma client.
 *
 * The scrape itself has already finished. A worker generated before
 * `pendingExtractionId` existed must not fail the job. Any other apply error
 * is rethrown so the caller can log it. GET handlers and the worker catch
 * that throw so the scrape result and the HTTP response still return.
 */
export async function applyExtractionToPendingPitchesSafe(
  extractionId: string,
  store: PendingPitchApplyStore,
  log?: (message: string, context?: Record<string, unknown>) => void,
): Promise<boolean> {
  try {
    return await applyExtractionToPendingPitches(extractionId, store);
  } catch (error) {
    if (isStalePendingExtractionClient(error)) {
      log?.('pending pitch apply skipped: Prisma client is missing pendingExtractionId', {
        extractionId,
      });
      return false;
    }
    log?.('pending pitch apply failed', {
      extractionId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
