import { Prisma } from '@prisma/client';
import { normalizeProfileUrl } from './guestProfileExtraction/profileUrlNormalizer';

export const metricNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function discoveryProfileUpdate(audit: any, extraction?: any) {
  if (
    !audit.guestUserId ||
    !['instagram', 'tiktok'].includes(audit.platform) ||
    (metricNumber(audit.finalFollowerCount) == null &&
      metricNumber(audit.finalEngagementRate) == null &&
      extraction?.status !== 'READY')
  ) {
    return null;
  }
  const platform = audit.platform as 'instagram' | 'tiktok';
  const handle = audit.canonicalProfileKey?.startsWith(`${platform}:`)
    ? audit.canonicalProfileKey.slice(platform.length + 1)
    : null;
  const profileUrl = handle
    ? platform === 'instagram'
      ? `https://www.instagram.com/${handle}`
      : `https://www.tiktok.com/@${handle}`
    : null;
  const scrapeDetails =
    extraction?.status === 'READY'
      ? {
          profileUrl: extraction.canonicalProfileUrl ?? profileUrl,
          biography: extraction.resultBiography ?? null,
          profileActorRunId: extraction.profileActorRunId ?? null,
          profileActorDatasetId: extraction.profileActorDatasetId ?? null,
          followers: metricNumber(extraction.resultFollowerCount),
          engagementRate: metricNumber(extraction.resultEngagementRate),
          selectedPosts: Array.isArray(extraction.selectedPosts) ? extraction.selectedPosts : [],
          candidatePosts: Array.isArray(extraction.candidatePosts) ? extraction.candidatePosts : [],
          sampleSize: extraction.sampleSize ?? null,
          formulaVersion: extraction.formulaVersion ?? audit.formulaVersion ?? null,
          actorId: extraction.actorId ?? audit.actorId ?? null,
          actorBuild: extraction.actorBuild ?? audit.actorBuild ?? null,
          actorRunId: extraction.actorRunId ?? audit.actorRunId ?? null,
          actorDatasetId: extraction.actorDatasetId ?? null,
          unverifiedFlags: extraction.unverifiedFlags ?? [],
          scrapedAt: (extraction.completedAt ?? audit.createdAt).toISOString(),
        }
      : undefined;
  return {
    userId: audit.guestUserId as string,
    platform,
    profileUrl,
    handle,
    followers: metricNumber(audit.finalFollowerCount),
    engagementRate: metricNumber(audit.finalEngagementRate),
    source: audit.source === 'unavailable' ? 'manual_override' : audit.source,
    savedAt: audit.createdAt as Date,
    scrapeDetails,
  };
}

/** Called only after an audited Master List save, within the same transaction. */
export async function saveDiscoveryProfile(tx: any, audit: any, extraction?: any, fallbackOnly = false) {
  const update = discoveryProfileUpdate(audit, extraction);
  if (!update) return;
  const { userId, platform, savedAt, followers, engagementRate, source, scrapeDetails } = update;
  const creator = await tx.creator.findUnique({
    where: { userId },
    select: {
      profileLink: true,
      instagramProfileLink: true,
      tiktokProfileLink: true,
    },
  });
  if (!creator) return;
  const link = creator[`${platform}ProfileLink`] ?? creator.profileLink;
  const normalized = normalizeProfileUrl(link ?? '');
  const profileUrl =
    update.profileUrl ??
    (normalized.ok && normalized.profile.platform === platform ? normalized.profile.canonicalUrl : null);
  const handle =
    update.handle ?? (normalized.ok && normalized.profile.platform === platform ? normalized.profile.username : null);
  const where = { userId_platform: { userId, platform } };
  // Conditional writes also make the backfill safe to repeat while saves continue.
  await tx.creatorDiscoveryProfile.upsert({
    where,
    // createdAt = the first save, so a backfill keeps the historical date and not the run date.
    create: { userId, platform, savedAt, createdAt: savedAt, profileUrl, handle },
    update: {},
  });
  if (!fallbackOnly)
    await tx.creatorDiscoveryProfile.updateMany({
      where: { userId, platform, savedAt: { lte: savedAt } },
      data: { savedAt, ...(profileUrl ? { profileUrl, handle } : {}) },
    });
  for (const [field, value] of [
    ['followers', followers],
    ['engagementRate', engagementRate],
  ] as const) {
    if (value == null) continue;
    await tx.creatorDiscoveryProfile.updateMany({
      where: {
        userId,
        platform,
        OR: [{ [`${field}SavedAt`]: null }, ...(fallbackOnly ? [] : [{ [`${field}SavedAt`]: { lt: savedAt } }])],
      },
      data: { [field]: value, [`${field}SavedAt`]: savedAt, [`${field}Source`]: source },
    });
  }
  if (scrapeDetails) {
    const scrapedAt = new Date(scrapeDetails.scrapedAt);
    await tx.creatorDiscoveryProfile.updateMany({
      where: { userId, platform, OR: [{ scrapedAt: null }, { scrapedAt: { lt: scrapedAt } }] },
      data: {
        scrapedAt,
        scrapeDetails: scrapeDetails as Prisma.InputJsonValue,
        ...(scrapeDetails.biography != null ? { biography: scrapeDetails.biography } : {}),
        captions: scrapeDetails.selectedPosts.map((post: any) => post.caption ?? '').join('\n'),
      },
    });
  }
}

export async function createDiscoveryMetricAudit(tx: any, args: any) {
  const audit = await tx.guestCreatorMetricAudit.create(args);
  const extraction = audit.extractionId
    ? await tx.guestProfileExtraction.findUnique({ where: { id: audit.extractionId } })
    : null;
  await saveDiscoveryProfile(tx, audit, extraction);
  return audit;
}

/**
 * Moves the guest's saved scrapes to the platform creator. When both have one
 * for the same platform, the newer save wins.
 */
export async function moveDiscoveryProfiles(tx: Prisma.TransactionClient, guestUserId: string, platformUserId: string) {
  const linkedAt = new Date();
  const guestProfiles = await tx.creatorDiscoveryProfile.findMany({ where: { userId: guestUserId } });
  for (const profile of guestProfiles) {
    const existing = await tx.creatorDiscoveryProfile.findUnique({
      where: { userId_platform: { userId: platformUserId, platform: profile.platform } },
    });
    // The platform creator keeps its newer scrape, but the link still counts as recently added.
    if (existing && existing.savedAt >= profile.savedAt) {
      await tx.creatorDiscoveryProfile.update({ where: { id: existing.id }, data: { linkedAt } });
      continue;
    }
    if (existing) await tx.creatorDiscoveryProfile.delete({ where: { id: existing.id } });
    await tx.creatorDiscoveryProfile.update({
      where: { id: profile.id },
      data: { userId: platformUserId, linkedAt },
    });
    console.log(`[SWAP] Moved saved ${profile.platform} scrape to platform creator`);
  }
}

/**
 * Moves the guest's bookmark rows to the platform creator. BookMarkCreator has
 * no onDelete rule, so a row left on the guest blocks the guest delete. A row
 * the platform creator already has in the same list and platform is dropped.
 */
export async function moveBookmarks(tx: Prisma.TransactionClient, guestUserId: string, platformUserId: string) {
  const guestBookmarks = await tx.bookMarkCreator.findMany({ where: { creatorUserId: guestUserId } });
  for (const bookmark of guestBookmarks) {
    const duplicate = await tx.bookMarkCreator.findUnique({
      where: {
        listId_creatorUserId_platform: {
          listId: bookmark.listId,
          creatorUserId: platformUserId,
          platform: bookmark.platform,
        },
      },
    });
    if (duplicate) {
      await tx.bookMarkCreator.delete({ where: { id: bookmark.id } });
    } else {
      await tx.bookMarkCreator.update({ where: { id: bookmark.id }, data: { creatorUserId: platformUserId } });
    }
  }
  if (guestBookmarks.length > 0) {
    console.log(`[SWAP] Moved ${guestBookmarks.length} bookmark(s) to platform creator`);
  }
}
