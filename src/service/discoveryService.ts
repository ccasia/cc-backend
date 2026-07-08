import { PrismaClient } from '@prisma/client';
import { decryptToken, encryptToken } from '@helper/encrypt';
import { refreshTikTokToken } from '@services/socialMediaService';
import {
  createDiscoveryApiSummary,
  resolvePlatformContentMatchesFromApi,
} from '@helper/discovery/platformContentResolver';
import { buildConnectedSelect } from '@helper/discovery/queryBuilders';

import {
  getInstagramMediaObject,
  getInstagramMedias,
  getInstagramOverviewService,
  getInstagramUserInsight,
  getTikTokMediaObject,
  getTikTokOverviewService,
} from '@services/socialMediaService';

import { hydrateMissingInstagramData, hydrateMissingTikTokData, TopVideosByCreator } from '@helper/discovery/hydration';
import { clients, getIo } from '../config/socket';
import {
  ageRangeToBirthDateRange,
  extractHashtags,
  genderToPronounce,
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
import { saveNotification } from '@controllers/notificationController';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

const DISCOVERY_API_CACHE_TTL_MS = Number(process.env.DISCOVERY_API_CACHE_TTL_MS || 5 * 60 * 1000);
const DISCOVERY_API_CACHE_MAX_ENTRIES = Number(process.env.DISCOVERY_API_CACHE_MAX_ENTRIES || 2000);
const DISCOVERY_DEBUG_ENABLED = process.env.DISCOVERY_DEBUG === 'true';
const DISCOVERY_CONTENT_SEARCH_LIVE_API_FALLBACK = process.env.DISCOVERY_CONTENT_SEARCH_LIVE_API_FALLBACK === 'true';
const DISCOVERY_CONTENT_QUERY_CACHE_TTL_MS = Number(process.env.DISCOVERY_CONTENT_QUERY_CACHE_TTL_MS || 30 * 1000);
const DISCOVERY_CONTENT_QUERY_CACHE_MAX_ENTRIES = Number(process.env.DISCOVERY_CONTENT_QUERY_CACHE_MAX_ENTRIES || 200);
const DISCOVERY_EXPORT_MAX_ROWS = Number(process.env.DISCOVERY_EXPORT_MAX_ROWS || 2500);

const discoveryApiResponseCache = new Map<string, { expiresAt: number; value: any }>();
const discoveryApiInFlightRequests = new Map<string, Promise<any>>();
const discoveryContentQueryCache = new Map<string, { expiresAt: number; value: any }>();
const discoveryApiCacheStats = {
  hits: 0,
  misses: 0,
  inflightReuses: 0,
};

const pruneDiscoveryContentQueryCache = () => {
  if (discoveryContentQueryCache.size <= DISCOVERY_CONTENT_QUERY_CACHE_MAX_ENTRIES) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of discoveryContentQueryCache.entries()) {
    if (entry.expiresAt <= now) {
      discoveryContentQueryCache.delete(key);
    }
  }

  if (discoveryContentQueryCache.size <= DISCOVERY_CONTENT_QUERY_CACHE_MAX_ENTRIES) {
    return;
  }

  const entries = Array.from(discoveryContentQueryCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = discoveryContentQueryCache.size - DISCOVERY_CONTENT_QUERY_CACHE_MAX_ENTRIES;
  for (let index = 0; index < excess; index += 1) {
    const key = entries[index]?.[0];
    if (key) {
      discoveryContentQueryCache.delete(key);
    }
  }
};

const getCachedContentQueryResult = (key: string) => {
  const cached = discoveryContentQueryCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    discoveryContentQueryCache.delete(key);
    return null;
  }

  return cached.value;
};

const setCachedContentQueryResult = (key: string, value: any) => {
  discoveryContentQueryCache.set(key, {
    expiresAt: Date.now() + DISCOVERY_CONTENT_QUERY_CACHE_TTL_MS,
    value,
  });
  pruneDiscoveryContentQueryCache();
};

interface PlatformApiStats {
  success: number;
  failed: number;
  rateLimitedSkips: number;
  dbFallback: number;
}

interface DiscoveryApiSummary {
  context: 'content-search' | 'default';
  processedCreators: number;
  instagram: PlatformApiStats;
  tiktok: PlatformApiStats;
}

const createPlatformApiStats = (): PlatformApiStats => ({
  success: 0,
  failed: 0,
  rateLimitedSkips: 0,
  dbFallback: 0,
});

const mergeDiscoveryApiSummary = (target: DiscoveryApiSummary, source: DiscoveryApiSummary) => {
  target.processedCreators += source.processedCreators;
  target.instagram.success += source.instagram.success;
  target.instagram.failed += source.instagram.failed;
  target.instagram.rateLimitedSkips += source.instagram.rateLimitedSkips;
  target.instagram.dbFallback += source.instagram.dbFallback;
  target.tiktok.success += source.tiktok.success;
  target.tiktok.failed += source.tiktok.failed;
  target.tiktok.rateLimitedSkips += source.tiktok.rateLimitedSkips;
  target.tiktok.dbFallback += source.tiktok.dbFallback;
};

const logDiscoveryDebug = (message: string, payload: Record<string, any>) => {
  if (!DISCOVERY_DEBUG_ENABLED) return;
  console.log(`[Discovery][Debug] ${message}`, payload);
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

const getCachedDiscoveryApiResponse = async <T>(key: string, fetcher: () => Promise<T>) => {
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

  const fetchPromise = fetcher()
    .then((value) => {
      pruneDiscoveryApiCache();
      discoveryApiResponseCache.set(key, { expiresAt: Date.now() + DISCOVERY_API_CACHE_TTL_MS, value });
      discoveryApiInFlightRequests.delete(key);
      return value;
    })
    .catch((error) => {
      discoveryApiInFlightRequests.delete(key);
      throw error;
    });

  discoveryApiInFlightRequests.set(key, fetchPromise);
  return fetchPromise;
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

export type DiscoveryExportDataInput = Omit<DiscoveryQueryInput, 'page' | 'limit' | 'hydrateMissing'>;

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

const getCreatorKeywordOnlyTexts = (row: any): string[] => {
  const creator = row?.creator;

  return [
    row?.name,
    creator?.instagram,
    creator?.tiktok,
    creator?.tiktokUser?.username,
    creator?.tiktokUser?.display_name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
};

export interface NonPlatformDiscoveryQueryInput {
  platform?: 'all' | 'instagram' | 'tiktok';
  keyword?: string;
  followers?: number;
  page?: number;
  limit?: number;
}

const ensureValidTikTokAccessTokenForCreator = async (creator: any): Promise<string | null> => {
  const creatorId = creator?.id;
  const tiktokData = creator?.tiktokData as any;

  if (!creatorId || !tiktokData) return null;

  const encryptedAccessToken = tiktokData?.access_token;
  const encryptedRefreshToken = tiktokData?.refresh_token;
  const expiresIn = tiktokData?.expires_in;

  if (!encryptedAccessToken) return null;

  const accessToken = decryptToken(encryptedAccessToken as any);
  const currentTime = Math.floor(Date.now() / 1000);
  const isExpired = expiresIn && currentTime >= expiresIn;

  if (!isExpired && accessToken) {
    return accessToken;
  }

  if (!encryptedRefreshToken) {
    return null;
  }

  try {
    const refreshToken = decryptToken(encryptedRefreshToken as any);
    const refreshedTokenData = await refreshTikTokToken(refreshToken!);

    const newEncryptedAccessToken = encryptToken(refreshedTokenData.access_token);
    const newEncryptedRefreshToken = encryptToken(refreshedTokenData.refresh_token);

    await prismaAny.creator.update({
      where: { id: creatorId },
      data: {
        tiktokData: {
          ...tiktokData,
          access_token: newEncryptedAccessToken,
          refresh_token: newEncryptedRefreshToken,
          expires_in: refreshedTokenData.expires_in ? currentTime + refreshedTokenData.expires_in : null,
        },
      },
    });

    return refreshedTokenData.access_token;
  } catch (error) {
    if (error?.response?.status === 400) {
      console.log('[Discovery][CreatorApi400]', {
        platform: 'tiktok',
        creatorId,
        stage: 'refresh-token',
        status: error?.response?.status,
        response: error?.response?.data || null,
        message: error?.message,
      });
    }
    logDiscoveryDebug('TikTok token refresh failed in discovery', {
      creatorId,
      message: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
};

const collectContentMatchedRowsAcrossAllCandidates = async (
  where: any,
  platform: PlatformFilter,
  options: { keywordTerm?: string; hashtagTerms: string[] },
  config: { orderBy?: any } = {},
) => {
  const batchSize = 25;
  let skip = 0;
  const matchedRows: any[] = [];
  let matchedRowsCount = 0;
  const matchesByCreator = new Map<string, { instagram: boolean; tiktok: boolean }>();
  const instagramTopVideosByCreator: TopVideosByCreator = new Map();
  const tiktokTopVideosByCreator: TopVideosByCreator = new Map();
  const rateLimitState = { instagram: false, tiktok: false };

  while (skip >= 0) {
    const batchRows = await prismaAny.user.findMany({
      where,
      skip,
      take: batchSize,
      orderBy: config.orderBy || { updatedAt: 'desc' },
      select: buildConnectedSelect(true),
    });

    if (!batchRows.length) {
      break;
    }

    const batchMatchResult = await resolvePlatformContentMatchesFromApi(
      batchRows,
      options,
      {
        ensureValidTikTokAccessTokenForCreator,
      },
      {
        rateLimitState,
      },
    );

    for (const [creatorId, match] of batchMatchResult.matchesByCreator.entries()) {
      matchesByCreator.set(creatorId, match);
    }

    for (const [creatorId, videos] of batchMatchResult.instagramTopVideosByCreator.entries()) {
      instagramTopVideosByCreator.set(creatorId, videos);
    }

    for (const [creatorId, videos] of batchMatchResult.tiktokTopVideosByCreator.entries()) {
      tiktokTopVideosByCreator.set(creatorId, videos);
    }

    for (const row of batchRows) {
      const creatorId = row?.creator?.id;
      if (!creatorId) continue;
      const match = matchesByCreator.get(creatorId);
      const rowMatchCount = countRowsForPlatformMatch(row, platform, match);
      matchedRowsCount += rowMatchCount;

      if (rowMatchCount > 0) {
        matchedRows.push(row);
      }
    }

    skip += batchRows.length;
    if (batchRows.length < batchSize) {
      break;
    }
  }

  return {
    matchedRows,
    matchedRowsCount,
    matchesByCreator,
    instagramTopVideosByCreator,
    tiktokTopVideosByCreator,
  };
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

  // Keyword → search through creator names/handles, bios, interests and content captions/titles
  const keywordCondition =
    includeContentFilters && filters.keyword
      ? {
          OR: [
            { name: { contains: filters.keyword, mode: 'insensitive' as const } },
            { creator: { is: { instagram: { contains: filters.keyword, mode: 'insensitive' as const } } } },
            { creator: { is: { tiktok: { contains: filters.keyword, mode: 'insensitive' as const } } } },
            {
              creator: {
                is: { instagramUser: { biography: { contains: filters.keyword, mode: 'insensitive' as const } } },
              },
            },
            {
              creator: {
                is: { tiktokUser: { biography: { contains: filters.keyword, mode: 'insensitive' as const } } },
              },
            },
            {
              creator: {
                is: { mediaKit: { about: { contains: filters.keyword, mode: 'insensitive' as const } } },
              },
            },
            {
              creator: {
                is: { interests: { some: { name: { contains: filters.keyword, mode: 'insensitive' as const } } } },
              },
            },
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
    AND: [platformCondition, ...(searchOr ? [{ OR: searchOr }] : []), ...andConditions].filter(Boolean),
  };
};

const countRowsForPlatformMatch = (
  row: any,
  platform: PlatformFilter,
  match: { instagram: boolean; tiktok: boolean } | undefined,
): number => {
  const creator = row?.creator;
  const hasInstagram = creator?.isFacebookConnected && creator?.instagramUser;
  const hasTikTok = creator?.isTiktokConnected && creator?.tiktokUser;
  let total = 0;
  if (platform !== 'tiktok' && hasInstagram && Boolean(match?.instagram)) total += 1;
  if (platform !== 'instagram' && hasTikTok && Boolean(match?.tiktok)) total += 1;
  return total;
};

interface DiscoveryPastCampaign {
  id: string;
  name: string;
  image: string | null;
  date: string;
  views: number | null;
}

const formatCampaignDate = (value: any): string | null => {
  if (!value) return null;
  const dateObj = new Date(value);
  if (Number.isNaN(dateObj.getTime())) return null;
  return dateObj.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatCampaignPeriod = (start: any, end: any): string => {
  const startLabel = formatCampaignDate(start);
  const endLabel = formatCampaignDate(end);
  if (startLabel && endLabel) {
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel || '';
};

const resolveCampaignCoverImage = (images: any): string | null => {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0];
  if (!first) return null;
  if (typeof first === 'string') return first;
  return first.preview || first.path || first.url || null;
};

// Builds, for each creator userId on the page, the list of campaigns where they have a
// POSTED submission (a completed deliverable), with the campaign cover, date period, and
// summed post views (latest snapshot per post). Views are null when no insight data exists.
export const getPastCampaignsByCreatorIds = async (
  userIds: string[],
): Promise<Map<string, DiscoveryPastCampaign[]>> => {
  const result = new Map<string, DiscoveryPastCampaign[]>();
  const uniqueUserIds = Array.from(new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueUserIds.length === 0) return result;

  const [postedSubmissions, engagementSnapshots] = await Promise.all([
    prismaAny.submission.findMany({
      where: { userId: { in: uniqueUserIds }, status: 'POSTED' },
      select: {
        userId: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            name: true,
            campaignBrief: {
              select: { images: true, startDate: true, endDate: true },
            },
          },
        },
      },
    }),
    prismaAny.postEngagementSnapshot.findMany({
      where: { userId: { in: uniqueUserIds } },
      select: {
        userId: true,
        campaignId: true,
        postUrl: true,
        snapshotDay: true,
        views: true,
      },
      orderBy: { snapshotDay: 'asc' },
    }),
  ]);

  // Keep the latest snapshot (highest snapshotDay) per post, then sum views per creator+campaign.
  const latestSnapshotByPost = new Map<string, any>();
  for (const snapshot of engagementSnapshots as any[]) {
    latestSnapshotByPost.set(snapshot.postUrl, snapshot);
  }
  const viewsByCreatorCampaign = new Map<string, number>();
  for (const snapshot of latestSnapshotByPost.values()) {
    const key = `${snapshot.userId}|${snapshot.campaignId}`;
    viewsByCreatorCampaign.set(key, (viewsByCreatorCampaign.get(key) || 0) + (snapshot.views || 0));
  }

  const seenCreatorCampaign = new Set<string>();
  for (const submission of postedSubmissions as any[]) {
    const submissionUserId = submission?.userId;
    const campaignId = submission?.campaignId;
    if (!submissionUserId || !campaignId) continue;

    const dedupeKey = `${submissionUserId}|${campaignId}`;
    if (seenCreatorCampaign.has(dedupeKey)) continue;
    seenCreatorCampaign.add(dedupeKey);

    const brief = submission?.campaign?.campaignBrief;
    const list = result.get(submissionUserId) || [];
    list.push({
      id: campaignId,
      name: submission?.campaign?.name || 'Untitled campaign',
      image: resolveCampaignCoverImage(brief?.images),
      date: formatCampaignPeriod(brief?.startDate, brief?.endDate),
      views: viewsByCreatorCampaign.has(dedupeKey) ? (viewsByCreatorCampaign.get(dedupeKey) as number) : null,
    });
    result.set(submissionUserId, list);
  }

  return result;
};

// Overall creator rating for the discovery cards: the mean of each campaign's
// "final rating". Per campaign the final rating is the average of whichever sides
// have rated (client + admin -> mean; only one side -> that value; neither ->
// campaign skipped). Creators with no ratings map to null (card shows 0/no stars).
export const getAverageRatingsByCreatorIds = async (
  userIds: string[],
): Promise<Map<string, number | null>> => {
  const result = new Map<string, number | null>();
  const uniqueUserIds = Array.from(new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueUserIds.length === 0) return result;

  const shortlistedRows = await prismaAny.shortListedCreator.findMany({
    where: {
      userId: { in: uniqueUserIds },
      OR: [{ clientRating: { not: null } }, { adminRating: { not: null } }],
    },
    select: {
      userId: true,
      clientRating: true,
      adminRating: true,
    },
  });

  const finalRatingsByCreator = new Map<string, number[]>();
  for (const row of shortlistedRows as any[]) {
    const rowUserId = row?.userId;
    if (!rowUserId) continue;

    const sides = [row.clientRating, row.adminRating].filter(
      (value): value is number => typeof value === 'number',
    );
    if (sides.length === 0) continue;

    const campaignFinal = sides.reduce((sum, value) => sum + value, 0) / sides.length;
    const list = finalRatingsByCreator.get(rowUserId) || [];
    list.push(campaignFinal);
    finalRatingsByCreator.set(rowUserId, list);
  }

  for (const userId of uniqueUserIds) {
    const finals = finalRatingsByCreator.get(userId);
    if (!finals || finals.length === 0) {
      result.set(userId, null);
      continue;
    }
    const average = finals.reduce((sum, value) => sum + value, 0) / finals.length;
    // One decimal place to match the card's `rating.toFixed(1)` display.
    result.set(userId, Math.round(average * 10) / 10);
  }

  return result;
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
  const allPlatformWindowSizeMultiplier = sortBy === 'followers' ? 2 : 1;
  const allPlatformWindowSize = (pagination.skip + pagination.limit) * allPlatformWindowSizeMultiplier;

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
      includeContentFilters: true,
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
                ...((connectedWhere as any).creator?.is || {}),
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
  let apiSummary = createDiscoveryApiSummary(hasContentSearch ? 'content-search' : 'default');
  const contentSearchRateLimitState = { instagram: false, tiktok: false };
  let contentMatchesByCreator = new Map<string, { instagram: boolean; tiktok: boolean }>();
  let contentMatchedTotal = 0;

  if (input.hydrateMissing === true) {
    [hydratedInstagramTopVideos, hydratedTikTokTopVideos] = await Promise.all([
      hydrateMissingInstagramData(connectedRows, { prismaAny }),
      hydrateMissingTikTokData(connectedRows, {
        prismaAny,
        ensureValidTikTokAccessTokenForCreator,
      }),
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
      { keywordTerm: undefined, hashtagTerms: [] },
      { ensureValidTikTokAccessTokenForCreator },
      { rateLimitState: contentSearchRateLimitState },
    );

    apiInstagramTopVideos = liveTopVideosResult.instagramTopVideosByCreator;
    apiTikTokTopVideos = liveTopVideosResult.tiktokTopVideosByCreator;
  }

  if (hasContentSearch) {
    const contentMatchResult = await collectContentMatchedRowsAcrossAllCandidates(
      connectedWhere,
      platform,
      {
        keywordTerm: keywordTerm || undefined,
        hashtagTerms,
      },
      {
        orderBy: connectedOrderBy,
      },
    );

    finalRows = contentMatchResult.matchedRows;
    contentMatchesByCreator = contentMatchResult.matchesByCreator;
    apiInstagramTopVideos = contentMatchResult.instagramTopVideosByCreator;
    apiTikTokTopVideos = contentMatchResult.tiktokTopVideosByCreator;
    contentMatchedTotal = contentMatchResult.matchedRowsCount;
  }

  // For content (keyword/hashtag) searches the real result count is the number of rows
  // that survive the live re-check, not the DB pre-filter count. Reporting the pre-filter
  // count makes loadedCount unreachable on the client and spins its load-more loop.
  const responseTotal = hasContentSearch
    ? contentMatchedTotal
    : platform === 'all'
      ? connectedTotal + dualConnectedTotal
      : connectedTotal;

  const connectedCreators = finalRows.flatMap((row: any) => {
    const creatorId = row.creator?.id;

    const rawTiktokHandle = row.creator?.tiktok || row.creator?.tiktokUser?.username || null;
    const normalizedTiktokHandle = rawTiktokHandle ? String(rawTiktokHandle).replace(/^@/, '') : null;

    const instagramTopVideosFromApi = creatorId ? apiInstagramTopVideos.get(creatorId) : undefined;
    const instagramTopVideosFromHydration = creatorId ? hydratedInstagramTopVideos.get(creatorId) : undefined;

    const instagramTopVideos = creatorId
      ? instagramTopVideosFromApi || instagramTopVideosFromHydration || row.creator?.instagramUser?.instagramVideo || []
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
      age,
      location,
      creditTier: row.creator?.creditTier?.name || null,
      handles: {
        instagram: row.creator?.instagram || null,
        tiktok: row.creator?.tiktok || null,
      },
      interests: row.creator?.interests?.map((i: any) => i.name).filter(Boolean) || [],
      languages: Array.isArray(row.creator?.languages) ? row.creator.languages.filter(Boolean) : [],
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

  // On content searches, keep only the platform rows that actually matched the live
  // re-check so the rendered rows line up 1:1 with contentMatchedTotal.
  const matchedConnectedCreators = hasContentSearch
    ? connectedCreators.filter((creator: any) =>
        Boolean(contentMatchesByCreator.get(creator.creatorId)?.[creator.platform as 'instagram' | 'tiktok']),
      )
    : connectedCreators;

  const sortedConnectedCreators = sortDiscoveryRows(matchedConnectedCreators, sortBy, sortDirection);

  const paginatedConnectedCreators =
    platform === 'all'
      ? sortedConnectedCreators.slice(pagination.skip, pagination.skip + pagination.limit)
      : sortedConnectedCreators;

  const paginatedCreatorUserIds = Array.from(
    new Set(
      (paginatedConnectedCreators || []).map((creator: any) => String(creator?.userId || '').trim()).filter(Boolean),
    ),
  );

  if (paginatedCreatorUserIds.length > 0) {
    const paginatedRowsForLiveTopVideos = await prismaAny.user.findMany({
      where: {
        id: {
          in: paginatedCreatorUserIds,
        },
      },
      select: buildConnectedSelect(true),
    });

    if (paginatedRowsForLiveTopVideos.length > 0) {
      const liveTopVideosResult = await resolvePlatformContentMatchesFromApi(
        paginatedRowsForLiveTopVideos,
        {
          keywordTerm: undefined,
          hashtagTerms: [],
        },
        {
          ensureValidTikTokAccessTokenForCreator,
        },
        {
          rateLimitState: contentSearchRateLimitState,
        },
      );

      apiInstagramTopVideos = liveTopVideosResult.instagramTopVideosByCreator;
      apiTikTokTopVideos = liveTopVideosResult.tiktokTopVideosByCreator;
      apiSummary = liveTopVideosResult.apiSummary;
    }
  }

  console.log('[Discovery][APIs]', apiSummary);

  const [pastCampaignsByCreator, averageRatingByCreator] =
    paginatedCreatorUserIds.length > 0
      ? await Promise.all([
          getPastCampaignsByCreatorIds(paginatedCreatorUserIds),
          getAverageRatingsByCreatorIds(paginatedCreatorUserIds),
        ])
      : [new Map<string, DiscoveryPastCampaign[]>(), new Map<string, number | null>()];

  const enrichedPaginatedConnectedCreators = (paginatedConnectedCreators || []).map((creator: any) => {
    const creatorId = creator?.creatorId;
    if (!creatorId) {
      return creator;
    }

    const instagramTopVideos = apiInstagramTopVideos.get(creatorId) || creator?.instagram?.topVideos || [];
    const tiktokTopVideosRaw = apiTikTokTopVideos.get(creatorId) || creator?.tiktok?.topVideos || [];
    const normalizedTiktokHandle = creator?.handles?.tiktok ? String(creator.handles.tiktok).replace(/^@/, '') : null;

    const tiktokTopVideos = (tiktokTopVideosRaw || []).map((video: any) => ({
      ...video,
      video_url:
        video?.video_url ||
        (normalizedTiktokHandle && video?.video_id
          ? `https://www.tiktok.com/@${normalizedTiktokHandle}/video/${video.video_id}`
          : null),
    }));

    return {
      ...creator,
      pastCampaigns: pastCampaignsByCreator.get(creator?.userId) || [],
      averageRating: averageRatingByCreator.get(creator?.userId) ?? null,
      instagram: {
        ...(creator?.instagram || {}),
        topVideos: instagramTopVideos,
      },
      tiktok: {
        ...(creator?.tiktok || {}),
        topVideos: tiktokTopVideos,
      },
    };
  });

  const creatorTopVideoStatusByUserId = new Map<string, { name: string; returnedTopVideos: boolean }>();

  for (const creatorRow of enrichedPaginatedConnectedCreators as any[]) {
    const userId = String(creatorRow?.userId || '').trim();
    if (!userId) continue;

    const hasInstagramTopVideos =
      Array.isArray(creatorRow?.instagram?.topVideos) && creatorRow.instagram.topVideos.length > 0;
    const hasTikTokTopVideos = Array.isArray(creatorRow?.tiktok?.topVideos) && creatorRow.tiktok.topVideos.length > 0;

    const returnedTopVideos =
      creatorRow?.platform === 'instagram'
        ? hasInstagramTopVideos
        : creatorRow?.platform === 'tiktok'
          ? hasTikTokTopVideos
          : hasInstagramTopVideos || hasTikTokTopVideos;

    const existing = creatorTopVideoStatusByUserId.get(userId);
    if (!existing) {
      creatorTopVideoStatusByUserId.set(userId, {
        name: creatorRow?.name || 'Unknown Creator',
        returnedTopVideos,
      });
      continue;
    }

    if (returnedTopVideos && !existing.returnedTopVideos) {
      existing.returnedTopVideos = true;
    }
  }

  const failedCreatorsTopVideos = Array.from(creatorTopVideoStatusByUserId.entries())
    .filter(([, status]) => !status.returnedTopVideos)
    .map(([userId, status]) => ({
      userId,
      name: status.name,
    }));

  const creatorTopVideoLogSummary = {
    totalCreators: creatorTopVideoStatusByUserId.size,
    successCount: creatorTopVideoStatusByUserId.size - failedCreatorsTopVideos.length,
    failedCount: failedCreatorsTopVideos.length,
  };

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

  console.log('[Discovery][GetCreators]', {
    platform,
    sortBy,
    sortDirection,
    page: pagination.page,
    limit: pagination.limit,
    returned: enrichedPaginatedConnectedCreators.length,
    total: responseTotal,
    hasContentSearch,
    topVideos: creatorTopVideoLogSummary,
  });

  const result = {
    filters: {
      search,
      platform,
      sortBy,
      sortDirection,
    },
    data: enrichedPaginatedConnectedCreators,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: responseTotal,
    },
    availableLocations: sortedLocations,
  };

  return result;
};

const mapConnectedDiscoveryRows = (
  rows: any[],
  platform: PlatformFilter,
  options: { includeDbTopVideos?: boolean } = {},
) =>
  rows.flatMap((row: any) => {
    const age = calculateAge(row.creator?.birthDate);
    const city = row.city?.trim();
    const country = row.country?.trim();
    const location = [city, country].filter(Boolean).join(', ') || null;

    const instagramTopVideos = options.includeDbTopVideos ? row.creator?.instagramUser?.instagramVideo || [] : [];
    const rawTiktokHandle = row.creator?.tiktok || row.creator?.tiktokUser?.username || null;
    const normalizedTiktokHandle = rawTiktokHandle ? String(rawTiktokHandle).replace(/^@/, '') : null;
    const tiktokTopVideos = options.includeDbTopVideos
      ? (row.creator?.tiktokUser?.tiktokVideo || []).map((video: any) => ({
          ...video,
          video_url:
            normalizedTiktokHandle && video?.video_id
              ? `https://www.tiktok.com/@${normalizedTiktokHandle}/video/${video.video_id}`
              : null,
        }))
      : [];

    const baseCreator = {
      type: 'connected',
      userId: row.id,
      creatorId: row.creator?.id,
      name: row.name,
      gender: mapPronounsToGender(row.creator?.pronounce),
      age,
      location,
      creditTier: row.creator?.creditTier?.name || null,
      handles: {
        instagram: row.creator?.instagram || null,
        tiktok: row.creator?.tiktok || null,
      },
      interests: row.creator?.interests?.map((i: any) => i.name).filter(Boolean) || [],
      languages: Array.isArray(row.creator?.languages) ? row.creator.languages.filter(Boolean) : [],
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

export const getDiscoveryCreatorsExportData = async (input: DiscoveryExportDataInput) => {
  const search = (input.search || '').trim();
  const platform = normalizePlatform(input.platform);
  const { sortBy, sortDirection } = normalizeDiscoverySort(input.sortBy, input.sortDirection);
  const connectedOrderBy = buildDiscoveryUserOrderBy(platform, sortBy, sortDirection);
  const take = Math.max(1, DISCOVERY_EXPORT_MAX_ROWS);

  const connectedWhere = buildConnectedWhere(search, platform, {
    gender: input.gender,
    ageRange: input.ageRange,
    country: input.country,
    city: input.city,
    creditTier: input.creditTier,
    languages: input.languages,
    interests: input.interests,
    keyword: input.keyword,
    hashtag: input.hashtag,
  });

  const [connectedTotal, dualConnectedTotal, rows] = await Promise.all([
    prismaAny.user.count({ where: connectedWhere }),
    platform === 'all'
      ? prismaAny.user.count({
          where: {
            ...connectedWhere,
            creator: {
              is: {
                ...((connectedWhere as any).creator?.is || {}),
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
      take,
      orderBy: connectedOrderBy,
      select: buildConnectedSelect(false),
    }),
  ]);

  const total = platform === 'all' ? connectedTotal + dualConnectedTotal : connectedTotal;
  const sortedRows = sortDiscoveryRows(mapConnectedDiscoveryRows(rows, platform), sortBy, sortDirection);
  const data = sortedRows.slice(0, DISCOVERY_EXPORT_MAX_ROWS);

  return {
    filters: {
      search,
      platform,
      sortBy,
      sortDirection,
    },
    data,
    total,
    exported: data.length,
    truncated: total > data.length,
    maxRows: DISCOVERY_EXPORT_MAX_ROWS,
  };
};

const normalizeNonPlatformFilter = (
  platform?: string,
): {
  platform: 'all' | 'instagram' | 'tiktok';
  token: string | null;
} => {
  if (platform === 'instagram') {
    return { platform: 'instagram', token: 'instagram' };
  }

  if (platform === 'tiktok') {
    return { platform: 'tiktok', token: 'tiktok' };
  }

  return { platform: 'all', token: null };
};

const normalizeProfileLink = (value?: string | null): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw}`;
};

const resolveNonPlatform = (row: any): 'instagram' | 'tiktok' | 'unknown' => {
  const profileLink = String(row?.creator?.profileLink || '').toLowerCase();
  if (profileLink.includes('instagram')) return 'instagram';
  if (profileLink.includes('tiktok')) return 'tiktok';

  if (row?.creator?.instagram) return 'instagram';
  if (row?.creator?.tiktok) return 'tiktok';

  return 'unknown';
};

export const getNonPlatformDiscoveryCreators = async (input: NonPlatformDiscoveryQueryInput) => {
  const keyword = String(input.keyword || '').trim();
  const followers = Number.isFinite(input.followers) ? Math.max(0, Number(input.followers)) : undefined;
  const { page, limit, skip } = normalizePagination(input.page, input.limit);
  const { platform, token: platformToken } = normalizeNonPlatformFilter(input.platform);

  const platformCondition =
    platformToken == null
      ? undefined
      : {
          OR: [
            {
              creator: {
                is: {
                  profileLink: {
                    contains: platformToken,
                    mode: 'insensitive' as const,
                  },
                },
              },
            },
            platform === 'instagram'
              ? {
                  creator: {
                    is: {
                      instagram: {
                        not: null,
                      },
                    },
                  },
                }
              : {
                  creator: {
                    is: {
                      tiktok: {
                        not: null,
                      },
                    },
                  },
                },
          ],
        };

  const keywordCondition =
    keyword.length > 0
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' as const } },
            {
              creator: {
                is: {
                  instagram: { contains: keyword, mode: 'insensitive' as const },
                },
              },
            },
            {
              creator: {
                is: {
                  tiktok: { contains: keyword, mode: 'insensitive' as const },
                },
              },
            },
            {
              creator: {
                is: {
                  profileLink: { contains: keyword, mode: 'insensitive' as const },
                },
              },
            },
          ],
        }
      : undefined;

  const followersCondition =
    followers != null
      ? {
          creator: {
            is: {
              manualFollowerCount: {
                gte: followers,
              },
            },
          },
        }
      : undefined;

  const where = {
    role: 'creator',
    creator: {
      is: {},
    },
    OR: [{ status: 'guest' }, { creator: { is: { isGuest: true } } }],
    AND: [platformCondition, keywordCondition, followersCondition].filter(Boolean),
  } as any;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ creator: { manualFollowerCount: 'desc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        status: true,
        creator: {
          select: {
            id: true,
            instagram: true,
            tiktok: true,
            profileLink: true,
            manualFollowerCount: true,
            isGuest: true,
          },
        },
      },
    }),
  ]);

  const data = rows.map((row) => {
    const platformValue = resolveNonPlatform(row);
    return {
      rowId: row.id,
      userId: row.id,
      creatorId: row.creator?.id || null,
      name: row.name || 'Guest Creator',
      platform: platformValue,
      followers: Number(row.creator?.manualFollowerCount || 0),
      profileLink: normalizeProfileLink(row.creator?.profileLink),
      handles: {
        instagram: row.creator?.instagram || null,
        tiktok: row.creator?.tiktok || null,
      },
    };
  });

  return {
    filters: {
      platform,
      keyword,
      followers: followers ?? null,
    },
    data,
    pagination: {
      page,
      limit,
      total,
    },
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

  const inviteResult = await prisma.$transaction(async (tx) => {
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
    const invitedCreatorNotifications: {
      userId: string;
      campaignId: string;
      campaignName: string;
    }[] = [];

    for (const creatorId of creatorIds) {
      const creatorUser = creatorById.get(creatorId);
      if (!creatorUser) {
        skippedNotFoundCount += 1;
        continue;
      }

      const invitePitchStatus = isV4Campaign ? 'SENT_TO_CLIENT' : 'APPROVED';

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

      const pitch = await tx.pitch.create({
        data: {
          userId: creatorUser.id,
          campaignId,
          type: 'shortlisted',
          status: invitePitchStatus,
          isInvited: true,
          content: `Creator ${creatorUser.name} has been invited for campaign "${campaign.name}"`,
          amount: null,
          agreementTemplateId: null,
          approvedByAdminId: invitedByUserId,
        } as any,
      });

      if (!isV4Campaign) {
        const existingShortlist = await tx.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId: creatorUser.id,
              campaignId,
            },
          },
        });

        if (existingShortlist) {
          await tx.shortListedCreator.update({
            where: {
              userId_campaignId: {
                userId: creatorUser.id,
                campaignId,
              },
            },
            data: {
              isAgreementReady: false,
            },
          });
        } else {
          await tx.shortListedCreator.create({
            data: {
              userId: creatorUser.id,
              campaignId,
              isAgreementReady: false,
              currency: 'MYR',
            },
          });
        }

        const existingAgreement = await tx.creatorAgreement.findFirst({
          where: {
            userId: creatorUser.id,
            campaignId,
          },
        });

        if (!existingAgreement) {
          await tx.creatorAgreement.create({
            data: {
              userId: creatorUser.id,
              campaignId,
              agreementUrl: '',
            },
          });
        }

        const existingSubmissions = await tx.submission.findMany({
          where: {
            userId: creatorUser.id,
            campaignId,
          },
          include: {
            submissionType: true,
          },
        });

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            campaignId,
            for: 'creator',
            name: { not: 'Open For Pitch' },
          },
          include: { submissionType: true },
          orderBy: { order: 'asc' },
        });

        const existingSubmissionTypes = new Set<string | undefined>(
          existingSubmissions.map((submission) => submission.submissionType?.type),
        );

        const timelinesWithoutExisting = timelines.filter(
          (timeline) => timeline.submissionType?.type && !existingSubmissionTypes.has(timeline.submissionType.type),
        );

        const board = await tx.board.findUnique({
          where: { userId: creatorUser.id },
          include: { columns: true },
        });

        if (board && timelinesWithoutExisting.length > 0) {
          const columnToDo = board.columns.find((column) => column.name.includes('To Do'));
          const columnInProgress = board.columns.find((column) => column.name.includes('In Progress'));

          if (columnToDo && columnInProgress) {
            const submissions = await Promise.all(
              timelinesWithoutExisting.map(async (timeline, index) => {
                return tx.submission.create({
                  data: {
                    dueDate: timeline.endDate,
                    campaignId: timeline.campaignId,
                    userId: creatorUser.id,
                    status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                    submissionTypeId: timeline.submissionTypeId as string,
                    task: {
                      create: {
                        name: timeline.name,
                        position: index,
                        columnId: timeline.submissionType?.type ? columnInProgress.id : columnToDo.id,
                        priority: '',
                        status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                      },
                    },
                  },
                  include: {
                    submissionType: true,
                  },
                });
              }),
            );

            const agreement = submissions.find((submission) => submission.submissionType?.type === 'AGREEMENT_FORM');
            const draft = submissions.find((submission) => submission.submissionType?.type === 'FIRST_DRAFT');
            const finalDraft = submissions.find((submission) => submission.submissionType?.type === 'FINAL_DRAFT');
            const posting = submissions.find((submission) => submission.submissionType?.type === 'POSTING');

            const dependencies = [
              { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
              { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
              { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
            ].filter((dependency) => dependency.submissionId && dependency.dependentSubmissionId);

            if (dependencies.length > 0) {
              await tx.submissionDependency.createMany({ data: dependencies });
            }
          }
        }
      }

      if (!isV4Campaign) {
        invitedCreatorNotifications.push({
          userId: pitch.userId,
          campaignId: pitch.campaignId,
          campaignName: campaign.name,
        });
      }

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

      const clientUsers = campaign.campaignAdmin.filter((campaignAdmin) => campaignAdmin.admin.user.role === 'client');

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
      invitedCreatorNotifications,
    };
  });

  if (!inviteResult.isV4Campaign) {
    for (const creatorInvite of inviteResult.invitedCreatorNotifications) {
      const creatorNotification = await saveNotification({
        title: 'Campaign Invitation',
        message: `You have been invited to campaign "${creatorInvite.campaignName}".`,
        entity: 'Pitch',
        entityId: creatorInvite.campaignId,
        creatorId: creatorInvite.userId,
        userId: creatorInvite.userId,
      });

      const creatorSocketId = clients.get(creatorInvite.userId);

      if (creatorSocketId) {
        getIo().to(creatorSocketId).emit('notification', creatorNotification);
        getIo().to(creatorSocketId).emit('pitchUpdate');
      }
    }
  }

  return {
    campaignId: inviteResult.campaignId,
    isV4Campaign: inviteResult.isV4Campaign,
    invitedCount: inviteResult.invitedCount,
    skippedExistingCount: inviteResult.skippedExistingCount,
    skippedNotFoundCount: inviteResult.skippedNotFoundCount,
  };
};

const DISCOVERY_BOOKMARK_PLATFORMS = ['instagram', 'tiktok'] as const;

export type DiscoveryBookmarkPlatform = (typeof DISCOVERY_BOOKMARK_PLATFORMS)[number];

export const isDiscoveryBookmarkPlatform = (value: unknown): value is DiscoveryBookmarkPlatform =>
  DISCOVERY_BOOKMARK_PLATFORMS.includes(value as DiscoveryBookmarkPlatform);

// Shared helper: map a list of bookmark membership rows into hydrated discovery
// creator rows, preserving the order of the supplied memberships (de-duplicated
// by rowId so a creator that appears in several selected lists shows once).
const mapBookmarkMembershipsToCreatorRows = async (memberships: { creatorUserId: string; platform: string }[]) => {
  const creatorUserIds = Array.from(
    new Set(memberships.map((m) => String(m.creatorUserId || '').trim()).filter(Boolean)),
  );

  if (creatorUserIds.length === 0) return [];

  const rows = await prismaAny.user.findMany({
    where: { id: { in: creatorUserIds } },
    select: buildConnectedSelect(false),
  });

  const mappedRows = mapConnectedDiscoveryRows(rows, 'all', { includeDbTopVideos: true });
  const [pastCampaignsByCreator, averageRatingByCreator] = await Promise.all([
    getPastCampaignsByCreatorIds(creatorUserIds as string[]),
    getAverageRatingsByCreatorIds(creatorUserIds as string[]),
  ]);
  const rowsByRowId = new Map(
    mappedRows.map((mappedRow: any) => [
      mappedRow.rowId,
      {
        ...mappedRow,
        pastCampaigns: pastCampaignsByCreator.get(mappedRow.userId) || [],
        averageRating: averageRatingByCreator.get(mappedRow.userId) ?? null,
      },
    ]),
  );

  const seen = new Set<string>();
  const data: any[] = [];
  memberships.forEach((m) => {
    const rowId = `${m.creatorUserId}-${m.platform}`;
    if (seen.has(rowId)) return;
    const mappedRow = rowsByRowId.get(rowId);
    if (mappedRow) {
      seen.add(rowId);
      data.push(mappedRow);
    }
  });

  return data;
};

// Returns the account's bookmark lists (with creator counts) plus a flat list of
// every membership so the UI can show which lists a given creator already lives in.
export const getBookmarkLists = async (userId: string) => {
  const lists = await prismaAny.bookMarkCreatorList.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { creators: true } },
    },
  });

  const memberships = await prismaAny.bookMarkCreator.findMany({
    where: { userId },
    select: { listId: true, creatorUserId: true, platform: true },
  });

  return {
    lists: lists.map((list: any) => ({
      id: list.id,
      name: list.name,
      count: list._count?.creators ?? 0,
      createdAt: list.createdAt,
    })),
    memberships,
  };
};

export const createBookmarkList = async (userId: string, name: string) => {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('List name is required');

  const existing = await prismaAny.bookMarkCreatorList.findUnique({
    where: { userId_name: { userId, name: trimmedName } },
  });
  if (existing) throw new Error('A list with this name already exists');

  return prismaAny.bookMarkCreatorList.create({
    data: { userId, name: trimmedName },
    select: { id: true, name: true, createdAt: true },
  });
};

export const deleteBookmarkList = async (userId: string, listId: string) => {
  const list = await prismaAny.bookMarkCreatorList.findUnique({
    where: { id: listId },
    select: { id: true, userId: true },
  });

  if (!list || list.userId !== userId) {
    throw new Error('List not found');
  }

  await prismaAny.bookMarkCreatorList.delete({ where: { id: listId } });
  return { deleted: true };
};

// Creators that belong to the given lists (union). When no listIds are supplied,
// returns creators across all of the account's lists. Ordered most-recent first.
export const getBookmarkedCreatorsByLists = async (userId: string, listIds: string[]) => {
  const memberships = await prismaAny.bookMarkCreator.findMany({
    where: {
      userId,
      ...(listIds.length > 0 ? { listId: { in: listIds } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { creatorUserId: true, platform: true },
  });

  const data = await mapBookmarkMembershipsToCreatorRows(memberships);

  return { data, total: data.length };
};

export const addCreatorToList = async (
  userId: string,
  listId: string,
  creatorUserId: string,
  platform: DiscoveryBookmarkPlatform,
) => {
  const list = await prismaAny.bookMarkCreatorList.findUnique({
    where: { id: listId },
    select: { id: true, userId: true },
  });

  if (!list || list.userId !== userId) {
    throw new Error('List not found');
  }

  const creatorUser = await prismaAny.user.findUnique({
    where: { id: creatorUserId },
    select: { id: true, role: true },
  });

  if (!creatorUser || creatorUser.role !== 'creator') {
    throw new Error('Creator not found');
  }

  return prismaAny.bookMarkCreator.upsert({
    where: {
      listId_creatorUserId_platform: { listId, creatorUserId, platform },
    },
    update: {},
    create: { userId, listId, creatorUserId, platform },
  });
};

export const removeCreatorFromList = async (
  userId: string,
  listId: string,
  creatorUserId: string,
  platform: DiscoveryBookmarkPlatform,
) => {
  const list = await prismaAny.bookMarkCreatorList.findUnique({
    where: { id: listId },
    select: { id: true, userId: true },
  });

  if (!list || list.userId !== userId) {
    throw new Error('List not found');
  }

  const result = await prismaAny.bookMarkCreator.deleteMany({
    where: { listId, creatorUserId, platform },
  });

  return { removedCount: result.count };
};
