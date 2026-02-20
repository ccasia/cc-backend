import { PrismaClient } from '@prisma/client';
import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMediaObject,
  getInstagramOverviewService,
  getInstagramUserInsight,
  getTikTokMediaObject,
} from '@services/socialMediaService';
import axios from 'axios';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

type TopVideosByCreator = Map<string, any[]>;

type PlatformFilter = 'all' | 'instagram' | 'tiktok';

export interface DiscoveryQueryInput {
  search?: string;
  platform?: PlatformFilter;
  page?: number;
  limit?: number;
  hydrateMissing?: boolean;
}

const normalizePagination = (page = 1, limit = 20) => {
  const safePage = Number.isNaN(page) || page < 1 ? 1 : page;
  const safeLimit = Number.isNaN(limit) || limit < 1 ? 20 : Math.min(limit, 100);

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

const normalizePlatform = (platform?: string): PlatformFilter => {
  if (platform === 'instagram' || platform === 'tiktok') {
    return platform;
  }

  return 'all';
};

const buildConnectedWhere = (search: string, platform: PlatformFilter) => {
  const searchOr = search
    ? [
        { name: { contains: search, mode: 'insensitive' as const } },
        { creator: { is: { instagram: { contains: search, mode: 'insensitive' as const } } } },
        { creator: { is: { tiktok: { contains: search, mode: 'insensitive' as const } } } },
        { creator: { is: { mediaKit: { about: { contains: search, mode: 'insensitive' as const } } } } },
      ]
    : undefined;

  const instagramConnected = {
    creator: {
      is: {
        isFacebookConnected: true,
        instagramUser: {
          isNot: null,
        },
      },
    },
  };

  const tiktokConnected = {
    creator: {
      is: {
        isTiktokConnected: true,
        tiktokUser: {
          isNot: null,
        },
      },
    },
  };

  const platformCondition =
    platform === 'instagram'
      ? instagramConnected
      : platform === 'tiktok'
        ? tiktokConnected
        : { OR: [instagramConnected, tiktokConnected] };

  return {
    role: 'creator',
    creator: {
      is: {},
    },
    ...(searchOr ? { OR: searchOr } : {}),
    ...platformCondition,
  } as any;
};

const buildConnectedSelect = (includeAccessToken = false) => ({
  id: true,
  name: true,
  creator: {
    select: {
      id: true,
      instagram: true,
      tiktok: true,
      industries: true,
      isFacebookConnected: true,
      isTiktokConnected: true,
      ...(includeAccessToken
        ? {
            tiktokData: true,
          }
        : {}),
      mediaKit: {
        select: {
          about: true,
        },
      },
      instagramUser: {
        select: {
          followers_count: true,
          engagement_rate: true,
          profile_picture_url: true,
          biography: true,
          totalLikes: true,
          totalSaves: true,
          totalShares: true,
          insightData: true,
          averageLikes: true,
          averageSaves: true,
          averageShares: true,
          user_id: true,
          media_count: true,
          ...(includeAccessToken
            ? {
                accessToken: true,
              }
            : {}),
          instagramVideo: {
            select: {
              id: true,
              media_url: true,
              thumbnail_url: true,
              caption: true,
              permalink: true,
              like_count: true,
              comments_count: true,
              datePosted: true,
            },
            orderBy: {
              datePosted: 'desc' as const,
            },
            take: 3,
          },
        },
      },
      tiktokUser: {
        select: {
          username: true,
          display_name: true,
          avatar_url: true,
          biography: true,
          following_count: true,
          likes_count: true,
          follower_count: true,
          engagement_rate: true,
          totalLikes: true,
          totalComments: true,
          totalShares: true,
          averageLikes: true,
          averageComments: true,
          averageShares: true,
          lastUpdated: true,
          tiktokVideo: {
            select: {
              video_id: true,
              id: true,
              cover_image_url: true,
              title: true,
              embed_link: true,
              like_count: true,
              comment_count: true,
              share_count: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: 'desc' as const,
            },
            take: 3,
          },
        },
      },
    },
  },
});

const hydrateMissingInstagramData = async (rows: any[]): Promise<TopVideosByCreator> => {
  const topVideosByCreator: TopVideosByCreator = new Map();

  const candidates = rows.filter((row) => {
    const creator = row?.creator;
    const instagramUser = creator?.instagramUser;

    if (!creator?.isFacebookConnected || !instagramUser) {
      return false;
    }

    return !instagramUser?.insightData || !instagramUser?.profile_picture_url || instagramUser?.totalShares == null;
  });

  if (candidates.length === 0) {
    return topVideosByCreator;
  }

  const limitedCandidates = candidates.slice(0, 5);

  await Promise.allSettled(
    limitedCandidates.map(async (row) => {
      try {
        const creatorId = row?.creator?.id;
        const instagramUser = row?.creator?.instagramUser;
        const encryptedAccessToken = instagramUser?.accessToken;

        if (!creatorId || !encryptedAccessToken) {
          return;
        }

        const accessToken = decryptToken(encryptedAccessToken as any);
        const overview = await getInstagramOverviewService(accessToken);
        const insight = await getInstagramUserInsight(accessToken, overview.user_id || instagramUser.user_id);
        const medias = await getInstagramMediaObject(accessToken, overview.user_id || instagramUser.user_id);

        const mediaCount = overview.media_count || instagramUser.media_count || 0;
        const averageShares = mediaCount ? (insight.totals.shares || 0) / mediaCount : 0;
        const averageSaves = mediaCount ? (insight.totals.saves || 0) / mediaCount : 0;

        const instagramViews = insight.totals.reach || 0;
        const instagramInteractions =
          (insight.totals.likes || 0) +
          (insight.totals.comments || 0) +
          (insight.totals.shares || 0) +
          (insight.totals.saves || 0);

        const engagementRate = instagramViews ? (instagramInteractions / instagramViews) * 100 : 0;

        await prismaAny.instagramUser.update({
          where: { creatorId },
          data: {
            user_id: overview.user_id,
            profile_picture_url: overview.profile_picture_url,
            biography: overview.biography,
            followers_count: overview.followers_count,
            follows_count: overview.follows_count,
            media_count: overview.media_count,
            username: overview.username,
            totalLikes: medias.totalLikes || 0,
            totalComments: medias.totalComments || 0,
            totalShares: insight.totals.shares || 0,
            totalSaves: insight.totals.saves || 0,
            averageLikes: medias.averageLikes || 0,
            averageComments: medias.averageComments || 0,
            averageShares,
            averageSaves,
            engagement_rate: engagementRate,
            insightData: {
              since: insight.since,
              until: insight.until,
              totals: insight.totals,
              raw: insight.raw,
            },
          },
        });

        const topVideos = (medias.sortedVideos || []).map((media: any) => ({
          id: media.id,
          media_url: media.media_url,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
          like_count: media.like_count,
          comments_count: media.comments_count,
          datePosted: media.timestamp ? new Date(media.timestamp) : null,
        }));

        topVideosByCreator.set(creatorId, topVideos);
      } catch (error) {
        console.error('Discovery hydrate failed for creator:', row?.creator?.id, error);
      }
    }),
  );

  return topVideosByCreator;
};

const hydrateMissingTikTokData = async (rows: any[]): Promise<TopVideosByCreator> => {
  const topVideosByCreator: TopVideosByCreator = new Map();

  const candidates = rows.filter((row) => {
    const creator = row?.creator;
    const tiktokUser = creator?.tiktokUser;

    if (!creator?.isTiktokConnected || !tiktokUser) {
      return false;
    }

    return (
      !tiktokUser?.follower_count ||
      tiktokUser?.totalShares == null ||
      !Array.isArray(tiktokUser?.tiktokVideo) ||
      tiktokUser.tiktokVideo.length === 0
    );
  });

  if (candidates.length === 0) {
    return topVideosByCreator;
  }

  const limitedCandidates = candidates.slice(0, 5);

  await Promise.allSettled(
    limitedCandidates.map(async (row) => {
      try {
        const creator = row?.creator;
        const creatorId = creator?.id;
        const encryptedAccessToken = creator?.tiktokData?.access_token;

        if (!creatorId || !encryptedAccessToken) {
          return;
        }

        const accessToken = decryptToken(encryptedAccessToken as any);

        const overviewRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
          params: {
            fields:
              'open_id,union_id,display_name,bio_description,username,avatar_url,following_count,follower_count,likes_count',
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const overview = overviewRes?.data?.data?.user || {};
        const mediaObject = await getTikTokMediaObject(accessToken, 20);

        const topFiveVideos = mediaObject.sortedVideos;

        const totalLikes = mediaObject.totalLikes;
        const totalComments = mediaObject.totalComments;
        const totalShares = mediaObject.totalShares;
        const totalViews = mediaObject.totalViews;

        const averageLikes = mediaObject.averageLikes;
        const averageComments = mediaObject.averageComments;
        const averageShares = mediaObject.averageShares;

        const engagementRate = totalViews ? ((totalLikes + totalComments + totalShares) / totalViews) * 100 : 0;

        await prismaAny.tiktokUser.upsert({
          where: { creatorId },
          update: {
            display_name: overview.display_name,
            username: overview.username,
            avatar_url: overview.avatar_url,
            biography: overview.bio_description,
            following_count: overview.following_count,
            follower_count: overview.follower_count,
            likes_count: overview.likes_count,
            totalLikes,
            totalComments,
            totalShares,
            averageLikes,
            averageComments,
            averageShares,
            engagement_rate: engagementRate,
            lastUpdated: new Date(),
          },
          create: {
            creatorId,
            display_name: overview.display_name,
            username: overview.username,
            avatar_url: overview.avatar_url,
            biography: overview.bio_description,
            following_count: overview.following_count,
            follower_count: overview.follower_count,
            likes_count: overview.likes_count,
            totalLikes,
            totalComments,
            totalShares,
            averageLikes,
            averageComments,
            averageShares,
            engagement_rate: engagementRate,
            lastUpdated: new Date(),
          },
        });

        const topVideos = (topFiveVideos || []).map((video: any) => ({
          video_id: video.id,
          cover_image_url: video.cover_image_url,
          title: video.title,
          embed_link: video.embed_link,
          like_count: video.like_count || 0,
          comment_count: video.comment_count || 0,
          share_count: video.share_count || 0,
          createdAt: video.create_time ? new Date(video.create_time * 1000) : null,
        }));

        topVideosByCreator.set(creatorId, topVideos);

        await prismaAny.creator.update({
          where: {
            id: creatorId,
          },
          data: {
            tiktok: overview.username || creator?.tiktok || null,
          },
        });
      } catch (error) {
        console.error('Discovery TikTok hydrate failed for creator:', row?.creator?.id, error);
      }
    }),
  );

  return topVideosByCreator;
};

export const getDiscoveryCreators = async (input: DiscoveryQueryInput) => {
  const search = (input.search || '').trim();
  const platform = normalizePlatform(input.platform);

  const pagination = normalizePagination(input.page, input.limit);

  const connectedWhere = buildConnectedWhere(search, platform);

  const [connectedTotal, connectedRows] = await Promise.all([
    prismaAny.user.count({ where: connectedWhere }),
    prismaAny.user.findMany({
      where: connectedWhere,
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: {
        updatedAt: 'desc',
      },
      select: buildConnectedSelect(input.hydrateMissing === true),
    }),
  ]);

  let finalRows = connectedRows;
  let hydratedInstagramTopVideos: TopVideosByCreator = new Map();
  let hydratedTikTokTopVideos: TopVideosByCreator = new Map();

  if (input.hydrateMissing === true) {
    [hydratedInstagramTopVideos, hydratedTikTokTopVideos] = await Promise.all([
      hydrateMissingInstagramData(connectedRows),
      hydrateMissingTikTokData(connectedRows),
    ]);

    finalRows = await prismaAny.user.findMany({
      where: connectedWhere,
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: {
        updatedAt: 'desc',
      },
      select: buildConnectedSelect(false),
    });
  }

  const connectedCreators = finalRows.map((row: any) => {
    const creatorId = row.creator?.id;

    const instagramTopVideos = creatorId
      ? hydratedInstagramTopVideos.get(creatorId) || row.creator?.instagramUser?.instagramVideo || []
      : row.creator?.instagramUser?.instagramVideo || [];

    const tiktokTopVideos = creatorId
      ? hydratedTikTokTopVideos.get(creatorId) || row.creator?.tiktokUser?.tiktokVideo || []
      : row.creator?.tiktokUser?.tiktokVideo || [];

    return {
      type: 'connected',
      userId: row.id,
      creatorId: row.creator?.id,
      name: row.name,
      handles: {
        instagram: row.creator?.instagram || null,
        tiktok: row.creator?.tiktok || null,
      },
      interests: row.creator?.industries || null,
      about: row.creator?.mediaKit?.about || null,
      instagram: {
        connected: Boolean(row.creator?.isFacebookConnected && row.creator?.instagramUser),
        profilePictureUrl: row.creator?.instagramUser?.profile_picture_url || null,
        biography: row.creator?.instagramUser?.biography || null,
        followers: row.creator?.instagramUser?.followers_count || 0,
        engagementRate: row.creator?.instagramUser?.engagement_rate || 0,
        totalLikes: row.creator?.instagramUser?.totalLikes || 0,
        totalSaves: row.creator?.instagramUser?.totalSaves || 0,
        totalShares: row.creator?.instagramUser?.totalShares || 0,
        insightData: row.creator?.instagramUser?.insightData || null,
        averageLikes: row.creator?.instagramUser?.averageLikes || 0,
        averageSaves: row.creator?.instagramUser?.averageSaves || 0,
        averageShares: row.creator?.instagramUser?.averageShares || 0,
        topVideos: instagramTopVideos,
      },
      tiktok: {
        connected: Boolean(row.creator?.isTiktokConnected && row.creator?.tiktokUser),
        followers: row.creator?.tiktokUser?.follower_count || 0,
        engagementRate: row.creator?.tiktokUser?.engagement_rate || 0,
        averageLikes: row.creator?.tiktokUser?.averageLikes || 0,
        averageSaves: 0,
        averageShares: row.creator?.tiktokUser?.averageShares || 0,
        topVideos: tiktokTopVideos,
      },
    };
  });

  return {
    filters: {
      search,
      platform,
    },
    data: connectedCreators,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: connectedTotal,
    },
  };
};
