import { decryptToken, encryptToken } from '@helper/encrypt';
import { PrismaClient } from '@prisma/client';
import {
  getInstagramMedias,
  getMediaInsight,
  refreshInstagramToken,
  refreshTikTokToken,
  getTikTokVideoById,
} from '@services/socialMediaService';
import axios from 'axios';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export interface BatchRequestConfig {
  platform: 'Instagram' | 'TikTok';
  requests: Array<{
    mediaId?: string;
    shortCode?: string;
    userId: string;
    campaignId?: string;
  }>;
  batchSize?: number;
  delayMs?: number;
}

export interface BatchInsightResult {
  mediaId?: string;
  shortCode?: string;
  userId: string;
  platform: 'Instagram' | 'TikTok';
  insight: any;
  timestamp: Date;
  error?: string;
}

/**
 * Unified batching across both platforms
 * Respects rate limits and uses consistent 3 concurrent, 200ms delay pattern
 */
export async function batchFetchInsights(
  config: BatchRequestConfig
): Promise<BatchInsightResult[]> {
  const { platform, requests, batchSize = 3, delayMs = 200 } = config;

  if (requests.length === 0) {
    console.log(`ℹ️  No requests to process for ${platform}`);
    return [];
  }

  console.log(
    `📦 Batch fetching ${requests.length} ${platform} insights (batch size: ${batchSize}, delay: ${delayMs}ms)`
  );

  const results: BatchInsightResult[] = [];

  // Split into batches
  for (let i = 0; i < requests.length; i += batchSize) {
    const batch = requests.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(requests.length / batchSize);

    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

    // Fetch batch concurrently using Promise.allSettled to capture all results
    const batchResults = await Promise.allSettled(
      batch.map((req) =>
        platform === 'Instagram' ? fetchInstagramInsight(req) : fetchTikTokInsight(req)
      )
    );

    // Process results
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const request = batch[j];

      if (result.status === 'fulfilled') {
        results.push({
          mediaId: request.mediaId || result.value.mediaId,
          shortCode: request.shortCode,
          userId: request.userId,
          platform,
          insight: result.value,
          timestamp: new Date(),
        });
        console.log(
          `✅ [${i + j + 1}/${requests.length}] ${platform} insight fetched for user ${request.userId}`
        );
      } else {
        results.push({
          mediaId: request.mediaId,
          shortCode: request.shortCode,
          userId: request.userId,
          platform,
          insight: null,
          timestamp: new Date(),
          error: result.reason?.message || 'Unknown error',
        });
        console.error(
          `❌ [${i + j + 1}/${requests.length}] Failed to fetch ${platform} insight for ${request.mediaId || request.shortCode}:`,
          result.reason?.message
        );
      }
    }

    // Delay between batches (except for last batch)
    if (i + batchSize < requests.length) {
      console.log(`⏱️  Waiting ${delayMs}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const successCount = results.filter((r) => !r.error).length;
  const errorCount = results.filter((r) => r.error).length;

  console.log(
    `\n✨ ${platform} batch complete: ${successCount} success, ${errorCount} errors\n`
  );

  return results;
}

/**
 * Fetch Instagram insight for a single post
 * Reuses existing socialMediaService functions
 */
async function fetchInstagramInsight(req: {
  mediaId?: string;
  shortCode?: string;
  userId: string;
  campaignId?: string;
}): Promise<any> {
  try {
    // 1. Get creator's Instagram user record + access token
    const creator = await prisma.creator.findUnique({
      where: { userId: req.userId },
      include: { instagramUser: true },
    });

    if (!creator?.instagramUser) {
      throw new Error(`No Instagram account linked for user ${req.userId}`);
    }

    if (!creator.isFacebookConnected) {
      throw new Error(`Instagram not connected for user ${req.userId}`);
    }

    // 2. Ensure valid access token (auto-refresh if needed)
    const accessToken = await ensureValidInstagramToken(req.userId);

    // 3. Get media ID from shortCode if needed
    let mediaId = req.mediaId;
    if (!mediaId && req.shortCode) {
      const instagramUser = creator.instagramUser;
      const { videos } = await getInstagramMedias(accessToken, instagramUser.media_count || 100);
      const video = videos.find((v: any) => v.shortcode === req.shortCode);
      mediaId = video?.id;

      if (!mediaId) {
        throw new Error(`Could not find media for shortcode ${req.shortCode}`);
      }
    }

    if (!mediaId) {
      throw new Error('No mediaId or shortCode provided');
    }

    // 4. Fetch insight metrics
    const insight = await getMediaInsight(accessToken, mediaId);

    return {
      mediaId,
      shortCode: req.shortCode,
      metrics: insight,
    };
  } catch (error: any) {
    console.error(
      `Instagram fetch error for user ${req.userId}, mediaId ${req.mediaId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Fetch TikTok insight for a single video
 * Reuses existing socialMediaService functions
 */
async function fetchTikTokInsight(req: {
  mediaId?: string;
  userId: string;
  campaignId?: string;
}): Promise<any> {
  try {
    // 1. Get creator's TikTok user record + access token
    const creator = await prisma.creator.findUnique({
      where: { userId: req.userId },
      include: { tiktokUser: true },
    });

    if (!creator?.tiktokUser) {
      throw new Error(`No TikTok account linked for user ${req.userId}`);
    }

    if (!creator.isTiktokConnected) {
      throw new Error(`TikTok not connected for user ${req.userId}`);
    }

    if (!req.mediaId) {
      throw new Error('No mediaId provided for TikTok video');
    }

    // 2. Ensure valid TikTok access token
    const accessToken = await ensureValidTikTokToken(req.userId);

    // 3. Fetch TikTok video data (includes metrics)
    const video = await getTikTokVideoById(accessToken, req.mediaId);

    // Extract the first video object from the response
    const videoObj = video?.data?.videos?.[0];
    if (!videoObj) {
      throw new Error(`No video data found for mediaId ${req.mediaId}`);
    }

    return {
      mediaId: req.mediaId,
      metrics: {
        view_count: videoObj.view_count || 0,
        like_count: videoObj.like_count || 0,
        comment_count: videoObj.comment_count || 0,
        share_count: videoObj.share_count || 0,
        download_count: videoObj.download_count || 0,
      },
    };
  } catch (error: any) {
    console.error(
      `TikTok fetch error for user ${req.userId}, mediaId ${req.mediaId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Ensure Instagram token is valid, refresh if expired
 * Copied from socialController.ts pattern
 */
async function ensureValidInstagramToken(userId: string): Promise<string> {
  const creator = await prisma.creator.findFirst({
    where: { userId },
    include: { instagramUser: true },
  });

  if (!creator) throw new Error('Creator not found');
  if (!creator.isFacebookConnected || !creator.instagramUser) {
    throw new Error('Creator is not connected to Instagram account');
  }

  const encryptedAccessToken = creator.instagramUser?.accessToken;
  if (!encryptedAccessToken) throw new Error('Access token not found');

  let accessToken = decryptToken(encryptedAccessToken as any);

  // Check if token is expired
  const isExpired = dayjs().isAfter(dayjs.unix(creator.instagramUser.expiresIn!));

  if (isExpired) {
    console.log(`🔄 Instagram token expired for user ${userId}, refreshing...`);

    try {
      // Refresh the token
      const refreshedTokenData = await refreshInstagramToken(accessToken);

      // Encrypt the new token
      const newEncryptedAccessToken = encryptToken(refreshedTokenData.access_token);

      // Calculate new expiry time (60 days from now)
      const currentTime = dayjs();
      const newExpiresIn = currentTime.add(60, 'day').unix();

      // Update in database
      await prisma.instagramUser.update({
        where: { creatorId: creator.id },
        data: {
          accessToken: newEncryptedAccessToken as any,
          expiresIn: newExpiresIn,
        },
      });

      accessToken = refreshedTokenData.access_token;
      console.log(`✅ Instagram token refreshed for user ${userId}`);
    } catch (error: any) {
      console.error(`❌ Failed to refresh Instagram token for user ${userId}:`, error.message);
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  return accessToken;
}

/**
 * Ensure TikTok token is valid, refresh if expired
 */
async function ensureValidTikTokToken(userId: string): Promise<string> {
  const creator = await prisma.creator.findFirst({
    where: {
      userId: userId,
    },
    select: {
      id: true,
      tiktokData: true,
      isTiktokConnected: true,
    },
  });

  if (!creator || !creator.isTiktokConnected || !creator.tiktokData) {
    throw new Error('Creator is not connected to TikTok account');
  }

  const tiktokData = creator.tiktokData as any;
  const encryptedAccessToken = tiktokData?.access_token;
  const encryptedRefreshToken = tiktokData?.refresh_token;
  const expiresIn = tiktokData?.expires_in;

  if (!encryptedAccessToken) {
    throw new Error('TikTok access token not found');
  }

  let accessToken = decryptToken(encryptedAccessToken);

  // Check if token is expired (if expires_in is available)
  const currentTime = Math.floor(Date.now() / 1000);
  const tokenExpired = expiresIn && currentTime >= expiresIn;

  if (tokenExpired || !accessToken) {
    console.log('TikTok token expired or invalid, attempting refresh...');

    if (!encryptedRefreshToken) {
      throw new Error('TikTok refresh token not found');
    }

    const refreshToken = decryptToken(encryptedRefreshToken);

    try {
      // Refresh the token
      const refreshedTokenData = await refreshTikTokToken(refreshToken);

      // Encrypt the new tokens
      const newEncryptedAccessToken = encryptToken(refreshedTokenData.access_token);
      const newEncryptedRefreshToken = encryptToken(refreshedTokenData.refresh_token);

      // Update the database with new tokens
      await prisma.creator.update({
        where: {
          id: creator.id,
        },
        data: {
          tiktokData: {
            ...tiktokData,
            access_token: newEncryptedAccessToken,
            refresh_token: newEncryptedRefreshToken,
            expires_in: refreshedTokenData.expires_in ? currentTime + refreshedTokenData.expires_in : null,
          },
        },
      });

      accessToken = refreshedTokenData.access_token;
      console.log('TikTok token refreshed successfully');
    } catch (refreshError) {
      console.error('Failed to refresh TikTok token:', refreshError);
      throw new Error('TikTok token expired and refresh failed. Please reconnect your TikTok account.');
    }
  }

  return accessToken;
}