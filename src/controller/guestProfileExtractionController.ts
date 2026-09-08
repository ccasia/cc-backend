import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '@/src/prisma/prisma';
import { loadExtractionConfig } from '@configs/guestProfileExtractionConfig';
import { createApifyGateway } from '@services/guestProfileExtraction/apifyGateway';
import { authorizeGuestProfileAction } from '@services/guestProfileExtraction/authorizeGuestProfileAction';
import { isInternalSuperAdmin } from '@services/guestProfileExtraction/campaignCreatorPolicy';
import { decideGuestProfileMetrics, loadFeatureFlags } from '@services/guestProfileExtraction/featureDecision';
import { getReceiptSecret, issueReceipt } from '@services/guestProfileExtraction/extractionReceiptService';
import { startExtraction, type ExtractionDeps } from '@services/guestProfileExtraction/guestProfileExtractionService';
import { enqueueExtraction } from '@utils/queue';

/**
 * Endpoints for guest profile extraction.
 *
 * Every route runs the same four gates: authenticated, internal admin, the
 * server-side feature decision, and `canManageCampaignCreators`. Status and
 * receipt access add a fifth: the extraction must belong to this admin.
 */

const startSchema = z.object({
  clientRowId: z.string().min(1).max(64),
  profileLink: z.string().min(1).max(2048),
});

const idempotencyKeySchema = z.string().min(8).max(120);

function buildDeps(): ExtractionDeps {
  const config = loadExtractionConfig();
  return {
    store: prisma as never,
    gateway: createApifyGateway(config),
    config,
    enqueue: (extractionId: string) => enqueueExtraction(extractionId),
  };
}

/** The feature decision and the campaign policy, in that order. */
async function guard(req: Request, res: Response, campaignId: string): Promise<{ userId: string } | null> {
  const result = await authorizeGuestProfileAction(
    { userId: req.userId, campaignId },
    { store: prisma as never, flags: loadFeatureFlags() },
  );

  if (!result.allowed) {
    res.status(result.status).json({
      message: result.message,
      ...(result.code ? { code: result.code } : {}),
      ...(result.decision ? { decision: result.decision } : {}),
    });
    return null;
  }

  return { userId: result.userId };
}

/** POST /api/campaign/v3/:campaignId/guest-profile-extractions */
export const startGuestProfileExtraction = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  const allowed = await guard(req, res, campaignId);
  if (!allowed) return;

  const key = idempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!key.success) {
    return res.status(400).json({ message: 'An Idempotency-Key header is required.' });
  }

  const body = startSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: 'A clientRowId and a profileLink are required.' });
  }

  try {
    const outcome = await startExtraction(
      {
        campaignId,
        requesterUserId: allowed.userId,
        // The platform is derived from the link. A supplied one is ignored.
        profileLink: body.data.profileLink,
        idempotencyKey: key.data,
      },
      buildDeps(),
    );

    switch (outcome.status) {
      case 'conflict':
        return res.status(409).json({ message: outcome.message });
      case 'rejected':
        return res.status(400).json({ message: outcome.message, code: outcome.code });
      case 'ready':
        return res.status(200).json({
          clientRowId: body.data.clientRowId,
          extractionId: outcome.extraction.id,
          status: outcome.extraction.status,
        });
      default:
        return res.status(202).json({
          clientRowId: body.data.clientRowId,
          extractionId: outcome.extraction.id,
          status: outcome.extraction.status,
        });
    }
  } catch (error) {
    console.error('startGuestProfileExtraction failed:', error);
    return res.status(500).json({ message: 'The fetch could not be started.' });
  }
};

/**
 * Shape a record for the browser.
 *
 * It never returns raw provider data, a token, an actor ID, or a build.
 */
function presentExtraction(record: any, receipt: string | null) {
  return {
    extractionId: record.id,
    status: record.status,
    platform: record.platform,
    canonicalProfileUrl: record.canonicalProfileUrl,
    name: record.resultName ?? null,
    followerCount: record.resultFollowerCount ?? null,
    engagementRate: record.resultEngagementRate ?? null,
    sampleSize: record.sampleSize ?? null,
    formulaVersion: record.formulaVersion ?? null,
    selectedPosts: record.selectedPosts ?? null,
    candidatePosts: record.candidatePosts ?? null,
    unverifiedFlags: record.unverifiedFlags ?? [],
    fetchedAt: record.completedAt ?? null,
    failureCode: record.failureCode ?? null,
    failureMessage: record.failureMessage ?? null,
    completionReceipt: receipt,
  };
}

/** GET /api/campaign/v3/guest-profile-extractions/:extractionId */
export const getGuestProfileExtraction = async (req: Request, res: Response) => {
  const { extractionId } = req.params;
  const userId = req.userId;

  const record = await prisma.guestProfileExtraction.findUnique({ where: { id: extractionId } });
  if (!record) return res.status(404).json({ message: 'Result not found.' });

  // Ownership first. One admin must never see another admin's receipt, even
  // on a campaign they both manage.
  if (record.requestedByUserId !== userId) {
    return res.status(403).json({ message: 'Result not found.', code: 'NOT_OWNER' });
  }

  const allowed = await guard(req, res, record.campaignId);
  if (!allowed) return;

  let receipt: string | null = null;
  if (record.status === 'READY' && record.receiptNonce && record.receiptDigest) {
    receipt = issueReceipt(
      {
        requesterUserId: record.requestedByUserId,
        campaignId: record.campaignId,
        canonicalProfileKey: record.canonicalProfileKey,
        platform: record.platform,
        actorId: record.actorId,
        actorBuild: record.actorBuild,
        formulaVersion: record.formulaVersion ?? '',
        resultDigest: record.receiptDigest,
        extractionId: record.id,
      },
      { secret: getReceiptSecret(), nonce: record.receiptNonce },
    ).token;
  }

  return res.status(200).json(presentExtraction(record, receipt));
};

/**
 * GET /api/campaign/v3/:campaignId/guest-profile-extractions
 *
 * Refresh recovery. It returns only this admin's records on this campaign.
 */
export const listResumableExtractions = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  const allowed = await guard(req, res, campaignId);
  if (!allowed) return;

  const records = await prisma.guestProfileExtraction.findMany({
    where: {
      campaignId,
      requestedByUserId: allowed.userId,
      status: {
        in: ['QUEUED', 'RUNNING', 'POLLING', 'READY', 'INSUFFICIENT_DATA', 'FAILED', 'REQUIRES_RECONCILIATION'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      status: true,
      platform: true,
      canonicalProfileUrl: true,
      createdAt: true,
    },
  });

  return res.status(200).json({ extractions: records });
};

/** GET /api/campaign/v3/guest-profile-metrics/decision */
export const getGuestProfileMetricsDecision = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ message: 'Sign in to continue.' });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { admin: { include: { role: true } } },
  });

  const decision = decideGuestProfileMetrics(
    { userId, isSuperAdmin: user ? isInternalSuperAdmin(user) : false },
    loadFeatureFlags(),
  );

  return res.status(200).json(decision);
};
