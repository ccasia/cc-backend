import { Prisma } from '@prisma/client';
import { clientCampaignWhere } from '@modules/client-home/client-home.service';
import { getLatestCampaignPostEngagement } from '@services/postEngagementSnapshotService';
import { prisma } from '@/src/prisma/prisma';
import { FeaturedVideoDto, FeaturedVideoPlatform, FeaturedVideoState } from './featured-video.types';

export class FeaturedVideoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Same superadmin definition as the isAdmin middleware.
const superadminWhere: Prisma.UserWhereInput[] = [
  { role: 'superadmin' },
  { admin: { mode: { in: ['god', 'advanced'] } } },
];

/** Superadmins, or admins with a CampaignAdmin row for the campaign. */
export const canManageCampaign = async (userId: string, campaignId: string): Promise<boolean> => {
  const count = await prisma.user.count({
    where: {
      id: userId,
      role: { in: ['admin', 'superadmin'] },
      status: { not: 'deleted' },
      OR: [...superadminWhere, { admin: { campaignAdmin: { some: { campaignId } } } }],
    },
  });
  return count > 0;
};

/** Campaign managers, plus clients on the campaign (same scope as the client overview). */
export const canViewCampaign = async (userId: string, campaignId: string): Promise<boolean> => {
  if (await canManageCampaign(userId, campaignId)) return true;

  const client = await prisma.client.findUnique({ where: { userId }, select: { id: true } });
  if (!client) return false;

  const count = await prisma.campaign.count({ where: { id: campaignId, ...clientCampaignWhere(userId, client.id) } });
  return count > 0;
};

const platformFromUrl = (url: string): FeaturedVideoPlatform | null => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'Instagram';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
  } catch {
    return null;
  }
  return null;
};

const toPlatform = (value: string): FeaturedVideoPlatform | null =>
  value === 'Instagram' || value === 'TikTok' ? value : null;

/**
 * The post must belong to the submission: either a stored posting URL, or a URL in the
 * submission's content (posting URLs are extracted from content in the background).
 */
const resolvePost = async (campaignId: string, submissionId: string, postUrl: string) => {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, campaignId },
    select: {
      content: true,
      submissionPostingUrls: { where: { postUrl }, select: { platform: true }, take: 1 },
    },
  });
  if (!submission) throw new FeaturedVideoError(404, 'Submission not found in this campaign');

  const stored = submission.submissionPostingUrls[0];
  const inContent = submission.content?.includes(postUrl) ?? false;
  if (!stored && !inContent) throw new FeaturedVideoError(400, 'postUrl is not a post of this submission');

  const platform = (stored && toPlatform(stored.platform)) ?? platformFromUrl(postUrl);
  if (!platform) throw new FeaturedVideoError(400, 'postUrl must be an Instagram or TikTok post');

  return platform;
};
export type FeaturedVideoTarget = { submissionId: string; postUrl: string } | { manualEntryId: string };

const stateOf = (
  target: FeaturedVideoTarget,
  row: { id: string; postUrl: string | null; platform: string } | null,
): FeaturedVideoState => ({
  id: row?.id ?? null,
  submissionId: 'submissionId' in target ? target.submissionId : null,
  manualEntryId: 'manualEntryId' in target ? target.manualEntryId : null,
  postUrl: row?.postUrl ?? ('postUrl' in target ? target.postUrl : null),
  platform: row ? toPlatform(row.platform) : null,
  featured: !!row,
});

// Explicit set, not a toggle, so repeated requests land on the same state.
export const setFeaturedVideo = async (
  campaignId: string,
  target: FeaturedVideoTarget,
  featured: boolean,
  actorId: string,
): Promise<FeaturedVideoState> => {
  const isManual = 'manualEntryId' in target;
  const where: Prisma.CampaignFeaturedVideoWhereUniqueInput = isManual
    ? { campaignId_manualEntryId: { campaignId, manualEntryId: target.manualEntryId } }
    : { campaignId_submissionId_postUrl: { campaignId, submissionId: target.submissionId, postUrl: target.postUrl } };

  if (!featured) {
    await prisma.campaignFeaturedVideo.deleteMany({
      where: isManual
        ? { campaignId, manualEntryId: target.manualEntryId }
        : { campaignId, submissionId: target.submissionId, postUrl: target.postUrl },
    });
    return stateOf(target, null);
  }

  let create: Prisma.CampaignFeaturedVideoUncheckedCreateInput;
  if (isManual) {
    const entry = await prisma.manualCreatorEntry.findFirst({
      where: { id: target.manualEntryId, campaignId },
      select: { postUrl: true, platform: true },
    });
    if (!entry) throw new FeaturedVideoError(404, 'Manual entry not found in this campaign');
    create = {
      campaignId,
      manualEntryId: target.manualEntryId,
      postUrl: entry.postUrl,
      platform: entry.platform,
      createdById: actorId,
    };
  } else {
    const platform = await resolvePost(campaignId, target.submissionId, target.postUrl);
    create = { campaignId, submissionId: target.submissionId, postUrl: target.postUrl, platform, createdById: actorId };
  }

  try {
    return stateOf(target, await prisma.campaignFeaturedVideo.upsert({ where, create, update: {} }));
  } catch (error) {
    // A concurrent request created the row first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return stateOf(target, await prisma.campaignFeaturedVideo.findUniqueOrThrow({ where }));
    }
    throw error;
  }
};

type FeaturedRow = Prisma.CampaignFeaturedVideoGetPayload<{ select: typeof featuredSelect }>;
type SubmissionFeaturedRow = FeaturedRow & { submission: NonNullable<FeaturedRow['submission']> };
type ManualFeaturedRow = FeaturedRow & { manualEntry: NonNullable<FeaturedRow['manualEntry']> };
type PostSnapshots = Awaited<ReturnType<typeof getLatestCampaignPostEngagement>>;

const featuredSelect = {
  id: true,
  submissionId: true,
  manualEntryId: true,
  postUrl: true,
  platform: true,
  createdAt: true,
  submission: {
    select: {
      user: { select: { name: true, photoURL: true } },
      submissionPostingUrls: {
        select: { postUrl: true, shortCode: true, mediaId: true, postingDate: true, thumbnailUrl: true },
      },
      // Latest playable upload, same filter as Video of the Month. Link-only and photo submissions have none.
      video: {
        where: { url: { not: null }, status: { not: 'REJECTED' } },
        orderBy: { createdAt: 'desc' },
        select: { url: true },
        take: 1,
      },
    },
  },
  manualEntry: {
    select: {
      creatorName: true,
      photoUrl: true,
      postUrl: true,
      views: true,
      likes: true,
      engagementRate: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CampaignFeaturedVideoSelect;

const fromSubmission = (item: SubmissionFeaturedRow, snapshots: PostSnapshots): FeaturedVideoDto => {
  const postUrl = item.postUrl ?? '';
  // A content URL can differ from the stored (normalized) one, so also match on short code or media id.
  const posting =
    item.submission.submissionPostingUrls.find((row) => row.postUrl === postUrl) ??
    item.submission.submissionPostingUrls.find((row) =>
      [row.shortCode, row.mediaId].some((value) => !!value && postUrl.includes(value)),
    );
  const urls = new Set([postUrl, posting?.postUrl].filter(Boolean));
  const snapshot = snapshots.find((s) => s.submissionId === item.submissionId && urls.has(s.postUrl));

  return {
    id: item.id,
    source: 'submission',
    submissionId: item.submissionId,
    manualEntryId: null,
    postUrl,
    platform: toPlatform(item.platform) ?? 'Instagram',
    thumbnailUrl: snapshot?.thumbnailUrl ?? posting?.thumbnailUrl ?? null,
    views: snapshot?.views ?? null,
    likes: snapshot?.likes ?? null,
    engagementRate: snapshot ? +snapshot.engagementRate.toFixed(2) : null,
    postedAt: snapshot?.postDate ?? posting?.postingDate ?? null,
    statsCapturedAt: snapshot?.capturedAt ?? null,
    featuredAt: item.createdAt,
    creator: { name: item.submission.user.name, photoURL: item.submission.user.photoURL },
    videoUrl: item.submission.video[0]?.url ?? null,
  };
};

// Manual entries carry their own admin-typed stats and no media.
const fromManualEntry = (item: ManualFeaturedRow): FeaturedVideoDto => ({
  id: item.id,
  source: 'manual',
  submissionId: null,
  manualEntryId: item.manualEntryId,
  postUrl: item.manualEntry.postUrl ?? item.postUrl,
  platform: toPlatform(item.platform) ?? 'Instagram',
  thumbnailUrl: null,
  views: item.manualEntry.views,
  likes: item.manualEntry.likes,
  engagementRate: +item.manualEntry.engagementRate.toFixed(2),
  postedAt: null,
  statsCapturedAt: item.manualEntry.updatedAt,
  featuredAt: item.createdAt,
  creator: { name: item.manualEntry.creatorName, photoURL: item.manualEntry.photoUrl },
  videoUrl: null,
});

/** Featured videos with their newest stored stats, most viewed first. Never triggers a scrape. */
export const listFeaturedVideos = async (campaignId: string): Promise<FeaturedVideoDto[]> => {
  const featured = await prisma.campaignFeaturedVideo.findMany({ where: { campaignId }, select: featuredSelect });
  if (!featured.length) return [];

  const needsSnapshots = featured.some((item) => item.submission);
  const snapshots = needsSnapshots ? await getLatestCampaignPostEngagement(campaignId) : [];

  const videos = featured.flatMap((item): FeaturedVideoDto[] => {
    if (item.submission) return [fromSubmission(item as SubmissionFeaturedRow, snapshots)];
    if (item.manualEntry) return [fromManualEntry(item as ManualFeaturedRow)];
    return [];
  });

  // Videos without stats go last; ties keep the order they were featured in.
  return videos.sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.featuredAt.getTime() - b.featuredAt.getTime());
};
