import dayjs from 'dayjs';
import { Prisma, SocialPlatform } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { uploadAgreementForm } from '@configs/cloudStorage.config';
import { clients, getIo } from '@configs/socket';
import { notificationSignature } from '@helper/notification';
import { saveNotification } from '@controllers/notificationController';
import { logAdminChange, logChange } from '@services/campaignServices';
import {
  buildAgreementFollowerSnapshot,
  resolveAgreementFollowerCount,
  ResolvedAgreementFollowerCount,
} from '@utils/agreementFollowerUtils';
import {
  AgreementActor,
  AgreementError,
  BulkAgreementCreatorInput,
  BulkAgreementResult,
  SendAgreementInput,
  UpdateAgreementAmountInput,
} from './agreement.types';

// Returns undefined for an unknown/absent platform. Never guess a platform here:
// a missing value must fall back to a stored snapshot, not silently become Instagram.
export const normalizePlatform = (platform?: string | null): SocialPlatform | undefined => {
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'instagram') return 'instagram';
  return undefined;
};

// Picks the first platform that was actually recorded, in order of authority:
// what the admin just submitted, then the campaign snapshot, then the pitch.
export const resolvePlatform = (...candidates: (string | null | undefined)[]): SocialPlatform =>
  candidates.reduce<SocialPlatform | undefined>((found, c) => found ?? normalizePlatform(c), undefined) ?? 'instagram';

interface ResolveAgreementSnapshotInput {
  actorRole?: string | null;
  requestedPlatform?: string | null;
  requestedFollowerCount?: unknown;
  shortlist?: { selectedPlatform?: string | null; followerCount?: unknown } | null;
  pitch?: { selectedPlatform?: string | null; followerCount?: unknown } | null;
  creator?: Parameters<typeof resolveAgreementFollowerCount>[0]['creator'];
}

// Settles which platform and follower count an agreement is priced on, plus the follower data to
// mirror onto ShortListedCreator and Pitch. Shared by the draft (update amount) and send flows.
export const resolveAgreementSnapshot = ({
  actorRole,
  requestedPlatform,
  requestedFollowerCount,
  shortlist,
  pitch,
  creator,
}: ResolveAgreementSnapshotInput) => {
  // Keep the platform the campaign already agreed on when the request omits one, otherwise a
  // linked creator with no submitted platform silently becomes Instagram.
  const previousPlatform = shortlist?.selectedPlatform ?? pitch?.selectedPlatform ?? null;
  const normalizedPlatform = resolvePlatform(requestedPlatform, previousPlatform);
  const platformChanged = !!previousPlatform && previousPlatform !== normalizedPlatform;

  const resolvedFollower = resolveAgreementFollowerCount({
    actorRole,
    requestedFollowerCount,
    selectedPlatform: normalizedPlatform,
    shortlist,
    pitch,
    creator,
  });

  const effectiveFollowerCount = resolvedFollower.followerCount;

  const { shortlistData, pitchData } = buildAgreementFollowerSnapshot(effectiveFollowerCount, { platformChanged });

  return {
    normalizedPlatform,
    resolvedFollower,
    effectiveFollowerCount,
    shortlistFollowerData: shortlistData,
    pitchFollowerData: pitchData,
  };
};

// Keep a count the admin typed on the creator, so the next agreement already knows it.
export const persistActorFollowerCount = async ({
  userId,
  isGuest,
  platform,
  resolvedFollower,
}: {
  userId: string;
  isGuest?: boolean | null;
  platform: SocialPlatform;
  resolvedFollower: ResolvedAgreementFollowerCount;
}) => {
  if (isGuest || !resolvedFollower.isActorProvided) return;

  await prisma.creator.update({
    where: { userId },
    data:
      platform === 'instagram'
        ? { manualInstagramFollowerCount: resolvedFollower.followerCount }
        : { manualTiktokFollowerCount: resolvedFollower.followerCount },
  });
};

// Resolves the tier an admin is agreeing to. Never throws: when tier data is unavailable the
// caller proceeds without a tier (null) instead of blocking the agreement.
export const resolveAgreedTierOrNull = async (userId: string, platform: SocialPlatform, followerCount: number) => {
  const { resolveAgreedTier } = require('@services/creditTierService');

  try {
    const { tier, followerCount: resolvedFollowerCount } = await resolveAgreedTier(
      userId,
      platform,
      followerCount || null,
    );

    if (!tier) {
      console.warn(
        `Credit tier calculation failed for creator ${userId}, proceeding without tier data:`,
        resolvedFollowerCount === 0
          ? 'Creator does not have follower data. Please connect media kit or enter follower count manually.'
          : "No credit tier found for this creator's follower count.",
      );
      return null;
    }

    return tier;
  } catch (error: any) {
    console.warn(`Credit tier calculation failed for creator ${userId}, proceeding without tier data:`, error.message);
    return null;
  }
};

// Users (excluding guests) who currently have a sent agreement on this campaign.
export const getSentNonGuestUserIds = async (campaignId: string): Promise<string[]> => {
  const sentAgreements = await prisma.creatorAgreement.findMany({
    where: { campaignId, isSent: true },
    select: {
      userId: true,
      user: { select: { creator: { select: { isGuest: true } } } },
    },
  });

  return sentAgreements.filter((agreement) => !agreement.user?.creator?.isGuest).map((agreement) => agreement.userId);
};

// Sum credits committed across every sent round for a set of creators. Reads from
// CreatorAgreement.creditsAssigned (not ShortListedCreator's single cached creditPerVideo) so a
// creator with rounds on different platforms/tiers is priced correctly.
export const sumAssignedCredits = async (campaignId: string, userIds: string[]): Promise<number> => {
  if (!userIds.length) return 0;

  const aggregate = await prisma.creatorAgreement.aggregate({
    where: { campaignId, isSent: true, userId: { in: userIds } },
    _sum: { creditsAssigned: true },
  });

  return aggregate._sum.creditsAssigned ?? 0;
};

// Of the given users, those whose AGREEMENT_FORM submission has actually been approved.
const getApprovedAgreementUserIds = async (campaignId: string, userIds: string[]): Promise<string[]> => {
  if (!userIds.length) return [];

  const approved = await prisma.submission.findMany({
    where: {
      campaignId,
      userId: { in: userIds },
      status: 'APPROVED',
      submissionType: { type: 'AGREEMENT_FORM' },
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  return approved.map((submission) => submission.userId);
};

// Recomputes the campaign's credit totals from its sent agreements.
//  - onlyApproved: count only creators whose agreement has been approved, not merely sent.
//  - updateUtilized: also write creditsUtilized (V4 campaigns). Non-V4 campaigns leave it to
//    deductCredits on posting approval and only refresh the pending side.
export const recalculateCampaignCredits = async ({
  campaignId,
  campaignCredits,
  onlyApproved,
  updateUtilized,
}: {
  campaignId: string;
  campaignCredits: number | string | { toString(): string };
  onlyApproved: boolean;
  updateUtilized: boolean;
}): Promise<number> => {
  const sentUserIds = await getSentNonGuestUserIds(campaignId);
  const countedUserIds = onlyApproved ? await getApprovedAgreementUserIds(campaignId, sentUserIds) : sentUserIds;
  const totalAssigned = await sumAssignedCredits(campaignId, countedUserIds);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(updateUtilized && { creditsUtilized: totalAssigned }),
      creditsPending: Math.max(0, Number(campaignCredits) - totalAssigned),
    },
  });

  return totalAssigned;
};

const getCurrencySymbol = (currencyCode: string) => {
  switch (currencyCode) {
    case 'SGD':
    case 'AUD':
    case 'USD':
      return '$';
    case 'MYR':
      return 'RM';
    case 'JPY':
      return '¥';
    case 'IDR':
      return 'Rp';
    default:
      return 'RM'; // Default fallback
  }
};

// Saves the amount / videos / platform for a creator's agreement without sending it.
// Throws AgreementError for anything the caller should report as a failed request.
export const updateAgreementAmount = async (
  input: UpdateAgreementAmountInput,
  { adminId, req }: AgreementActor,
): Promise<void> => {
  const {
    paymentAmount,
    currency,
    user,
    campaignId,
    agreementId,
    isNew,
    credits,
    selectedPlatform,
    followerCount,
    isSeedingAgreement,
    product,
  } = input;

  // Defaults to round 1 (the original agreement) for callers that don't specify a round.
  const round: number = input.round ?? 1;

  // Fail before any write rather than half-saving a seeding agreement.
  if (isSeedingAgreement && (!product?.name || !Number.isFinite(parseFloat(String(product.value))))) {
    throw new AgreementError(400, 'Product name and value are required for a seeding agreement');
  }

  const [creator, campaign, existingAgreement] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        paymentForm: true,
        creator: {
          include: {
            instagramUser: true,
            tiktokUser: true,
          },
        },
      },
    }),
    prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
      },
    }),
    agreementId
      ? prisma.creatorAgreement.findUnique({
          where: { id: agreementId },
          include: {
            productSeeding: true,
          },
        })
      : null,
  ]);

  if (!creator) throw new AgreementError(404, 'Creator not found');
  if (!campaign) throw new AgreementError(404, 'Campaign not found');
  // A brand-new agreement (isNew) is created below, so it has no existing row yet.
  if (!existingAgreement && !isNew) throw new AgreementError(404, 'Agreement not found');

  const isCreditTierCampaign = campaign.isCreditTier;
  const isGuestCreator = creator.creator?.isGuest;

  const [currentShortlisted, currentPitch] = await Promise.all([
    prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: creator.id,
          campaignId: campaignId,
        },
      },
    }),
    prisma.pitch.findUnique({
      where: {
        userId_campaignId: {
          userId: creator.id,
          campaignId: campaignId,
        },
      },
      select: {
        selectedPlatform: true,
        followerCount: true,
      },
    }),
  ]);

  if (!currentShortlisted) throw new AgreementError(401, 'Creator is not shortlisted');

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { name: true, role: true },
  });

  // An edit that only touches the amount must not flip the creator's platform.
  const { normalizedPlatform, resolvedFollower, effectiveFollowerCount, shortlistFollowerData, pitchFollowerData } =
    resolveAgreementSnapshot({
      actorRole: admin?.role,
      requestedPlatform: selectedPlatform,
      requestedFollowerCount: followerCount,
      shortlist: currentShortlisted,
      pitch: currentPitch,
      creator: creator.creator,
    });

  const adminName = admin?.name || 'Admin';
  const creatorName = creator.name || 'Creator';

  // Determine if credits/videos are being updated
  const newVideoCount = credits !== undefined && credits !== null ? Math.floor(Number(credits)) : null;
  const oldVideoCount = currentShortlisted?.ugcVideos || 0;
  const videosChanged = newVideoCount !== null && newVideoCount !== oldVideoCount;

  // For credit tier campaigns, calculate the tier info when videos are being set
  let creditPerVideo: number | null = null;
  let tierSnapshot: any = null;

  await persistActorFollowerCount({
    userId: creator.id,
    isGuest: isGuestCreator,
    platform: normalizedPlatform,
    resolvedFollower,
  });

  if (isCreditTierCampaign && !isGuestCreator && newVideoCount !== null && newVideoCount > 0) {
    // Allow admin to proceed when tier data is unavailable — tier info will be null
    tierSnapshot = await resolveAgreedTierOrNull(creator.id, normalizedPlatform, effectiveFollowerCount);
    creditPerVideo = tierSnapshot?.creditsPerVideo ?? null;
  }

  // Update shortlisted creator with amount, currency, and optionally videos/tier info
  await prisma.shortListedCreator.updateMany({
    where: {
      userId: creator.id,
      campaignId: campaignId,
    },
    data: {
      amount: parseInt(String(paymentAmount)),
      currency: currency,
      selectedPlatform: normalizedPlatform,
      ...shortlistFollowerData,
      ...(newVideoCount !== null && { ugcVideos: newVideoCount }),
      // Update tier info for credit tier campaigns
      ...(isCreditTierCampaign &&
        creditPerVideo !== null && {
          creditPerVideo: creditPerVideo,
        }),
      ...(isCreditTierCampaign &&
        tierSnapshot && {
          creditTierId: tierSnapshot.id,
        }),
    },
  });

  await prisma.pitch.updateMany({
    where: {
      userId: creator.id,
      campaignId: campaignId,
    },
    data: {
      selectedPlatform: normalizedPlatform,
      ...pitchFollowerData,
    },
  });

  // If videos changed, also update the pitch record
  if (videosChanged && newVideoCount !== null) {
    await prisma.pitch.updateMany({
      where: {
        userId: creator.id,
        campaignId: campaignId,
      },
      data: {
        ugcCredits: newVideoCount,
        selectedPlatform: normalizedPlatform,
        ...pitchFollowerData,
      },
    });
  }

  let url = '';

  if (input.agreementFormPath) {
    // Generate and upload new agreement file
    url = await uploadAgreementForm(
      input.agreementFormPath,
      `${creator.id}-${campaign.name}-${Date.now()}.pdf`,
      'creatorAgreements',
    );
  }

  // Handle V3 agreement creation or V2 agreement update
  // Round-scoped snapshot, mirrored onto ShortListedCreator above for other consumers.
  const roundSnapshotData = {
    selectedPlatform: normalizedPlatform,
    ...(newVideoCount !== null && { videoCount: newVideoCount }),
    ...(effectiveFollowerCount > 0 && { followerCount: effectiveFollowerCount }),
    ...(isCreditTierCampaign && creditPerVideo !== null && { creditPerVideo }),
    ...(isCreditTierCampaign && tierSnapshot && { creditTierId: tierSnapshot.id }),
    ...(newVideoCount !== null && {
      creditsAssigned: isCreditTierCampaign && creditPerVideo !== null ? creditPerVideo * newVideoCount : newVideoCount,
    }),
  };

  let productSeeding: Prisma.ProductSeedingCreateNestedManyWithoutCreatorAgreementInput | undefined;
  const existingProductSeeding = existingAgreement?.productSeeding?.length ? existingAgreement.productSeeding[0] : null;

  if (isSeedingAgreement) {
    if (!existingProductSeeding) {
      productSeeding = {
        create: {
          name: product!.name,
          value: parseFloat(String(product!.value)),
        },
      };
    } else {
      await prisma.productSeeding.update({
        where: {
          id: existingProductSeeding?.id,
        },
        data: {
          name: product?.name,
          value: parseFloat(String(product?.value)),
        },
      });
    }
  } else if (!isSeedingAgreement && existingAgreement?.isSeeding) {
    await prisma.productSeeding.delete({
      where: {
        id: existingProductSeeding?.id,
      },
    });
  }

  const agreementInclude = {
    user: {
      include: {
        creator: true,
        paymentForm: true,
        shortlisted: {
          where: {
            campaignId: campaignId,
          },
        },
      },
    },
  };

  if (isNew) {
    // For V3: Get the campaign's agreement template URL if no new file was uploaded
    let finalAgreementUrl = url;

    if (!url) {
      const campaignWithTemplate = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { agreementTemplate: true },
      });
      finalAgreementUrl = campaignWithTemplate?.agreementTemplate?.url || '';
    }

    // For V3: Create or update CreatorAgreement using upsert
    await prisma.creatorAgreement.upsert({
      where: {
        userId_campaignId_round: {
          userId: creator.id,
          campaignId: campaignId,
          round,
        },
      },

      update: {
        agreementUrl: finalAgreementUrl, // Use template URL if no new file
        amount: paymentAmount as any,
        currency: currency,
        isSent: false, // Not sent yet
        ...roundSnapshotData,
        isSeeding: isSeedingAgreement,
        ...(productSeeding && { productSeeding }),
      },
      create: {
        userId: creator.id,
        campaignId: campaignId,
        round,
        agreementUrl: finalAgreementUrl, // Use template URL if no new file
        amount: paymentAmount as any,
        currency: currency,
        isSent: false, // Not sent yet
        isSeeding: isSeedingAgreement,
        ...roundSnapshotData,
        ...(productSeeding && { productSeeding }),
      },

      include: agreementInclude,
    });

    // Update pitch status to AGREEMENT_PENDING for V3
    await prisma.pitch.updateMany({
      where: {
        userId: creator.id,
        campaignId: campaignId,
        status: 'APPROVED',
      },
      data: {
        status: 'AGREEMENT_PENDING',
      },
    });
  } else {
    // For V2: Update existing CreatorAgreement
    await prisma.creatorAgreement.update({
      where: {
        id: agreementId as string,
      },
      data: {
        userId: creator.id,
        campaignId: campaignId,
        ...(url && { agreementUrl: url }), // Only update URL if new file was uploaded
        updatedAt: dayjs().format(),
        amount: paymentAmount as any,
        currency: currency,
        ...roundSnapshotData,
        isSeeding: isSeedingAgreement,
        ...(productSeeding && { productSeeding }),
      },
      include: agreementInclude,
    });
  }

  // Log admin activity for amount change if amount was actually changed (not just set for the first time)
  if (existingAgreement?.amount && existingAgreement.amount !== paymentAmount) {
    const oldAmount = existingAgreement.amount;
    const newAmount = paymentAmount;
    const oldCurrencySymbol = getCurrencySymbol(existingAgreement.currency || 'MYR');
    const newCurrencySymbol = getCurrencySymbol(currency);

    await logChange(
      `${adminName} changed the amount from ${oldCurrencySymbol}${oldAmount} to ${newCurrencySymbol}${newAmount} on the Agreement for ${creatorName}`,
      campaignId,
      req,
      adminId,
    );

    // Update invoice amount if invoice exists for this creator and campaign
    try {
      const existingInvoice = await prisma.invoice.findFirst({
        where: {
          creatorId: creator.id,
          campaignId: campaignId,
          round,
        },
      });

      if (existingInvoice) {
        // Check if invoice status allows amount changes
        if (existingInvoice.status !== 'draft') {
          throw new AgreementError(
            400,
            `Cannot change amount. Invoice ${existingInvoice.invoiceNumber} has been ${existingInvoice.status}.`,
            { invoiceStatus: existingInvoice.status, invoiceNumber: existingInvoice.invoiceNumber },
          );
        }
        await prisma.invoice.update({
          where: {
            id: existingInvoice.id,
          },
          data: {
            amount: parseFloat(String(paymentAmount)),
          },
        });
        console.log(`Updated invoice ${existingInvoice.invoiceNumber} amount from ${oldAmount} to ${newAmount}`);

        await logChange(
          `${adminName} updated invoice ${existingInvoice.invoiceNumber} amount from ${oldCurrencySymbol}${oldAmount} to ${newCurrencySymbol}${newAmount} for ${creatorName}`,
          campaignId,
          req,
          adminId,
        );
      }
    } catch (invoiceError) {
      // A locked invoice must stop the request; anything else is logged and ignored, as before.
      if (invoiceError instanceof AgreementError) throw invoiceError;
      console.error('Error updating invoice amount:', invoiceError);
    }
  }

  // Log admin activity for video count change
  if (videosChanged && newVideoCount !== null) {
    await logChange(
      `${adminName} changed UGC videos from ${oldVideoCount} to ${newVideoCount} for ${creatorName}`,
      campaignId,
      req,
      adminId,
    );
  }

  // For V4 campaigns with sent agreements, update submissions when video count changes
  const isV4Campaign = campaign.submissionVersion === 'v4';
  const agreementIsSent = existingAgreement?.isSent === true;

  if (isV4Campaign && agreementIsSent && videosChanged && newVideoCount !== null) {
    try {
      console.log(`📋 V4 agreement already sent, updating submissions for video count change`);
      const { updateV4Submissions } = require('@services/submissionV4Service');
      const result = await updateV4Submissions(creator.id, campaignId, newVideoCount);
      console.log(`✅ V4 submissions updated: ${result.deleted} deleted, ${result.created} created`);

      // Recalculate campaign credits (V4: both utilized and pending)
      if (campaign.campaignCredits != null) {
        const totalAssigned = await recalculateCampaignCredits({
          campaignId,
          campaignCredits: campaign.campaignCredits,
          onlyApproved: false,
          updateUtilized: true,
        });
        console.log(`📊 Campaign credits recalculated: assigned=${totalAssigned}`);
      }
    } catch (error) {
      console.error('Error updating V4 submissions after credits change:', error);
      // Don't fail the whole request, just log the error
    }
  }
};

const ALLOWED_PITCH_STATUSES = ['APPROVED', 'approved', 'AGREEMENT_PENDING', 'AGREEMENT_SUBMITTED'];

// Sends a previously saved agreement to the creator: checks the credit budget, marks it sent,
// creates the agreement submission, notifies the creator and logs the activity.
// Throws AgreementError for anything the caller should report as a failed request.
export const sendCreatorAgreement = async (
  input: SendAgreementInput,
  { adminId, req }: AgreementActor,
): Promise<void> => {
  const { user, agreementId, campaignId, isNew, credits, selectedPlatform, followerCount } = input;

  // Defaults to round 1 (the original agreement) for callers that don't specify a round.
  const round: number = input.round ?? 1;

  const [isUserExist, agreementActor, agreement, campaign] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        creator: {
          include: {
            instagramUser: true,
            tiktokUser: true,
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true, name: true },
    }),
    prisma.creatorAgreement.findUnique({
      where: {
        id: agreementId,
      },
    }),
    prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      select: {
        name: true,
        campaignCredits: true,
        submissionVersion: true,
        isCreditTier: true,
        campaignType: true,
        origin: true,
      },
    }),
  ]);

  if (!isUserExist) throw new AgreementError(404, 'Creator not exist');
  if (!agreement) throw new AgreementError(404, 'Agreement not found.');
  if (!campaign) throw new AgreementError(404, 'Campaign not found.');

  const shortlistInclude = {
    campaign: true,
    user: {
      include: {
        creator: true,
      },
    },
  };

  // eslint-disable-next-line prefer-const
  let [shortlistedCreator, pitchForUser] = await Promise.all([
    prisma.shortListedCreator.findUnique({
      where: {
        userId_campaignId: {
          userId: isUserExist.id,
          campaignId,
        },
      },
      include: shortlistInclude,
    }),
    prisma.pitch.findUnique({
      where: {
        userId_campaignId: {
          userId: isUserExist.id,
          campaignId,
        },
      },
    }),
  ]);

  const { normalizedPlatform, resolvedFollower, effectiveFollowerCount, shortlistFollowerData, pitchFollowerData } =
    resolveAgreementSnapshot({
      actorRole: agreementActor?.role,
      requestedPlatform: selectedPlatform,
      requestedFollowerCount: followerCount,
      shortlist: shortlistedCreator,
      pitch: pitchForUser,
      creator: isUserExist.creator,
    });

  // Pitch-only flow (e.g. external approver) can leave APPROVED pitches without a shortlist row.
  // Client approval path creates ShortListedCreator; mirror that here so the agreement can be sent.
  if (!shortlistedCreator) {
    const allowAutoShortlist = campaign.submissionVersion === 'v4' || campaign.origin === 'CLIENT';

    const pitchStatusOk = !!pitchForUser && ALLOWED_PITCH_STATUSES.includes(String(pitchForUser.status || ''));

    if (!allowAutoShortlist || !pitchStatusOk) {
      throw new AgreementError(404, 'This creator is not shortlisted.');
    }

    let creditPerVideo: number | null = null;
    let creditTierId: string | null = null;
    if (campaign.isCreditTier) {
      try {
        const { resolveAgreedTier } = require('@services/creditTierService');
        const { tier } = await resolveAgreedTier(isUserExist.id, normalizedPlatform, effectiveFollowerCount || null);
        if (tier) {
          creditPerVideo = tier.creditsPerVideo;
          creditTierId = tier.id;
        }
      } catch (tierErr) {
        console.log('resolveAgreedTier in sendAgreement shortlist backfill:', tierErr);
      }
    }

    const shortlistData: any = {
      userId: isUserExist.id,
      campaignId,
      isAgreementReady: false,
      currency: 'MYR',
      selectedPlatform: normalizedPlatform,
    };
    if (effectiveFollowerCount > 0) {
      shortlistData.followerCount = effectiveFollowerCount;
    }
    if (pitchForUser.ugcCredits != null && Number(pitchForUser.ugcCredits) > 0) {
      shortlistData.ugcVideos = pitchForUser.ugcCredits;
    }
    if (campaign.isCreditTier && creditPerVideo != null) {
      shortlistData.creditPerVideo = creditPerVideo;
      shortlistData.creditTierId = creditTierId;
    }

    try {
      shortlistedCreator = await prisma.shortListedCreator.create({
        data: shortlistData,
        include: shortlistInclude,
      });
    } catch (createErr: any) {
      if (createErr?.code === 'P2002') {
        shortlistedCreator = await prisma.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId: isUserExist.id,
              campaignId,
            },
          },
          include: shortlistInclude,
        });
      } else {
        throw createErr;
      }
    }

    if (!shortlistedCreator) throw new AgreementError(404, 'This creator is not shortlisted.');
  }

  // Defense-in-depth: don't let admin send an agreement for a creator whose pitch
  // hasn't been approved yet. Frontend already hides the button, but a stale UI or
  // direct API call should still be rejected. Pitches without a record (legacy /
  // backwards-compat shortlists) are allowed since shortlist itself is the approval.
  if (pitchForUser && !ALLOWED_PITCH_STATUSES.includes(pitchForUser.status ?? '')) {
    throw new AgreementError(
      400,
      'Cannot send agreement: this creator has not been approved yet. Awaiting client/admin approval.',
    );
  }

  const isV4Campaign = campaign.submissionVersion === 'v4';
  const isGuestCreator = shortlistedCreator.user?.creator?.isGuest;
  const isCreditTierCampaign = campaign.isCreditTier;

  let creditsToAssign: number | null = null;
  let creditPerVideo = 1; // Default for non-tier campaigns
  let tierSnapshot: any = null;
  let videoCount = 0;

  await persistActorFollowerCount({
    userId: isUserExist.id,
    isGuest: isGuestCreator,
    platform: normalizedPlatform,
    resolvedFollower,
  });

  const existingAgreementSubmission = await prisma.submission.findFirst({
    where: {
      campaignId,
      userId: isUserExist.id,
      submissionType: {
        type: 'AGREEMENT_FORM',
      },
    },
  });

  if (!existingAgreementSubmission) {
    const agreementTimeline = await prisma.campaignTimeline.findFirst({
      where: {
        campaignId,
        for: 'creator',
        submissionType: {
          type: 'AGREEMENT_FORM',
        },
      },
      include: {
        submissionType: true,
      },
    });

    if (agreementTimeline) {
      const creatorBoard = await prisma.board.findUnique({
        where: { userId: isUserExist.id },
        include: { columns: true },
      });

      const inProgressColumn = creatorBoard?.columns.find((column) => column.name.includes('In Progress'));

      await prisma.submission.create({
        data: {
          campaignId,
          userId: isUserExist.id,
          submissionTypeId: agreementTimeline.submissionTypeId as string,
          dueDate: agreementTimeline.endDate,
          status: 'IN_PROGRESS',
          contentOrder: 1, // round 1's AGREEMENT_FORM submission
          ...(isV4Campaign && { submissionVersion: 'v4' }),
          ...(inProgressColumn && {
            task: {
              create: {
                name: agreementTimeline.name,
                position: 0,
                columnId: inProgressColumn.id,
                priority: '',
                status: 'In Progress',
              },
            },
          }),
        },
      });
    }
  }

  if (!isGuestCreator) {
    videoCount = Math.floor(Number(credits ?? shortlistedCreator.ugcVideos ?? 0));

    if (!Number.isFinite(videoCount) || videoCount <= 0) {
      throw new AgreementError(400, 'Number of videos must be provided before sending this agreement.');
    }

    // Calculate credits based on campaign type
    if (isCreditTierCampaign) {
      // Credit Tier Campaign: charge from the tier the admin is agreeing to right now.
      // Deriving it from live socials instead would let a creator's media kit inflate the
      // cost above the tier the campaign was budgeted with, draining its credits.
      // Falls back to a 1:1 credit-to-video ratio when tier data is unavailable.
      const tier = await resolveAgreedTierOrNull(isUserExist.id, normalizedPlatform, effectiveFollowerCount);

      if (tier) {
        creditsToAssign = tier.creditsPerVideo * videoCount;
        creditPerVideo = tier.creditsPerVideo;
        tierSnapshot = tier;
      } else {
        creditsToAssign = videoCount;
        creditPerVideo = 1;
      }
    } else {
      // Non-tier Campaign: Use video count as credits (legacy 1:1 behavior)
      creditsToAssign = videoCount;
      creditPerVideo = 1;
    }

    if (campaign.campaignCredits != null) {
      // Credits committed by other (non-guest) creators, summed across every sent agreement round.
      const sentNonGuestUserIdsBefore = await getSentNonGuestUserIds(campaignId);
      const otherUserIds = sentNonGuestUserIdsBefore.filter((id) => id !== isUserExist.id);
      const creditsUsedBefore = await sumAssignedCredits(campaignId, otherUserIds);

      const remainingCredits = Number(campaign.campaignCredits) - creditsUsedBefore;

      if (creditsToAssign !== null && creditsToAssign > remainingCredits) {
        throw new AgreementError(
          400,
          `Not enough credits available. Remaining: ${remainingCredits}, required: ${creditsToAssign}`,
          // Add breakdown for tier campaigns
          isCreditTierCampaign
            ? {
                breakdown: {
                  videosRequested: videoCount,
                  creditPerVideo: creditPerVideo,
                  totalCredits: creditsToAssign,
                  tierName: tierSnapshot?.name,
                },
              }
            : undefined,
        );
      }
    }
  }

  // Round-scoped snapshot, mirrored onto ShortListedCreator below for other consumers.
  const roundSnapshotData = {
    selectedPlatform: normalizedPlatform,
    ...(videoCount > 0 && { videoCount }),
    ...(effectiveFollowerCount > 0 && { followerCount: effectiveFollowerCount }),
    ...(isCreditTierCampaign &&
      tierSnapshot && {
        creditPerVideo,
        creditTierId: tierSnapshot.id,
      }),
    ...(creditsToAssign !== null && { creditsAssigned: creditsToAssign }),
  };

  await prisma.creatorAgreement.update({
    where: isNew
      ? {
          userId_campaignId_round: {
            userId: isUserExist.id,
            campaignId: campaignId,
            round,
          },
        }
      : {
          id: agreement.id,
        },
    data: {
      isSent: true,
      completedAt: new Date(),
      approvedByAdminId: adminId,
      ...roundSnapshotData,
    },
  });

  // Update ShortListedCreator with video count and tier snapshot (for tier campaigns)
  await prisma.shortListedCreator.update({
    where: {
      id: shortlistedCreator.id,
    },
    data: {
      isAgreementReady: true,
      selectedPlatform: normalizedPlatform,
      ...shortlistFollowerData,

      ...(videoCount > 0 && { ugcVideos: videoCount }),

      ...(isCreditTierCampaign &&
        tierSnapshot && {
          creditPerVideo: creditPerVideo,
          creditTierId: tierSnapshot.id,
        }),
    },
  });

  shortlistedCreator.isAgreementReady = true;

  if (videoCount > 0) {
    shortlistedCreator.ugcVideos = videoCount;
    await prisma.pitch.updateMany({
      where: {
        userId: isUserExist.id,
        campaignId,
      },
      data: {
        ugcCredits: videoCount, // Store video count in pitch as well
        selectedPlatform: normalizedPlatform,
        ...pitchFollowerData,
      },
    });
  }

  await prisma.pitch.updateMany({
    where: {
      userId: isUserExist.id,
      campaignId,
    },
    data: {
      outreachStatus: 'CONFIRMED',
      outreachUpdatedAt: new Date(),
      outreachUpdatedBy: adminId,
    },
  });

  // Real-time SWR refresh for pitch lists (usePitchSocket listens for this)
  if (getIo()) {
    const pitchForSocket = await prisma.pitch.findFirst({
      where: { userId: isUserExist.id, campaignId },
      select: {
        id: true,
        outreachStatus: true,
        outreachUpdatedAt: true,
        outreachUpdatedBy: true,
      },
    });
    if (pitchForSocket) {
      getIo().to(campaignId).emit('v3:pitch:outreach-updated', {
        pitchId: pitchForSocket.id,
        campaignId,
        outreachStatus: pitchForSocket.outreachStatus,
        outreachUpdatedAt: pitchForSocket.outreachUpdatedAt,
        outreachUpdatedBy: pitchForSocket.outreachUpdatedBy,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (campaign.campaignCredits != null) {
    // Only count creators whose agreement has actually been approved (AGREEMENT_FORM
    // submission status === APPROVED) - not merely sent - for dashboard credit math.
    // Non-v4: creditsUtilized is still only incremented by deductCredits on posting
    // approval - only the "assigned" (pending) side is gated on agreement approval here.
    await recalculateCampaignCredits({
      campaignId,
      campaignCredits: campaign.campaignCredits,
      onlyApproved: true,
      updateUtilized: isV4Campaign,
    });
  }

  if (isV4Campaign && !isGuestCreator) {
    try {
      // Use updateV4Submissions which handles both initial creation and updates
      // It deletes existing VIDEO submissions and creates new ones based on current credits
      const { updateV4Submissions } = require('@services/submissionV4Service');
      const result = await updateV4Submissions(isUserExist.id, campaignId, shortlistedCreator.ugcVideos || 0);
      console.log(`✅ V4 submissions updated: ${result.deleted} deleted, ${result.created} created`);
    } catch (error) {
      console.error('Error creating V4 content submissions after agreement send:', error);
      throw new AgreementError(500, 'Agreement sent but failed to initialize V4 submissions. Please try again.');
    }
  }

  const adminName = agreementActor?.name || 'Admin';
  const creatorName = isUserExist.name || 'Creator';

  await logChange(`${adminName} sent the Agreement to ${creatorName}`, campaignId, req, adminId);

  if (adminId) {
    logAdminChange(`Sent Agreement  to ${creatorName} in campaign - ${campaign.name} `, adminId, req);
  }

  const { title, message } = notificationSignature(campaign.name);

  const notification = await saveNotification({
    userId: isUserExist.id,
    title: title,
    message: message,
    entity: 'Agreement',
    entityId: campaignId,
  });

  const agreementSubmission = await prisma.submission.findFirst({
    where: {
      submissionType: {
        type: 'AGREEMENT_FORM',
      },
      campaignId: agreement.campaignId,
      userId: agreement.userId,
    },
    select: { id: true },
  });

  getIo()
    .to(isUserExist.id)
    .emit(
      'notification',
      notificationSignature(campaign.name, {
        campaignId: agreement.campaignId,
        submissionId: agreementSubmission?.id,
      }),
    );

  const socketId = clients.get(isUserExist.id);

  if (socketId) {
    getIo().to(socketId).emit('notification', notification);
    getIo().to(socketId).emit('agreementReady');
  }

  await prisma.campaignLog.create({
    data: {
      message: `Agreement has been sent to ${isUserExist.name || 'Creator'}`,
      adminId: adminId,
      campaignId: campaignId,
    },
  });
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// One creator's agreement, done the same way as the single-creator flow: save the amount
// (updateAgreementAmount), then send it (sendCreatorAgreement). If saving fails nothing is sent.
// Never throws, so one creator's failure cannot stop the rest of a batch.
export const processCreatorAgreement = async (
  campaignId: string,
  creator: BulkAgreementCreatorInput,
  actor: AgreementActor,
): Promise<BulkAgreementResult> => {
  const { userId } = creator;
  const round = creator.round ?? 1;

  try {
    const findAgreementId = async () =>
      (
        await prisma.creatorAgreement.findUnique({
          where: { userId_campaignId_round: { userId, campaignId, round } },
          select: { id: true },
        })
      )?.id;

    // The single-creator endpoints are handed the draft agreement's id; resolve it here if it's missing.
    let agreementId = creator.agreementId ?? (await findAgreementId());

    if (!agreementId && !creator.isNew) throw new AgreementError(404, 'Agreement not found');

    await updateAgreementAmount(
      {
        user: { id: userId },
        campaignId,
        agreementId,
        round,
        isNew: creator.isNew,
        paymentAmount: creator.paymentAmount,
        currency: creator.currency,
        credits: creator.credits,
        selectedPlatform: creator.selectedPlatform,
        followerCount: creator.followerCount,
        isSeedingAgreement: creator.isSeedingAgreement,
        product: creator.product,
        agreementFormPath: creator.agreementFormPath,
      },
      actor,
    );

    try {
      // A new agreement only gets its id once the update above has created it.
      agreementId = agreementId ?? (await findAgreementId());
      if (!agreementId) throw new AgreementError(404, 'Agreement not found');

      await sendCreatorAgreement(
        {
          user: { id: userId },
          campaignId,
          agreementId,
          round,
          isNew: creator.isNew,
          credits: creator.credits,
          selectedPlatform: creator.selectedPlatform,
          followerCount: creator.followerCount,
        },
        actor,
      );
    } catch (error) {
      if (!(error instanceof AgreementError)) console.error(`Bulk agreement: send failed for ${userId}:`, error);
      return { userId, success: false, failedStep: 'send', message: errorMessage(error) };
    }

    return { userId, success: true };
  } catch (error) {
    if (!(error instanceof AgreementError)) console.error(`Bulk agreement: update failed for ${userId}:`, error);
    return { userId, success: false, failedStep: 'update', message: errorMessage(error) };
  }
};

// Runs the save-then-send flow for each creator, one at a time. Sequential on purpose: every send
// checks the campaign's remaining credits against what earlier sends already committed, so running
// creators in parallel could overspend the budget.
export const bulkSendAgreements = async (
  campaignId: string,
  creators: BulkAgreementCreatorInput[],
  actor: AgreementActor,
): Promise<BulkAgreementResult[]> => {
  const results: BulkAgreementResult[] = [];

  for (const creator of creators) {
    results.push(await processCreatorAgreement(campaignId, creator, actor));
  }

  return results;
};
