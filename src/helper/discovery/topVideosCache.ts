type TopVideosPlatform = 'instagram' | 'tiktok';

type CachedTopVideosEntry = {
  expiresAt: number;
  videos: any[];
};

const DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_TTL_MS = Number(
  process.env.DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_TTL_MS || 3 * 60 * 1000,
);
const DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES = Number(
  process.env.DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES || 6000,
);

const discoveryCreatorTopVideosCache = new Map<string, CachedTopVideosEntry>();
const discoveryCreatorTopVideosInFlight = new Map<string, Promise<any[]>>();

const getCreatorTopVideosCacheKey = (platform: TopVideosPlatform, creatorId: string) => `${platform}:${creatorId}`;

const pruneCreatorTopVideosCache = () => {
  if (discoveryCreatorTopVideosCache.size <= DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of discoveryCreatorTopVideosCache.entries()) {
    if (entry.expiresAt <= now) {
      discoveryCreatorTopVideosCache.delete(key);
    }
  }

  if (discoveryCreatorTopVideosCache.size <= DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES) {
    return;
  }

  const entriesByExpiry = Array.from(discoveryCreatorTopVideosCache.entries()).sort(
    (left, right) => left[1].expiresAt - right[1].expiresAt,
  );
  const overflow = discoveryCreatorTopVideosCache.size - DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES;

  for (let index = 0; index < overflow; index += 1) {
    const key = entriesByExpiry[index]?.[0];
    if (key) {
      discoveryCreatorTopVideosCache.delete(key);
    }
  }
};

const getCreatorTopVideosFromCache = (platform: TopVideosPlatform, creatorId: string): any[] | null => {
  const key = getCreatorTopVideosCacheKey(platform, creatorId);
  const cached = discoveryCreatorTopVideosCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    discoveryCreatorTopVideosCache.delete(key);
    return null;
  }

  return cached.videos;
};

const setCreatorTopVideosCache = (platform: TopVideosPlatform, creatorId: string, videos: any[]) => {
  const key = getCreatorTopVideosCacheKey(platform, creatorId);
  discoveryCreatorTopVideosCache.set(key, {
    expiresAt: Date.now() + DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_TTL_MS,
    videos: videos || [],
  });
  pruneCreatorTopVideosCache();
};

export const getCreatorTopVideosFromCacheOrFetch = async (
  platform: TopVideosPlatform,
  creatorId: string,
  fetcher: () => Promise<any[]>,
) => {
  const key = getCreatorTopVideosCacheKey(platform, creatorId);
  const cached = getCreatorTopVideosFromCache(platform, creatorId);
  if (cached) {
    return {
      videos: cached,
      source: 'cache' as const,
    };
  }

  const inFlight = discoveryCreatorTopVideosInFlight.get(key);
  if (inFlight) {
    const videos = await inFlight;
    return {
      videos,
      source: 'inflight' as const,
    };
  }

  const request = (async () => {
    const videos = await fetcher();
    setCreatorTopVideosCache(platform, creatorId, videos || []);
    return videos || [];
  })();

  discoveryCreatorTopVideosInFlight.set(key, request);

  try {
    const videos = await request;
    return {
      videos,
      source: 'live' as const,
    };
  } finally {
    discoveryCreatorTopVideosInFlight.delete(key);
  }
};
