import { PrismaClient } from '@prisma/client';
import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMediaObject,
  getInstagramMedias,
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

const DISCOVERY_API_CACHE_TTL_MS = Number(process.env.DISCOVERY_API_CACHE_TTL_MS || 5 * 60 * 1000);
const DISCOVERY_API_CACHE_MAX_ENTRIES = Number(process.env.DISCOVERY_API_CACHE_MAX_ENTRIES || 2000);

const discoveryApiResponseCache = new Map<string, { expiresAt: number; value: any }>();
const discoveryApiInFlightRequests = new Map<string, Promise<any>>();
const discoveryApiCacheStats = {
  hits: 0,
  misses: 0,
  inflightReuses: 0,
};

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

const normalizeKeywordTerm = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ');

const normalizeContentText = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKeywordComparableText = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseKeywordWords = (keywordTerm?: string) => {
  if (!keywordTerm) return [] as string[];

  const commaSeparated = keywordTerm
    .split(',')
    .map((term) => normalizeKeywordComparableText(term))
    .filter(Boolean);

  if (commaSeparated.length > 1) {
    return commaSeparated;
  }

  return normalizeKeywordComparableText(keywordTerm)
    .split(' ')
    .map((term) => term.trim())
    .filter(Boolean);
};

const hasKeywordPhraseMatch = (text: string, keywordTerm?: string) => {
  if (!keywordTerm) return true;
  const normalizedText = normalizeKeywordComparableText(text);
  const normalizedKeyword = normalizeKeywordComparableText(keywordTerm);

  if (!normalizedKeyword) return true;
  if (!normalizedText) return false;

  // Require phrase boundaries so partial token matches don't pass
  // Example: "a short message fro" should NOT match "a short message from"
  const pattern = `(^|\\s)${escapeRegex(normalizedKeyword)}(\\s|$)`;
  const phraseRegex = new RegExp(pattern);
  return phraseRegex.test(normalizedText);
};

const hasKeywordWordsMatch = (text: string, keywordTerm?: string) => {
  if (!keywordTerm) return true;

  const normalizedText = normalizeKeywordComparableText(text);
  if (!normalizedText) return false;

  const words = parseKeywordWords(keywordTerm);
  if (words.length === 0) return true;

  return words.every((word) => {
    const pattern = `(^|\\s)${escapeRegex(word)}(\\s|$)`;
    return new RegExp(pattern).test(normalizedText);
  });
};

const hasKeywordMatch = (text: string, keywordTerm?: string) => {
  if (!keywordTerm) return true;
  return hasKeywordPhraseMatch(text, keywordTerm) || hasKeywordWordsMatch(text, keywordTerm);
};

const matchesContentTerms = (texts: string[], options: { keywordTerm?: string; hashtagTerms: string[] }) => {
  const normalizedTexts = (texts || []).map((text) => normalizeContentText(text));

  const keywordTerms = parseKeywordWords(options.keywordTerm);

  const keywordMatches =
    !options.keywordTerm ||
    // Phrase match can be satisfied by any single caption/title.
    normalizedTexts.some((text) => hasKeywordPhraseMatch(text, options.keywordTerm)) ||
    // For multi-keyword inputs, allow terms to be distributed across multiple captions/titles.
    keywordTerms.every((term) =>
      normalizedTexts.some((text) => {
        const normalizedText = normalizeKeywordComparableText(text);
        const pattern = `(^|\\s)${escapeRegex(term)}(\\s|$)`;
        return new RegExp(pattern).test(normalizedText);
      }),
    );

  const hashtagMatches =
    options.hashtagTerms.length === 0 ||
    // Require each hashtag term to appear somewhere across all captions/titles.
    options.hashtagTerms.every((tag) => normalizedTexts.some((text) => text.includes(tag)));

  return keywordMatches && hashtagMatches;
};

const mapInstagramApiTopVideos = (videos: any[]) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5)
    .map((media: any) => ({
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

const mapTikTokApiTopVideos = (videos: any[]) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.create_time ? Number(a.create_time) : 0;
      const bTime = b?.create_time ? Number(b.create_time) : 0;
      return bTime - aTime;
    })
    .slice(0, 5)
    .map((video: any) => ({
      video_id: video.id,
      cover_image_url: video.cover_image_url,
      title: video.title,
      embed_link: video.embed_link,
      like_count: video.like_count || 0,
      comment_count: video.comment_count || 0,
      share_count: video.share_count || 0,
      createdAt: video.create_time ? new Date(Number(video.create_time) * 1000) : null,
    }));

const getLatestInstagramCaptionsForMatch = (videos: any[], limit = 5) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((video: any) => video?.caption || '');

const getLatestTikTokTitlesForMatch = (videos: any[], limit = 5) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => {
      const aTime = a?.create_time ? Number(a.create_time) : 0;
      const bTime = b?.create_time ? Number(b.create_time) : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((video: any) => video?.title || '');

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
        } else {
        try {
          const encryptedAccessToken = creator?.instagramUser?.accessToken;
          if (encryptedAccessToken) {
            const accessToken = decryptToken(encryptedAccessToken as any);
            const instagramMediaResponse = await getCachedDiscoveryApiResponse(
              `discovery:instagram:medias:${creatorId}`,
              () => getInstagramMedias(accessToken, 20),
            );
            const videos = instagramMediaResponse?.videos || [];
            const captions = getLatestInstagramCaptionsForMatch(videos, 5);

            instagramMatched = matchesContentTerms(captions, options);
            instagramTopVideosByCreator.set(creatorId, mapInstagramApiTopVideos(videos || []));
          } else {
            instagramMatched = matchesContentTerms(dbInstagramCaptions, options);
            instagramTopVideosByCreator.set(creatorId, dbInstagramVideos);
          }
        } catch (error) {
          if (isRateLimitError(error)) {
            rateLimitState.instagram = true;
          }
          instagramMatched = matchesContentTerms(dbInstagramCaptions, options);
          instagramTopVideosByCreator.set(creatorId, dbInstagramVideos);
        }
        }
      }

      if (creator?.isTiktokConnected && creator?.tiktokUser) {
        if (rateLimitState.tiktok) {
          tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
          tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
        } else {
        try {
          const encryptedAccessToken = creator?.tiktokData?.access_token;
          if (encryptedAccessToken) {
            const accessToken = decryptToken(encryptedAccessToken as any);
            const mediaObject = await getCachedDiscoveryApiResponse(
              `discovery:tiktok:medias:${creatorId}`,
              () => getTikTokMediaObject(accessToken, 20),
            );
            const videos = mediaObject?.videos || [];
            const captions = getLatestTikTokTitlesForMatch(videos, 5);

            tiktokMatched = matchesContentTerms(captions, options);
            tiktokTopVideosByCreator.set(creatorId, mapTikTokApiTopVideos(videos));
          } else {
            tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
            tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
          }
        } catch (error) {
          if (isRateLimitError(error)) {
            rateLimitState.tiktok = true;
          }
          tiktokMatched = matchesContentTerms(dbTikTokCaptions, options);
          tiktokTopVideosByCreator.set(creatorId, dbTikTokVideos);
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
        // Swallow hydrate errors to keep discovery response fast and resilient.
      }
    }),
  );

  return topVideosByCreator;
};

export const getDiscoveryCreators = async (input: DiscoveryQueryInput) => {
  const search = (input.search || '').trim();
  const platform = normalizePlatform(input.platform);
  const keywordTerm = normalizeKeywordTerm(input.keyword);
  const hashtagTerms = extractHashtags(input.hashtag);
  const hasContentSearch = Boolean(keywordTerm || hashtagTerms.length > 0);
  const includeAccessTokenSelect = input.hydrateMissing === true || hasContentSearch;

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
      orderBy: {
        updatedAt: 'desc',
      },
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
      orderBy: {
        updatedAt: 'desc',
      },
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

    const instagramTopVideos = creatorId
      ? apiInstagramTopVideos.get(creatorId) ||
        hydratedInstagramTopVideos.get(creatorId) ||
        row.creator?.instagramUser?.instagramVideo ||
        []
      : row.creator?.instagramUser?.instagramVideo || [];

    const tiktokTopVideosRaw = creatorId
      ? apiTikTokTopVideos.get(creatorId) ||
        hydratedTikTokTopVideos.get(creatorId) ||
        row.creator?.tiktokUser?.tiktokVideo ||
        []
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

  const paginatedConnectedCreators =
    platform === 'all'
      ? connectedCreators.slice(pagination.skip, pagination.skip + pagination.limit)
      : connectedCreators;

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
