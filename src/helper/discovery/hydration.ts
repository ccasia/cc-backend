import { decryptToken } from '@helper/encrypt';
import {
  getInstagramMediaObject,
  getInstagramOverviewService,
  getInstagramUserInsight,
  getTikTokMediaObject,
  getTikTokOverviewService,
  withCachedInstagramThumbnail,
} from '@services/socialMediaService';

export type TopVideosByCreator = Map<string, any[]>;

export const hydrateMissingInstagramData = async (
  rows: any[],
  deps: { prismaAny: any },
): Promise<TopVideosByCreator> => {
  const { prismaAny } = deps;
  const topVideosByCreator: TopVideosByCreator = new Map();

  const persistLatestInstagramVideos = async (instagramUserId: string, videos: any[]) => {
    const cachedVideos = await Promise.all(
      (videos || []).map((video: any) => withCachedInstagramThumbnail(video, instagramUserId)),
    );

    const topVideoIds = (cachedVideos || []).map((video: any) => video?.id).filter(Boolean);

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
      (cachedVideos || []).map(async (media: any) => {
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
        const overview = await getInstagramOverviewService(accessToken);
        const instagramUserIdForInsight = overview.user_id || instagramUser.user_id;
        const insight = await getInstagramUserInsight(accessToken, instagramUserIdForInsight);
        const medias = await getInstagramMediaObject(accessToken, instagramUserIdForInsight);

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

export const hydrateMissingTikTokData = async (
  rows: any[],
  deps: {
    prismaAny: any;
    ensureValidTikTokAccessTokenForCreator: (creator: any) => Promise<string | null>;
  },
): Promise<TopVideosByCreator> => {
  const { prismaAny, ensureValidTikTokAccessTokenForCreator } = deps;
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
        if (!creatorId) {
          return;
        }

        const accessToken = await ensureValidTikTokAccessTokenForCreator(creator);
        if (!accessToken) {
          return;
        }

        const overviewRes = await getTikTokOverviewService(accessToken);

        const overview = overviewRes?.data?.user || {};
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
      } catch (error) {}
    }),
  );

  return topVideosByCreator;
};
