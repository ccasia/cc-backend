import { PrismaClient } from '@prisma/client';
import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMediaObject,
  getInstagramOverviewService,
  getInstagramUserInsight,
  getTikTokMediaObject,
} from '@services/socialMediaService';
import { mapPronounsToGender } from '../utils/mapPronounsToGender';
import { calculateAge } from '../utils/calculateAge';
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
  gender?: string;
  ageRange?: string;
  country?: string;
  city?: string;
  creditTier?: string;
  interests?: string[];
  keyword?: string;
  hashtag?: string;
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

// Map frontend gender labels back to pronouns stored in DB
const genderToPronounce = (gender?: string): string | null => {
  if (!gender) return null;
  const map: Record<string, string> = {
    Male: 'He/Him',
    Female: 'She/Her',
    'Non-Binary': 'They/Them',
  };
  return map[gender] || null;
};

// Parse age range string like "18-24" into birthDate boundaries
const ageRangeToBirthDateRange = (ageRange?: string): { gte: Date; lte: Date } | null => {
  if (!ageRange) return null;
  const parts = ageRange.split('-');
  if (parts.length !== 2) return null;

  const minAge = parseInt(parts[0], 10);
  const maxAge = parseInt(parts[1], 10);
  if (Number.isNaN(minAge) || Number.isNaN(maxAge)) return null;

  const today = new Date();
  // Born at most maxAge+1 years ago (exclusive) → lte
  // Born at least minAge years ago → gte
  const latestBirth = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
  const earliestBirth = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate() + 1);

  return { gte: earliestBirth, lte: latestBirth };
};

const extractHashtags = (raw?: string): string[] => {
  if (!raw) return [];

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^#+/, '').toLowerCase())
    .filter(Boolean)
    .map((token) => `#${token}`);

  return Array.from(new Set(tokens));
};


const buildConnectedWhere = (
  search: string,
  platform: PlatformFilter,
  filters: {
    gender?: string;
    ageRange?: string;
    country?: string;
    city?: string;
    creditTier?: string;
    interests?: string[];
    keyword?: string;
    hashtag?: string;
  } = {},
) => {
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

  // ─── Additional filter conditions ─────────────────────────────────────────

  // Gender → map to pronounce field on Creator
  const pronounce = genderToPronounce(filters.gender);
  const genderCondition = pronounce
    ? { creator: { is: { pronounce: { equals: pronounce, mode: 'insensitive' as const } } } }
    : undefined;

  // Age range → birthDate between computed dates
  const birthDateRange = ageRangeToBirthDateRange(filters.ageRange);
  const ageCondition = birthDateRange
    ? { creator: { is: { birthDate: { gte: birthDateRange.gte, lte: birthDateRange.lte } } } }
    : undefined;

  // Country → on User model directly
  const countryCondition = filters.country
    ? { country: { equals: filters.country, mode: 'insensitive' as const } }
    : undefined;

  // City → on User model directly
  const cityCondition = filters.city
    ? { city: { equals: filters.city, mode: 'insensitive' as const } }
    : undefined;

  // Credit tier → filter by CreditTier.name via relation
  const creditTierCondition = filters.creditTier
    ? { creator: { is: { creditTier: { name: { equals: filters.creditTier, mode: 'insensitive' as const } } } } }
    : undefined;

  // Interests → match against Interest model (related to Creator via userId)
  const interestsCondition =
    filters.interests && filters.interests.length > 0
      ? {
          creator: {
            is: {
              interests: {
                some: {
                  name: { in: filters.interests, mode: 'insensitive' as const },
                },
              },
            },
          },
        }
      : undefined;

  // Keyword → search through instagram video captions and tiktok video titles
  const keywordCondition = filters.keyword
    ? {
        OR: [
          {
            creator: {
              is: {
                instagramUser: {
                  instagramVideo: {
                    some: { caption: { contains: filters.keyword, mode: 'insensitive' as const } },
                  },
                },
              },
            },
          },
          {
            creator: {
              is: {
                tiktokUser: {
                  tiktokVideo: {
                    some: { title: { contains: filters.keyword, mode: 'insensitive' as const } },
                  },
                },
              },
            },
          },
        ],
      }
    : undefined;

  // Hashtag → parse one or many hashtags and match in instagram captions / tiktok titles
  const hashtagTerms = extractHashtags(filters.hashtag);
  const hashtagCondition =
    hashtagTerms.length > 0
      ? {
          OR: [
            {
              creator: {
                is: {
                  instagramUser: {
                    instagramVideo: {
                      some: {
                        OR: hashtagTerms.map((tag) => ({
                          caption: { contains: tag, mode: 'insensitive' as const },
                        })),
                      },
                    },
                  },
                },
              },
            },
            {
              creator: {
                is: {
                  tiktokUser: {
                    tiktokVideo: {
                      some: {
                        OR: hashtagTerms.map((tag) => ({
                          title: { contains: tag, mode: 'insensitive' as const },
                        })),
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : undefined;

  // Collect all AND conditions (only non-undefined ones)
  const andConditions = [
    genderCondition,
    ageCondition,
    countryCondition,
    cityCondition,
    creditTierCondition,
    interestsCondition,
    keywordCondition,
    hashtagCondition,
  ].filter(Boolean);

  return {
    role: 'creator',
    creator: {
      is: {},
    },
    ...(searchOr ? { OR: searchOr } : {}),
    ...platformCondition,
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  } as any;
};

const buildConnectedSelect = (includeAccessToken = false) => ({
  id: true,
  name: true,
  city: true,
  country: true,
  creator: {
    select: {
      id: true,
      pronounce: true,
      birthDate: true,
      instagram: true,
      tiktok: true,
      industries: true,
      interests: {
        select: {
          id: true,
          name: true,
          rank: true,
        },
        orderBy: { rank: 'asc' as const },
      },
      creditTier: true,
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

  const limitedCandidates = candidates.slice(0, 20);

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

    return true;
  });

  if (candidates.length === 0) {
    return topVideosByCreator;
  }

  const limitedCandidates = candidates.slice(0, 20);

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

        const upsertedTiktokUser = await prismaAny.tiktokUser.upsert({
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

        const tiktokUserId = upsertedTiktokUser.id;

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

        // Persist fresh cover_image_url values back to the DB so subsequent requests
        // don't read stale (expired) TikTok CDN URLs.
        await Promise.allSettled(
          topVideos.map(async (video: any) => {
            if (!video.video_id) return;
            await prismaAny.tiktokVideo.upsert({
              where: { video_id: video.video_id },
              update: {
                cover_image_url: video.cover_image_url,
                title: video.title,
                embed_link: video.embed_link,
                like_count: video.like_count,
                comment_count: video.comment_count,
                share_count: video.share_count,
                createdAt: video.createdAt || undefined,
                tiktokUserId,
              },
              create: {
                video_id: video.video_id,
                cover_image_url: video.cover_image_url,
                title: video.title,
                embed_link: video.embed_link,
                like_count: video.like_count,
                comment_count: video.comment_count,
                share_count: video.share_count,
                createdAt: video.createdAt || undefined,
                tiktokUserId,
              },
            });
          }),
        );

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

  const connectedWhere = buildConnectedWhere(search, platform, {
    gender: input.gender,
    ageRange: input.ageRange,
    country: input.country,
    city: input.city,
    creditTier: input.creditTier,
    interests: input.interests,
    keyword: input.keyword,
    hashtag: input.hashtag,
  });

  // Base WHERE (platform only, no additional filters) for extracting available locations
  const baseWhere = buildConnectedWhere('', platform);

  const [connectedTotal, dualConnectedTotal, connectedRows, locationRows] = await Promise.all([
    prismaAny.user.count({ where: connectedWhere }),
    platform === 'all'
      ? prismaAny.user.count({
          where: {
            ...connectedWhere,
            creator: {
              is: {
                ...(connectedWhere.creator?.is || {}),
                isFacebookConnected: true,
                isTiktokConnected: true,
                instagramUser: { isNot: null },
                tiktokUser: { isNot: null },
              },
            },
          },
        })
      : Promise.resolve(0),
    prismaAny.user.findMany({
      where: connectedWhere,
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: {
        updatedAt: 'desc',
      },
      select: buildConnectedSelect(input.hydrateMissing === true),
    }),
    // Lightweight query: only fetch country/city from all connected creators (no filters)
    prismaAny.user.findMany({
      where: baseWhere,
      select: { country: true, city: true },
      distinct: ['country', 'city'],
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

  const connectedCreators = finalRows.flatMap((row: any) => {
    const creatorId = row.creator?.id;

    const rawTiktokHandle = row.creator?.tiktok || row.creator?.tiktokUser?.username || null;
    const normalizedTiktokHandle = rawTiktokHandle ? String(rawTiktokHandle).replace(/^@/, '') : null;

    const instagramTopVideos = creatorId
      ? hydratedInstagramTopVideos.get(creatorId) || row.creator?.instagramUser?.instagramVideo || []
      : row.creator?.instagramUser?.instagramVideo || [];

    const tiktokTopVideosRaw = creatorId
      ? hydratedTikTokTopVideos.get(creatorId) || row.creator?.tiktokUser?.tiktokVideo || []
      : row.creator?.tiktokUser?.tiktokVideo || [];

    const tiktokTopVideos = (tiktokTopVideosRaw || []).map((video: any) => ({
      ...video,
      video_url:
        normalizedTiktokHandle && video?.video_id
          ? `https://www.tiktok.com/@${normalizedTiktokHandle}/video/${video.video_id}`
          : null,
    }));

    // Add age property based on row.creator.birthDate
    const age = calculateAge(row.creator?.birthDate);
    
    const city = row.city?.trim();
    const country = row.country?.trim();
    const location = [city, country].filter(Boolean).join(', ') || null;

    const baseCreator = {
      type: 'connected',
      userId: row.id,
      creatorId: row.creator?.id,
      name: row.name,
      gender: mapPronounsToGender(row.creator?.pronounce),
      age: age,
      location: location,
      creditTier: row.creator?.creditTier.name || null,
      handles: {
        instagram: row.creator?.instagram || null,
        tiktok: row.creator?.tiktok || null,
      },
      interests: row.creator?.interests?.map((i: any) => i.name).filter(Boolean) || [],
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
        biography: row.creator?.tiktokUser?.biography || null,
        connected: Boolean(row.creator?.isTiktokConnected && row.creator?.tiktokUser),
        followers: row.creator?.tiktokUser?.follower_count || 0,
        engagementRate: row.creator?.tiktokUser?.engagement_rate || 0,
        averageLikes: row.creator?.tiktokUser?.averageLikes || 0,
        averageSaves: 0,
        averageShares: row.creator?.tiktokUser?.averageShares || 0,
        topVideos: tiktokTopVideos,
      },
    };

    const rowsByPlatform: any[] = [];

    if (platform === 'instagram') {
      if (baseCreator.instagram.connected) {
        rowsByPlatform.push({
          ...baseCreator,
          rowId: `${row.id}-instagram`,
          platform: 'instagram',
        });
      }
      return rowsByPlatform;
    }

    if (platform === 'tiktok') {
      if (baseCreator.tiktok.connected) {
        rowsByPlatform.push({
          ...baseCreator,
          rowId: `${row.id}-tiktok`,
          platform: 'tiktok',
        });
      }
      return rowsByPlatform;
    }

    if (baseCreator.instagram.connected) {
      rowsByPlatform.push({
        ...baseCreator,
        rowId: `${row.id}-instagram`,
        platform: 'instagram',
      });
    }

    if (baseCreator.tiktok.connected) {
      rowsByPlatform.push({
        ...baseCreator,
        rowId: `${row.id}-tiktok`,
        platform: 'tiktok',
      });
    }

    return rowsByPlatform;
  });

  // Build available locations map: { country: [city1, city2, ...] }
  const availableLocations: Record<string, string[]> = {};
  for (const row of locationRows) {
    const c = row.country?.trim();
    if (!c) continue;
    if (!availableLocations[c]) {
      availableLocations[c] = [];
    }
    const ct = row.city?.trim();
    if (ct && !availableLocations[c].includes(ct)) {
      availableLocations[c].push(ct);
    }
  }
  // Sort countries and cities alphabetically
  const sortedLocations: Record<string, string[]> = {};
  for (const country of Object.keys(availableLocations).sort()) {
    sortedLocations[country] = availableLocations[country].sort();
  }

  return {
    filters: {
      search,
      platform,
    },
    data: connectedCreators,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: platform === 'all' ? connectedTotal + dualConnectedTotal : connectedTotal,
    },
    availableLocations: sortedLocations,
  };
};
