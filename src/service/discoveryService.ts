import {
  buildDiscoverySelect,
  mapDiscoveryRows,
  matchesDiscoveryRow,
  savedDiscoveryProfilesEnabled,
} from '@helper/discovery/savedProfiles';
import { campaignHasClient } from '@utils/campaignFlow';
import { decryptToken, encryptToken } from '@helper/encrypt';
import { refreshTikTokToken } from '@services/socialMediaService';
import { resolvePlatformContentMatchesFromApi } from '@helper/discovery/platformContentResolver';

import { hydrateMissingInstagramData, hydrateMissingTikTokData } from '@helper/discovery/hydration';
import { clients, getIo } from '../config/socket';
import {
  ageRangeToBirthDateRange,
  extractHashtags,
  genderToPronounce,
  normalizePagination,
  normalizePlatform,
  PlatformFilter,
} from '@helper/discovery/queryHelpers';
import {
  DiscoverySortBy,
  DiscoverySortDirection,
  normalizeDiscoverySort,
  sortDiscoveryRows,
} from '@helper/discovery/sortHelpers';
import { formatEngagementRatePercent } from '@services/guestProfileExtraction/engagementRateCalculator';
import { mapPronounsToGender } from '@utils/mapPronounsToGender';
import { calculateAge } from '@utils/calculateAge';
import { saveNotification } from '@controllers/notificationController';
import { prisma } from '@/src/prisma/prisma';

const prismaAny = prisma as any;

const DISCOVERY_EXPORT_MAX_ROWS = Number(process.env.DISCOVERY_EXPORT_MAX_ROWS || 2500);

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
    console.warn('TikTok token refresh failed in discovery', {
      creatorId,
      message: error?.message,
      status: error?.response?.status,
    });
    return null;
  }
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

  const saved = { creator: { is: { discoveryProfiles: { some: platform === 'all' ? {} : { platform } } } } };
  const platformCondition = {
    OR: [
      ...(savedDiscoveryProfilesEnabled() ? [saved] : []),
      ...(platform === 'instagram'
        ? [instagramConnected]
        : platform === 'tiktok'
          ? [tiktokConnected]
          : [instagramConnected, tiktokConnected]),
    ],
  };

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
export const getAverageRatingsByCreatorIds = async (userIds: string[]): Promise<Map<string, number | null>> => {
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

    const sides = [row.clientRating, row.adminRating].filter((value): value is number => typeof value === 'number');
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

const queryDiscoveryRows = async (
  input: DiscoveryQueryInput,
  options: { memberships?: { creatorUserId: string; platform: string }[]; export?: boolean } = {},
) => {
  const platform = normalizePlatform(input.platform);
  const { sortBy, sortDirection } = normalizeDiscoverySort(input.sortBy, input.sortDirection);
  const pagination = normalizePagination(input.page, input.limit);
  const search = (input.search || '').trim();
  const where: any = buildConnectedWhere('', platform, input, { includeContentFilters: false });
  if (options.memberships) where.AND.push({ id: { in: options.memberships.map((m) => m.creatorUserId) } });
  const [candidates, locations] = await Promise.all([
    prismaAny.user.findMany({ where, select: buildDiscoverySelect(false, Boolean(input.keyword || input.hashtag)) }),
    options.memberships || options.export
      ? Promise.resolve([])
      : prismaAny.user.findMany({
          where: buildConnectedWhere('', platform),
          select: { country: true, city: true },
          distinct: ['country', 'city'],
        }),
  ]);
  const membershipIds = options.memberships
    ? new Set(options.memberships.map((m) => `${m.creatorUserId}-${m.platform}`))
    : null;
  const matching = mapDiscoveryRows(candidates, platform).filter(
    (row) => (!membershipIds || membershipIds.has(row.rowId)) && matchesDiscoveryRow(row, input),
  );
  const sorted = sortDiscoveryRows(matching, sortBy, sortDirection);
  const selected = options.memberships
    ? sorted
    : options.export
      ? sorted.slice(0, DISCOVERY_EXPORT_MAX_ROWS)
      : sorted.slice(pagination.skip, pagination.skip + pagination.limit);
  const userIds = [...new Set(selected.map((row) => row.userId))];
  let fullRows = userIds.length
    ? await prismaAny.user.findMany({
        where: { id: { in: userIds } },
        select: buildDiscoverySelect(true, false, !options.export),
      })
    : [];
  if (input.hydrateMissing && fullRows.length) {
    await Promise.all([
      hydrateMissingInstagramData(fullRows, { prismaAny }),
      hydrateMissingTikTokData(fullRows, { prismaAny, ensureValidTikTokAccessTokenForCreator }),
    ]);
    fullRows = await prismaAny.user.findMany({
      where: { id: { in: userIds } },
      select: buildDiscoverySelect(true, false, true),
    });
  }
  const [pastCampaigns, ratings, live] = await Promise.all([
    getPastCampaignsByCreatorIds(userIds),
    getAverageRatingsByCreatorIds(userIds),
    !options.export && fullRows.length
      ? resolvePlatformContentMatchesFromApi(fullRows, { hashtagTerms: [] }, { ensureValidTikTokAccessTokenForCreator })
      : Promise.resolve(null),
  ]);
  const fullById = new Map(mapDiscoveryRows(fullRows, platform).map((row) => [row.rowId, row]));
  const data = selected.map((selectedRow) => {
    const row = fullById.get(selectedRow.rowId) ?? selectedRow;
    for (const key of ['instagram', 'tiktok'] as const) {
      const videos =
        key === 'instagram'
          ? live?.instagramTopVideosByCreator.get(row.creatorId)
          : live?.tiktokTopVideosByCreator.get(row.creatorId);
      if (row[key].connected && videos?.length)
        row[key].topVideos = videos.map((video: any) => ({
          ...video,
          ...(key === 'tiktok' && row.handles.tiktok && video.video_id
            ? {
                video_url: video.video_url ?? `https://www.tiktok.com/@${row.handles.tiktok}/video/${video.video_id}`,
              }
            : {}),
        }));
      delete row[key].searchCaptions;
    }
    return {
      ...row,
      pastCampaigns: pastCampaigns.get(row.userId) ?? [],
      averageRating: ratings.get(row.userId) ?? null,
    };
  });
  const availableLocations: Record<string, string[]> = {};
  for (const location of locations) {
    const country = location.country?.trim();
    const city = location.city?.trim();
    if (!country) continue;
    availableLocations[country] ??= [];
    if (city && !availableLocations[country].includes(city)) availableLocations[country].push(city);
  }
  Object.values(availableLocations).forEach((cities) => cities.sort());
  return {
    data,
    filters: { search, platform, sortBy, sortDirection },
    pagination: { page: pagination.page, limit: pagination.limit, total: matching.length },
    availableLocations,
  };
};

export const getDiscoveryCreators = (input: DiscoveryQueryInput) => queryDiscoveryRows(input);

export const getDiscoveryCreatorsExportData = async (input: DiscoveryExportDataInput) => {
  const result = await queryDiscoveryRows(input, { export: true });
  return {
    filters: result.filters,
    data: result.data,
    total: result.pagination.total,
    exported: result.data.length,
    truncated: result.pagination.total > result.data.length,
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

    // v4 with a client: invites go to client review. v4 without one: to admin review
    // (SENT_TO_CLIENT would strand them — nobody left to act). Non-v4: approved directly.
    let invitePitchStatus: 'SENT_TO_CLIENT' | 'PENDING_REVIEW' | 'APPROVED' = 'APPROVED';
    if (isV4Campaign) {
      invitePitchStatus = campaignHasClient(campaign) ? 'SENT_TO_CLIENT' : 'PENDING_REVIEW';
    }

    const creatorUsers = await tx.user.findMany({
      where: {
        id: { in: creatorIds },
        role: 'creator',
      },
      select: {
        id: true,
        name: true,
        status: true,
        creator: { select: { isGuest: true } },
      },
    });

    if (creatorUsers.some((user) => user.creator?.isGuest || user.status === 'guest')) {
      throw new Error('Non-platform creators must be added through Master List');
    }

    const creatorById = new Map(creatorUsers.map((user) => [user.id, user]));

    // Seed each pitch from the creator's saved scrape (carried over by Link Creator),
    // so the Master List shows metrics for creators with no connected account.
    const savedProfiles = await tx.creatorDiscoveryProfile.findMany({
      where: { userId: { in: creatorIds } },
      select: { userId: true, platform: true, followers: true, engagementRate: true },
      orderBy: { savedAt: 'desc' },
    });
    const savedProfileByUserId = new Map<string, (typeof savedProfiles)[number]>();
    for (const profile of savedProfiles) {
      if (!savedProfileByUserId.has(profile.userId)) savedProfileByUserId.set(profile.userId, profile);
    }

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

      const savedProfile = savedProfileByUserId.get(creatorUser.id);
      const pitch = await tx.pitch.create({
        data: {
          userId: creatorUser.id,
          campaignId,
          type: 'shortlisted',
          status: invitePitchStatus,
          isInvited: true,
          ...(savedProfile
            ? {
                selectedPlatform: savedProfile.platform,
                followerCount: savedProfile.followers != null ? String(savedProfile.followers) : null,
                engagementRate:
                  savedProfile.engagementRate != null ? formatEngagementRatePercent(savedProfile.engagementRate) : null,
              }
            : {}),
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
              round: 1,
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
  if (!memberships.length) return [];
  const result = await queryDiscoveryRows({}, { memberships });
  const rows = new Map(result.data.map((row) => [row.rowId, row]));
  return [...new Set(memberships.map((m) => `${m.creatorUserId}-${m.platform}`))]
    .map((id) => rows.get(id))
    .filter(Boolean);
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
