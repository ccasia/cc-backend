import {
  ageRangeToBirthDateRange,
  extractHashtags,
  genderToPronounce,
  PlatformFilter,
} from '@helper/discovery/queryHelpers';

export const buildConnectedWhere = (
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

  const pronounce = genderToPronounce(filters.gender);
  const genderCondition = pronounce
    ? { creator: { is: { pronounce: { equals: pronounce, mode: 'insensitive' as const } } } }
    : undefined;

  const birthDateRange = ageRangeToBirthDateRange(filters.ageRange);
  const ageCondition = birthDateRange
    ? { creator: { is: { birthDate: { gte: birthDateRange.gte, lte: birthDateRange.lte } } } }
    : undefined;

  const countryCondition = filters.country
    ? { country: { equals: filters.country, mode: 'insensitive' as const } }
    : undefined;

  const cityCondition = filters.city ? { city: { equals: filters.city, mode: 'insensitive' as const } } : undefined;

  const creditTierCondition = filters.creditTier
    ? { creator: { is: { creditTier: { name: { equals: filters.creditTier, mode: 'insensitive' as const } } } } }
    : undefined;

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

  const keywordCondition =
    includeContentFilters && filters.keyword
      ? {
          OR: [
            { name: { contains: filters.keyword, mode: 'insensitive' as const } },
            { creator: { is: { instagram: { contains: filters.keyword, mode: 'insensitive' as const } } } },
            { creator: { is: { tiktok: { contains: filters.keyword, mode: 'insensitive' as const } } } },
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
    role: 'creator',
    creator: {
      is: {},
    },
    ...(searchOr ? { OR: searchOr } : {}),
    ...platformCondition,
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  } as any;
};

export const buildConnectedSelect = (includeAccessToken = false) => ({
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
