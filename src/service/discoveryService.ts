import { PrismaClient } from '@prisma/client';
import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMediaObject,
  getInstagramMedias,
  getInstagramOverviewService,
  getInstagramUserInsight,
  getTikTokMediaObject,
} from '@services/socialMediaService';
import {
  getLatestInstagramCaptionsForMatch,
  getLatestTikTokTitlesForMatch,
  mapInstagramApiTopVideos,
  mapTikTokApiTopVideos,
} from '@helper/discovery/mediaHelpers';
import {
  ageRangeToBirthDateRange,
  extractHashtags,
  genderToPronounce,
  matchesContentTerms,
  normalizeKeywordTerm,
  normalizePagination,
  normalizePlatform,
  PlatformFilter,
} from '@helper/discovery/queryHelpers';
import {
  buildDiscoveryUserOrderBy,
  DiscoverySortBy,
  DiscoverySortDirection,
  normalizeDiscoverySort,
  sortDiscoveryRows,
} from '@helper/discovery/sortHelpers';
import { mapPronounsToGender } from '@utils/mapPronounsToGender';
import { calculateAge } from '@utils/calculateAge';
import axios from 'axios';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

type TopVideosByCreator = Map<string, any[]>;

const DISCOVERY_API_CACHE_TTL_MS = Number(process.env.DISCOVERY_API_CACHE_TTL_MS || 5 * 60 * 1000);
const DISCOVERY_API_CACHE_MAX_ENTRIES = Number(process.env.DISCOVERY_API_CACHE_MAX_ENTRIES || 2000);
const DISCOVERY_DEBUG_ENABLED = true;

const discoveryApiResponseCache = new Map<string, { expiresAt: number; value: any }>();
const discoveryApiInFlightRequests = new Map<string, Promise<any>>();
const discoveryApiCacheStats = {
  hits: 0,
  misses: 0,
  inflightReuses: 0,
};

const logDiscoveryDebug = (message: string, payload: Record<string, any>) => {
  if (!DISCOVERY_DEBUG_ENABLED) return;
  console.log(`[Discovery][Debug] ${message}`, payload);
};

const summarizeTikTokVideos = (videos: any[] = []) => ({
  total: videos.length,
  withId: videos.filter((video: any) => Boolean(video?.id || video?.video_id)).length,
  withTitle: videos.filter((video: any) => Boolean(video?.title)).length,
  withCoverImage: videos.filter((video: any) => Boolean(video?.cover_image_url)).length,
  withEmbedLink: videos.filter((video: any) => Boolean(video?.embed_link)).length,
  withCreateTime: videos.filter((video: any) => Boolean(video?.create_time || video?.createdAt)).length,
});

const pruneDiscoveryApiCache = () => {
  if (discoveryApiResponseCache.size <= DISCOVERY_API_CACHE_MAX_ENTRIES) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of discoveryApiResponseCache.entries()) {
    if (entry.expiresAt <= now) {
      discoveryApiResponseCache.delete(key);
    }
  }

  if (discoveryApiResponseCache.size <= DISCOVERY_API_CACHE_MAX_ENTRIES) {
    return;
  }

  const entries = Array.from(discoveryApiResponseCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = discoveryApiResponseCache.size - DISCOVERY_API_CACHE_MAX_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    const key = entries[index]?.[0];
    if (key) {
      discoveryApiResponseCache.delete(key);
    }
  }
};

const getCachedDiscoveryApiResponse = async <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const cached = discoveryApiResponseCache.get(key);
  if (cached && cached.expiresAt > now) {
    discoveryApiCacheStats.hits += 1;
    return cached.value as T;
  }

  const inFlight = discoveryApiInFlightRequests.get(key);
  if (inFlight) {
    discoveryApiCacheStats.inflightReuses += 1;
    return inFlight as Promise<T>;
  }

  discoveryApiCacheStats.misses += 1;

  const request = (async () => {
    const value = await fetcher();
    discoveryApiResponseCache.set(key, {
      expiresAt: Date.now() + DISCOVERY_API_CACHE_TTL_MS,
      value,
    });
    pruneDiscoveryApiCache();
    return value;
  })();

  discoveryApiInFlightRequests.set(key, request as Promise<any>);

  try {
    return await request;
  } finally {
    discoveryApiInFlightRequests.delete(key);
  }
};

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
  languages?: string[];
  interests?: string[];
  keyword?: string;
  hashtag?: string;
  sortBy?: DiscoverySortBy;
  sortDirection?: DiscoverySortDirection;
}

export interface InviteDiscoveryCreatorsInput {
  campaignId: string;
  creatorIds: string[];
  invitedByUserId: string;
}

const isRateLimitError = (error: any) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  return status === 429 || code === 'rate_limit_exceeded';
};

const resolvePlatformContentMatchesFromApi = async (
  rows: any[],
  options: { keywordTerm?: string; hashtagTerms: string[] },
  config: { rateLimitState?: { instagram: boolean; tiktok: boolean } } = {},
) => {
  const matchesByCreator = new Map<string, { instagram: boolean; tiktok: boolean }>();
  const instagramTopVideosByCreator: TopVideosByCreator = new Map();
  const tiktokTopVideosByCreator: TopVideosByCreator = new Map();
  const rateLimitState = config.rateLimitState || { instagram: false, tiktok: false };

  await Promise.allSettled(
    (rows || []).map(async (row) => {
      const creator = row?.creator;
      const creatorId = creator?.id;

      if (!creatorId) {
        return;
      }

      let instagramMatched = false;
      let tiktokMatched = false;

      const dbInstagramVideos = creator?.instagramUser?.instagramVideo || [];
      const dbTikTokVideos = creator?.tiktokUser?.tiktokVideo || [];
      const dbInstagramCaptions = getLatestInstagramCaptionsForMatch(dbInstagramVideos, 5);
      const dbTikTokCaptions = getLatestTikTokTitlesForMatch(dbTikTokVideos, 5);

      if (creator?.isFacebookConnected && creator?.instagramUser) {
        if (rateLimitState.instagram) {
          instagramMatched = matchesContentTerms(dbInstagramCaptions, options);
          instagramTopVideosByCreator.set(creatorId, dbInstagramVideos);
          logDiscoveryDebug('Instagram skipped API due rate-limit state', {
            creatorId,
            dbVideoCount: dbInstagramVideos.length,
            hashtagTermsCount: options.hashtagTerms?.length || 0,
            hasKeyword: Boolean(options.keywordTerm),
          });
        } else {
        try {
          const encryptedAccessToken = creator?.instagramUser?.accessToken;
          logDiscoveryDebug('Instagram fetch start', {
            creatorId,
            hasEncryptedAccessToken: Boolean(encryptedAccessToken),
            dbVideoCount: dbInstagramVideos.length,
            hashtagTermsCount: options.hashtagTerms?.length || 0,
            hasKeyword: Boolean(options.keywordTerm),
          });

          if (encryptedAccessToken) {
            const accessToken = decryptToken(encryptedAccessToken as any);
            const instagramMediaResponse = await getCachedDiscoveryApiResponse(
              `discovery:instagram:medias:${creatorId}`,
              () => getInstagramMedias(accessToken, 20),
            );
            const videos = instagramMediaResponse?.videos || [];
            const mediaTypeBreakdown = (videos || []).reduce((acc: Record<string, number>, video: any) => {
              const type = String(video?.media_type || 'UNKNOWN');
              acc[type] = (acc[type] || 0) + 1;
              return acc;
            }, {});
            logDiscoveryDebug('Instagram API response summary', {
              creatorId,
              apiVideoCount: videos.length,
              withMediaUrlCount: videos.filter((video: any) => Boolean(video?.media_url)).length,
              withThumbnailCount: videos.filter((video: any) => Boolean(video?.thumbnail_url)).length,
              withPermalinkCount: videos.filter((video: any) => Boolean(video?.permalink)).length,
              mediaTypeBreakdown,
            });

            const captions = getLatestInstagramCaptionsForMatch(videos, 5);
            const mappedVideos = mapInstagramApiTopVideos(videos || []);

            instagramMatched = matchesContentTerms(captions, options);
            instagramTopVideosByCreator.set(creatorId, mappedVideos);
            logDiscoveryDebug('Instagram mapped top videos', {
              creatorId,
              mappedCount: mappedVideos.length,
              mappedIds: mappedVideos.slice(0, 3).map((video: any) => video?.id || null),
              mappedTimestamps: mappedVideos
                .slice(0, 3)
                .map((video: any) => (video?.datePosted ? new Date(video.datePosted).toISOString() : null)),
              matchedByContentTerms: instagramMatched,
            });
          } else {
            instagramMatched = matchesContentTerms(dbInstagramCaptions, options);
            instagramTopVideosByCreator.set(creatorId, dbInstagramVideos);
            logDiscoveryDebug('Instagram fallback to DB (missing access token)', {
              creatorId,
              dbVideoCount: dbInstagramVideos.length,
              matchedByContentTerms: instagramMatched,
            });
          }
        } catch (error) {
          if (isRateLimitError(error)) {
            rateLimitState.instagram = true;
          }
          instagramMatched = matchesContentTerms(dbInstagramCaptions, options);
          instagramTopVideosByCreator.set(creatorId, dbInstagramVideos);
          logDiscoveryDebug('Instagram API fetch failed, fallback to DB', {
            creatorId,
            isRateLimited: isRateLimitError(error),
            status: error?.response?.status,
            errorCode: error?.response?.data?.error?.code,
            errorMessage: error?.response?.data?.error?.message || error?.message,
            dbVideoCount: dbInstagramVideos.length,
            matchedByContentTerms: instagramMatched,
          });
        }
        }
      }

      if (creator?.isTiktokConnected && creator?.tiktokUser) {
        if (rateLimitState.tiktok) {
          tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
          tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
          logDiscoveryDebug('TikTok skipped API due rate-limit state', {
            creatorId,
            dbVideoCount: dbTikTokVideos.length,
            hashtagTermsCount: options.hashtagTerms?.length || 0,
            hasKeyword: Boolean(options.keywordTerm),
            dbSummary: summarizeTikTokVideos(dbTikTokVideos),
          });
        } else {
        try {
          const encryptedAccessToken = creator?.tiktokData?.access_token;
          logDiscoveryDebug('TikTok fetch start', {
            creatorId,
            hasEncryptedAccessToken: Boolean(encryptedAccessToken),
            dbVideoCount: dbTikTokVideos.length,
            hashtagTermsCount: options.hashtagTerms?.length || 0,
            hasKeyword: Boolean(options.keywordTerm),
            dbSummary: summarizeTikTokVideos(dbTikTokVideos),
          });

          if (encryptedAccessToken) {
            const accessToken = decryptToken(encryptedAccessToken as any);
            const mediaObject = await getCachedDiscoveryApiResponse(
              `discovery:tiktok:medias:${creatorId}`,
              () => getTikTokMediaObject(accessToken, 20),
            );
            const videos = mediaObject?.videos || [];
            const captions = getLatestTikTokTitlesForMatch(videos, 5);
            const mappedVideos = mapTikTokApiTopVideos(videos);

            logDiscoveryDebug('TikTok API response summary', {
              creatorId,
              apiVideoCount: videos.length,
              apiSummary: summarizeTikTokVideos(videos),
              dbVideoCount: dbTikTokVideos.length,
            });

            tiktokMatched = matchesContentTerms(captions, options);
            tiktokTopVideosByCreator.set(creatorId, mappedVideos);

            logDiscoveryDebug('TikTok mapped top videos', {
              creatorId,
              mappedCount: mappedVideos.length,
              mappedSummary: summarizeTikTokVideos(mappedVideos),
              mappedIds: mappedVideos.slice(0, 3).map((video: any) => video?.video_id || video?.id || null),
              mappedCreatedAt: mappedVideos
                .slice(0, 3)
                .map((video: any) => (video?.createdAt ? new Date(video.createdAt).toISOString() : null)),
              matchedByContentTerms: tiktokMatched,
            });

            if (videos.length === 0 && dbTikTokVideos.length > 0) {
              logDiscoveryDebug('TikTok API returned no videos but DB has videos', {
                creatorId,
                dbVideoCount: dbTikTokVideos.length,
                dbSummary: summarizeTikTokVideos(dbTikTokVideos),
              });
            }
          } else {
            tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
            tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
            logDiscoveryDebug('TikTok fallback to DB (missing access token)', {
              creatorId,
              dbVideoCount: dbTikTokVideos.length,
              dbSummary: summarizeTikTokVideos(dbTikTokVideos),
              matchedByContentTerms: tiktokMatched,
            });
          }
        } catch (error) {
          if (isRateLimitError(error)) {
            rateLimitState.tiktok = true;
          }
          tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
          tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
          logDiscoveryDebug('TikTok API fetch failed, fallback to DB', {
            creatorId,
            isRateLimited: isRateLimitError(error),
            status: error?.response?.status,
            errorCode: error?.response?.data?.error?.code || error?.response?.data?.code,
            errorMessage:
              error?.response?.data?.error?.message ||
              error?.response?.data?.message ||
              error?.message,
            responseData: error?.response?.data || null,
            dbVideoCount: dbTikTokVideos.length,
            dbSummary: summarizeTikTokVideos(dbTikTokVideos),
            matchedByContentTerms: tiktokMatched,
          });
        }
        }
      }

      matchesByCreator.set(creatorId, {
        instagram: instagramMatched,
        tiktok: tiktokMatched,
      });
    }),
  );

  return {
    matchesByCreator,
    instagramTopVideosByCreator,
    tiktokTopVideosByCreator,
  };
};

const countRowsForPlatformMatch = (
  row: any,
  platform: PlatformFilter,
  match: { instagram: boolean; tiktok: boolean } | undefined,
) => {
  const hasInstagram = Boolean(row?.creator?.isFacebookConnected && row?.creator?.instagramUser);
  const hasTikTok = Boolean(row?.creator?.isTiktokConnected && row?.creator?.tiktokUser);

  if (platform === 'instagram') {
    return hasInstagram && Boolean(match?.instagram) ? 1 : 0;
  }

  if (platform === 'tiktok') {
    return hasTikTok && Boolean(match?.tiktok) ? 1 : 0;
  }

  let total = 0;
  if (hasInstagram && Boolean(match?.instagram)) total += 1;
  if (hasTikTok && Boolean(match?.tiktok)) total += 1;
  return total;
};

const countContentMatchedRowsAcrossAllCandidates = async (
  where: any,
  platform: PlatformFilter,
  options: { keywordTerm?: string; hashtagTerms: string[] },
) => {
  const batchSize = 25;
  let skip = 0;
  let matchedRowsCount = 0;
  const rateLimitState = { instagram: false, tiktok: false };

  while (true) {
    const batchRows = await prismaAny.user.findMany({
      where,
      skip,
      take: batchSize,
      orderBy: {
        updatedAt: 'desc',
      },
      select: buildConnectedSelect(true),
    });

    if (!batchRows.length) {
      break;
    }

    const { matchesByCreator } = await resolvePlatformContentMatchesFromApi(batchRows, options, {
      rateLimitState,
    });

    for (const row of batchRows) {
      const creatorId = row?.creator?.id;
      if (!creatorId) continue;
      const match = matchesByCreator.get(creatorId);
      matchedRowsCount += countRowsForPlatformMatch(row, platform, match);
    }

    skip += batchRows.length;
    if (batchRows.length < batchSize) {
      break;
    }
  }

  return matchedRowsCount;
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
    languages?: string[];
    interests?: string[];
    keyword?: string;
    hashtag?: string;
  } = {},
  options: {
    includeContentFilters?: boolean;
  } = {},
) => {
  const includeContentFilters = options.includeContentFilters ?? true;

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
  const cityCondition = filters.city ? { city: { equals: filters.city, mode: 'insensitive' as const } } : undefined;

  // Credit tier → filter by CreditTier.name via relation
  const creditTierCondition = filters.creditTier
    ? { creator: { is: { creditTier: { name: { equals: filters.creditTier, mode: 'insensitive' as const } } } } }
    : undefined;

  // Languages → match against Creator.languages (Json array), any selected language
  const languagesCondition =
    filters.languages && filters.languages.length > 0
      ? {
          OR: filters.languages.map((language) => ({
            creator: {
              is: {
                languages: {
                  array_contains: [language],
                },
              },
            },
          })),
        }
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
  const keywordCondition =
    includeContentFilters && filters.keyword
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
    includeContentFilters && hashtagTerms.length > 0
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
    languagesCondition,
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
          id: true,
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
            take: 5,
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
            take: 5,
          },
        },
      },
    },
  },
});

const hydrateMissingInstagramData = async (rows: any[]): Promise<TopVideosByCreator> => {
  const topVideosByCreator: TopVideosByCreator = new Map();

  const persistLatestInstagramVideos = async (instagramUserId: string, videos: any[]) => {
    const topVideoIds = (videos || []).map((video: any) => video?.id).filter(Boolean);

    if (topVideoIds.length > 0) {
      await prismaAny.instagramVideo.deleteMany({
        where: {
          instagramUserId,
          OR: [
            { video_id: null },
            {
              video_id: {
                notIn: topVideoIds,
              },
            },
          ],
        },
      });
    } else {
      await prismaAny.instagramVideo.deleteMany({
        where: {
          instagramUserId,
        },
      });
    }

    await Promise.allSettled(
      (videos || []).map(async (media: any) => {
        if (!media?.id) return;

        await prismaAny.instagramVideo.upsert({
          where: {
            video_id: media.id,
          },
          update: {
            video_id: media.id,
            comments_count: media.comments_count,
            like_count: media.like_count,
            media_type: media.media_type,
            media_url: media.media_url,
            thumbnail_url: media.thumbnail_url,
            caption: media.caption,
            permalink: media.permalink,
            datePosted: media.timestamp ? new Date(media.timestamp) : null,
          },
          create: {
            video_id: media.id,
            comments_count: media.comments_count,
            like_count: media.like_count,
            media_type: media.media_type,
            media_url: media.media_url,
            thumbnail_url: media.thumbnail_url,
            caption: media.caption,
            permalink: media.permalink,
            datePosted: media.timestamp ? new Date(media.timestamp) : null,
            instagramUserId,
          },
        });
      }),
    );
  };

  const candidates = rows.filter((row) => {
    const creator = row?.creator;
    const instagramUser = creator?.instagramUser;

    if (!creator?.isFacebookConnected || !instagramUser) {
      return false;
    }

    return (
      !instagramUser?.insightData ||
      !instagramUser?.profile_picture_url ||
      instagramUser?.totalShares == null ||
      !Array.isArray(instagramUser?.instagramVideo) ||
      instagramUser?.instagramVideo.length === 0
    );
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
        const instagramUserId = instagramUser?.id;
        const encryptedAccessToken = instagramUser?.accessToken;

        if (!creatorId || !instagramUserId || !encryptedAccessToken) {
          return;
        }

        const accessToken = decryptToken(encryptedAccessToken as any);
        const overview = await getCachedDiscoveryApiResponse(
          `discovery:instagram:overview:${creatorId}`,
          () => getInstagramOverviewService(accessToken),
        );
        const instagramUserIdForInsight = overview.user_id || instagramUser.user_id;
        const insight = await getCachedDiscoveryApiResponse(
          `discovery:instagram:insight:${creatorId}:${instagramUserIdForInsight || 'unknown'}`,
          () => getInstagramUserInsight(accessToken, instagramUserIdForInsight),
        );
        const medias = await getCachedDiscoveryApiResponse(
          `discovery:instagram:mediaObject:${creatorId}:${instagramUserIdForInsight || 'unknown'}`,
          () => getInstagramMediaObject(accessToken, instagramUserIdForInsight),
        );

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
          media_type: media.media_type,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
          like_count: media.like_count,
          comments_count: media.comments_count,
          datePosted: media.timestamp ? new Date(media.timestamp) : null,
        }));

        await persistLatestInstagramVideos(instagramUserId, medias.sortedVideos || []);

        topVideosByCreator.set(creatorId, topVideos);
      } catch (error) {
        // Swallow hydrate errors to keep discovery response fast and resilient.
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

        const overviewRes = await getCachedDiscoveryApiResponse(
          `discovery:tiktok:userInfo:${creatorId}`,
          () =>
            axios.get('https://open.tiktokapis.com/v2/user/info/', {
              params: {
                fields:
                  'open_id,union_id,display_name,bio_description,username,avatar_url,following_count,follower_count,likes_count',
              },
              headers: { Authorization: `Bearer ${accessToken}` },
            }),
        );

        const overview = overviewRes?.data?.data?.user || {};
        const mediaObject = await getCachedDiscoveryApiResponse(
          `discovery:tiktok:medias:${creatorId}`,
          () => getTikTokMediaObject(accessToken, 20),
        );

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
      }
    }),
  );

  return topVideosByCreator;
};

export const getDiscoveryCreators = async (input: DiscoveryQueryInput) => {
  const search = (input.search || '').trim();
  const platform = normalizePlatform(input.platform);
  const { sortBy, sortDirection } = normalizeDiscoverySort(input.sortBy, input.sortDirection);
  const keywordTerm = normalizeKeywordTerm(input.keyword);
  const hashtagTerms = extractHashtags(input.hashtag);
  const hasContentSearch = Boolean(keywordTerm || hashtagTerms.length > 0);
  const includeAccessTokenSelect = input.hydrateMissing === true || hasContentSearch;
  const connectedOrderBy = buildDiscoveryUserOrderBy(platform, sortBy, sortDirection);

  const pagination = normalizePagination(input.page, input.limit);
  const allPlatformWindowSize = pagination.skip + pagination.limit;

  const connectedWhere = buildConnectedWhere(
    search,
    platform,
    {
      gender: input.gender,
      ageRange: input.ageRange,
      country: input.country,
      city: input.city,
      creditTier: input.creditTier,
      languages: input.languages,
      interests: input.interests,
      keyword: input.keyword,
      hashtag: input.hashtag,
    },
    {
      includeContentFilters: !hasContentSearch,
    },
  );

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
      skip: platform === 'all' ? 0 : pagination.skip,
      take: platform === 'all' ? allPlatformWindowSize : pagination.limit,
      orderBy: connectedOrderBy,
      select: buildConnectedSelect(includeAccessTokenSelect),
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
  let apiInstagramTopVideos: TopVideosByCreator = new Map();
  let apiTikTokTopVideos: TopVideosByCreator = new Map();
  let contentMatchesByCreator = new Map<string, { instagram: boolean; tiktok: boolean }>();
  let contentMatchedTotal = 0;
  const contentSearchRateLimitState = { instagram: false, tiktok: false };

  if (input.hydrateMissing === true) {
    [hydratedInstagramTopVideos, hydratedTikTokTopVideos] = await Promise.all([
      hydrateMissingInstagramData(connectedRows),
      hydrateMissingTikTokData(connectedRows),
    ]);

    finalRows = await prismaAny.user.findMany({
      where: connectedWhere,
      skip: platform === 'all' ? 0 : pagination.skip,
      take: platform === 'all' ? allPlatformWindowSize : pagination.limit,
      orderBy: connectedOrderBy,
      select: buildConnectedSelect(false),
    });
  }

  if (!hasContentSearch) {
    const liveTopVideosResult = await resolvePlatformContentMatchesFromApi(
      connectedRows,
      {
        keywordTerm: undefined,
        hashtagTerms: [],
      },
      {
        rateLimitState: contentSearchRateLimitState,
      },
    );

    apiInstagramTopVideos = liveTopVideosResult.instagramTopVideosByCreator;
    apiTikTokTopVideos = liveTopVideosResult.tiktokTopVideosByCreator;
  }

  if (hasContentSearch) {
    const apiMatchResult = await resolvePlatformContentMatchesFromApi(connectedRows, {
      keywordTerm: keywordTerm || undefined,
      hashtagTerms,
    }, {
      rateLimitState: contentSearchRateLimitState,
    });

    contentMatchesByCreator = apiMatchResult.matchesByCreator;
    apiInstagramTopVideos = apiMatchResult.instagramTopVideosByCreator;
    apiTikTokTopVideos = apiMatchResult.tiktokTopVideosByCreator;

    contentMatchedTotal = await countContentMatchedRowsAcrossAllCandidates(connectedWhere, platform, {
      keywordTerm: keywordTerm || undefined,
      hashtagTerms,
    });
  }

  const connectedCreators = finalRows.flatMap((row: any) => {
    const creatorId = row.creator?.id;
    const contentMatches = creatorId ? contentMatchesByCreator.get(creatorId) : undefined;

    const rawTiktokHandle = row.creator?.tiktok || row.creator?.tiktokUser?.username || null;
    const normalizedTiktokHandle = rawTiktokHandle ? String(rawTiktokHandle).replace(/^@/, '') : null;

    const instagramTopVideosFromApi = creatorId ? apiInstagramTopVideos.get(creatorId) : undefined;
    const instagramTopVideosFromHydration = creatorId ? hydratedInstagramTopVideos.get(creatorId) : undefined;

    const instagramTopVideos = creatorId
      ? instagramTopVideosFromApi ||
        instagramTopVideosFromHydration ||
        row.creator?.instagramUser?.instagramVideo ||
        []
      : row.creator?.instagramUser?.instagramVideo || [];

    const instagramTopVideosSource = creatorId
      ? instagramTopVideosFromApi
        ? 'api'
        : instagramTopVideosFromHydration
          ? 'hydrated'
          : 'db'
      : 'db';

    if (creatorId && (instagramTopVideos.length < 3 || instagramTopVideosSource !== 'api')) {
      logDiscoveryDebug('Instagram final top videos source (potentially incomplete)', {
        creatorId,
        userId: row.id,
        source: instagramTopVideosSource,
        finalCount: instagramTopVideos.length,
        apiCount: instagramTopVideosFromApi?.length || 0,
        hydratedCount: instagramTopVideosFromHydration?.length || 0,
        dbCount: row.creator?.instagramUser?.instagramVideo?.length || 0,
        sampleIds: (instagramTopVideos || []).slice(0, 3).map((video: any) => video?.id || video?.video_id || null),
      });
    }

    const tiktokTopVideosRaw = creatorId
      ? apiTikTokTopVideos.get(creatorId) ||
        hydratedTikTokTopVideos.get(creatorId) ||
        row.creator?.tiktokUser?.tiktokVideo ||
        []
      : row.creator?.tiktokUser?.tiktokVideo || [];

    const tiktokTopVideosSource = creatorId
      ? apiTikTokTopVideos.get(creatorId)
        ? 'api'
        : hydratedTikTokTopVideos.get(creatorId)
          ? 'hydrated'
          : 'db'
      : 'db';

    const tiktokTopVideos = (tiktokTopVideosRaw || []).map((video: any) => ({
      ...video,
      video_url:
        normalizedTiktokHandle && video?.video_id
          ? `https://www.tiktok.com/@${normalizedTiktokHandle}/video/${video.video_id}`
          : null,
    }));

    if (creatorId && (tiktokTopVideos.length < 3 || tiktokTopVideosSource !== 'api')) {
      logDiscoveryDebug('TikTok final top videos source (potentially incomplete)', {
        creatorId,
        userId: row.id,
        source: tiktokTopVideosSource,
        finalCount: tiktokTopVideos.length,
        apiCount: apiTikTokTopVideos.get(creatorId)?.length || 0,
        hydratedCount: hydratedTikTokTopVideos.get(creatorId)?.length || 0,
        dbCount: row.creator?.tiktokUser?.tiktokVideo?.length || 0,
        missingVideoUrlCount: (tiktokTopVideos || []).filter((video: any) => !video?.video_url).length,
        hasHandle: Boolean(normalizedTiktokHandle),
        handleUsed: normalizedTiktokHandle,
        sampleIds: (tiktokTopVideos || []).slice(0, 3).map((video: any) => video?.video_id || video?.id || null),
      });
    }

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
      creditTier: row.creator?.creditTier?.name || null,
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
        profilePictureUrl: row.creator?.tiktokUser?.avatar_url || null,
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
    const instagramMatched = hasContentSearch ? Boolean(contentMatches?.instagram) : true;
    const tiktokMatched = hasContentSearch ? Boolean(contentMatches?.tiktok) : true;

    if (platform === 'instagram') {
      if (baseCreator.instagram.connected && instagramMatched) {
        rowsByPlatform.push({
          ...baseCreator,
          rowId: `${row.id}-instagram`,
          platform: 'instagram',
        });
      }
      return rowsByPlatform;
    }

    if (platform === 'tiktok') {
      if (baseCreator.tiktok.connected && tiktokMatched) {
        rowsByPlatform.push({
          ...baseCreator,
          rowId: `${row.id}-tiktok`,
          platform: 'tiktok',
        });
      }
      return rowsByPlatform;
    }

    if (baseCreator.instagram.connected && instagramMatched) {
      rowsByPlatform.push({
        ...baseCreator,
        rowId: `${row.id}-instagram`,
        platform: 'instagram',
      });
    }

    if (baseCreator.tiktok.connected && tiktokMatched) {
      rowsByPlatform.push({
        ...baseCreator,
        rowId: `${row.id}-tiktok`,
        platform: 'tiktok',
      });
    }

    return rowsByPlatform;
  });

  const sortedConnectedCreators = sortDiscoveryRows(connectedCreators, sortBy, sortDirection);

  const paginatedConnectedCreators =
    platform === 'all'
      ? sortedConnectedCreators.slice(pagination.skip, pagination.skip + pagination.limit)
      : sortedConnectedCreators;

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

  const cacheStatsSnapshot = {
    hits: discoveryApiCacheStats.hits,
    misses: discoveryApiCacheStats.misses,
    inflightReuses: discoveryApiCacheStats.inflightReuses,
    entries: discoveryApiResponseCache.size,
  };

  console.log('[Discovery][GetCreators]', {
    platform,
    sortBy,
    sortDirection,
    page: pagination.page,
    limit: pagination.limit,
    returned: paginatedConnectedCreators.length,
    total: hasContentSearch ? contentMatchedTotal : platform === 'all' ? connectedTotal + dualConnectedTotal : connectedTotal,
    hasContentSearch,
    cache: cacheStatsSnapshot,
  });

  return {
    filters: {
      search,
      platform,
      sortBy,
      sortDirection,
    },
    data: paginatedConnectedCreators,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: hasContentSearch ? contentMatchedTotal : platform === 'all' ? connectedTotal + dualConnectedTotal : connectedTotal,
    },
    availableLocations: sortedLocations,
  };
};

export const inviteDiscoveryCreators = async (input: InviteDiscoveryCreatorsInput) => {
  const campaignId = String(input.campaignId || '').trim();
  const creatorIds = Array.from(new Set((input.creatorIds || []).map((id) => String(id).trim()).filter(Boolean)));
  const invitedByUserId = String(input.invitedByUserId || '').trim();

  if (!campaignId) {
    throw new Error('campaignId is required');
  }

  if (!invitedByUserId) {
    throw new Error('invitedByUserId is required');
  }

  if (!creatorIds.length) {
    throw new Error('At least one creator is required');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: invitedByUserId },
    select: { role: true },
  });

  const isSuperadmin = currentUser?.role === 'superadmin';

  const campaignAccess = await prisma.campaignAdmin.findFirst({
    where: {
      campaignId,
      adminId: invitedByUserId,
    },
  });

  if (!campaignAccess && !isSuperadmin) {
    throw new Error('Not authorized to invite creators for this campaign');
  }

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: {
        thread: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const isV4Campaign = campaign.submissionVersion === 'v4';
    const threadId = campaign.thread?.id;

    const creatorUsers = await tx.user.findMany({
      where: {
        id: { in: creatorIds },
        role: 'creator',
      },
      select: {
        id: true,
        name: true,
      },
    });

    const creatorById = new Map(creatorUsers.map((user) => [user.id, user]));

    let invitedCount = 0;
    let skippedExistingCount = 0;
    let skippedNotFoundCount = 0;

    for (const creatorId of creatorIds) {
      const creatorUser = creatorById.get(creatorId);
      if (!creatorUser) {
        skippedNotFoundCount += 1;
        continue;
      }

      const existingPitch = await tx.pitch.findFirst({
        where: {
          campaignId,
          userId: creatorUser.id,
        },
        select: { id: true },
      });

      if (existingPitch) {
        skippedExistingCount += 1;
        continue;
      }

      await tx.pitch.create({
        data: {
          userId: creatorUser.id,
          campaignId,
          type: 'shortlisted',
          status: 'INVITED',
          isInvited: true,
          content: `Creator ${creatorUser.name} has been invited for campaign "${campaign.name}"`,
          amount: null,
          agreementTemplateId: null,
          approvedByAdminId: invitedByUserId,
        } as any,
      });

      if (threadId) {
        const existingUserThread = await tx.userThread.findUnique({
          where: {
            userId_threadId: {
              userId: creatorUser.id,
              threadId,
            },
          },
          select: { userId: true },
        });

        if (!existingUserThread) {
          await tx.userThread.create({
            data: {
              userId: creatorUser.id,
              threadId,
            },
          });
        }
      }

      const clientUsers = campaign.campaignAdmin.filter(
        (campaignAdmin) => campaignAdmin.admin.user.role === 'client',
      );

      for (const clientUser of clientUsers) {
        await tx.notification.create({
          data: {
            title: 'Creator Invited',
            message: `Creator ${creatorUser.name} has been invited for campaign "${campaign.name}".`,
            entity: 'Pitch',
            campaignId,
            userId: clientUser.admin.userId,
          },
        });
      }

      await tx.campaignLog.create({
        data: {
          message: `${creatorUser.name || 'Creator'} has been invited`,
          adminId: invitedByUserId,
          campaignId,
        },
      });

      invitedCount += 1;
    }

    return {
      campaignId,
      isV4Campaign,
      invitedCount,
      skippedExistingCount,
      skippedNotFoundCount,
    };
  });
};
