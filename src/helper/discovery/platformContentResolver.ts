import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMedias,
  getTikTokMediaObject,
} from '@services/socialMediaService';
import {
  getLatestInstagramCaptionsForMatch,
  getLatestTikTokTitlesForMatch,
  mapInstagramApiTopVideos,
  mapTikTokApiTopVideos,
} from '@helper/discovery/mediaHelpers';
import { matchesContentTerms } from '@helper/discovery/queryHelpers';
import { getCreatorTopVideosFromCacheOrFetch } from '@helper/discovery/topVideosCache';

export type TopVideosByCreator = Map<string, any[]>;

export type PlatformApiStats = {
  success: number;
  failed: number;
  rateLimitedSkips: number;
  dbFallback: number;
  cacheHits: number;
};

export type DiscoveryApiSummary = {
  context: 'content-search' | 'default';
  processedCreators: number;
  instagram: PlatformApiStats;
  tiktok: PlatformApiStats;
};

const createPlatformApiStats = (): PlatformApiStats => ({
  success: 0,
  failed: 0,
  rateLimitedSkips: 0,
  dbFallback: 0,
  cacheHits: 0,
});

export const createDiscoveryApiSummary = (context: 'content-search' | 'default'): DiscoveryApiSummary => ({
  context,
  processedCreators: 0,
  instagram: createPlatformApiStats(),
  tiktok: createPlatformApiStats(),
});

const isRateLimitError = (error: any) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  return status === 429 || code === 'rate_limit_exceeded';
};

const getDbTopVideosByLikes = (videos: any[]) =>
  (videos || [])
    .slice()
    .sort((a: any, b: any) => Number(b?.like_count || 0) - Number(a?.like_count || 0))
    .slice(0, 3);

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

export const resolvePlatformContentMatchesFromApi = async (
  rows: any[],
  options: { keywordTerm?: string; hashtagTerms: string[] },
  deps: {
    ensureValidTikTokAccessTokenForCreator: (creator: any) => Promise<string | null>;
  },
  config: { rateLimitState?: { instagram: boolean; tiktok: boolean } } = {},
) => {
  const matchesByCreator = new Map<string, { instagram: boolean; tiktok: boolean }>();
  const instagramTopVideosByCreator: TopVideosByCreator = new Map();
  const tiktokTopVideosByCreator: TopVideosByCreator = new Map();
  const rateLimitState = config.rateLimitState || { instagram: false, tiktok: false };
  const hasContentSearch = Boolean(options.keywordTerm || options.hashtagTerms?.length);
  const apiSummary = createDiscoveryApiSummary(hasContentSearch ? 'content-search' : 'default');
  apiSummary.processedCreators = (rows || []).length;

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
      const dbInstagramTopVideos = getDbTopVideosByLikes(dbInstagramVideos);
      const dbTikTokTopVideos = getDbTopVideosByLikes(dbTikTokVideos);
      const dbInstagramCaptions = getLatestInstagramCaptionsForMatch(dbInstagramVideos, 5);
      const dbTikTokCaptions = getLatestTikTokTitlesForMatch(dbTikTokVideos, 5);
      const keywordOnlyTexts = getCreatorKeywordOnlyTexts(row);
      const matchesCreatorContentTerms = (texts: string[]) =>
        matchesContentTerms(texts, {
          ...options,
          keywordOnlyTexts,
        });

      if (creator?.isFacebookConnected && creator?.instagramUser) {
        if (rateLimitState.instagram) {
          instagramMatched = matchesCreatorContentTerms(dbInstagramCaptions);
          instagramTopVideosByCreator.set(creatorId, dbInstagramTopVideos);
          apiSummary.instagram.rateLimitedSkips += 1;
        } else {
          try {
            const encryptedAccessToken = creator?.instagramUser?.accessToken;

            if (encryptedAccessToken) {
              const accessToken = decryptToken(encryptedAccessToken as any);
              const topVideosResult = await getCreatorTopVideosFromCacheOrFetch('instagram', creatorId, async () => {
                const instagramMediaResponse = await getInstagramMedias(accessToken);
                const videos = instagramMediaResponse?.videos || [];
                return mapInstagramApiTopVideos(videos || []);
              });

              const mappedVideos = topVideosResult.videos || [];
              const captions = (mappedVideos || []).map((video: any) => String(video?.caption || '')).slice(0, 5);

              instagramMatched = matchesCreatorContentTerms(captions);
              instagramTopVideosByCreator.set(creatorId, mappedVideos);
              apiSummary.instagram.success += 1;
              if (topVideosResult.source !== 'live') {
                apiSummary.instagram.cacheHits += 1;
              }
            } else {
              instagramMatched = matchesCreatorContentTerms(dbInstagramCaptions);
              instagramTopVideosByCreator.set(creatorId, dbInstagramTopVideos);
              apiSummary.instagram.dbFallback += 1;
            }
          } catch (error) {
            if (error?.response?.status === 400) {
              console.log('[Discovery][CreatorApi400]', {
                platform: 'instagram',
                creatorId,
                status: error?.response?.status,
                response: error?.response?.data || null,
                message: error?.message,
              });
            }
            if (isRateLimitError(error)) {
              rateLimitState.instagram = true;
              apiSummary.instagram.rateLimitedSkips += 1;
            }
            instagramMatched = matchesCreatorContentTerms(dbInstagramCaptions);
            instagramTopVideosByCreator.set(creatorId, dbInstagramTopVideos);
            apiSummary.instagram.failed += 1;
          }
        }
      }

      if (creator?.isTiktokConnected && creator?.tiktokUser) {
        if (rateLimitState.tiktok) {
          tiktokMatched = matchesCreatorContentTerms(dbTikTokCaptions);
          tiktokTopVideosByCreator.set(creatorId, dbTikTokTopVideos);
          apiSummary.tiktok.rateLimitedSkips += 1;
        } else {
          try {
            const accessToken = await deps.ensureValidTikTokAccessTokenForCreator(creator);

            if (accessToken) {
              const topVideosResult = await getCreatorTopVideosFromCacheOrFetch('tiktok', creatorId, async () => {
                const mediaObject = await getTikTokMediaObject(accessToken, 20);
                const videos = mediaObject?.videos || [];
                return mapTikTokApiTopVideos(videos);
              });

              const mappedVideos = topVideosResult.videos || [];
              const captions = (mappedVideos || []).map((video: any) => String(video?.title || '')).slice(0, 5);

              tiktokMatched = matchesCreatorContentTerms(captions);
              tiktokTopVideosByCreator.set(creatorId, mappedVideos);
              apiSummary.tiktok.success += 1;
              if (topVideosResult.source !== 'live') {
                apiSummary.tiktok.cacheHits += 1;
              }
            } else {
              tiktokMatched = matchesCreatorContentTerms(dbTikTokCaptions);
              tiktokTopVideosByCreator.set(creatorId, dbTikTokTopVideos);
              apiSummary.tiktok.dbFallback += 1;
            }
          } catch (error) {
            if (error?.response?.status === 400) {
              console.log('[Discovery][CreatorApi400]', {
                platform: 'tiktok',
                creatorId,
                status: error?.response?.status,
                response: error?.response?.data || null,
                message: error?.message,
              });
            }
            if (isRateLimitError(error)) {
              rateLimitState.tiktok = true;
              apiSummary.tiktok.rateLimitedSkips += 1;
            }
            tiktokMatched = matchesCreatorContentTerms(dbTikTokCaptions);
            tiktokTopVideosByCreator.set(creatorId, dbTikTokTopVideos);
            apiSummary.tiktok.failed += 1;
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
    apiSummary,
  };
};
