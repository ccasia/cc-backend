import { decryptToken, encryptToken } from '@helper/encrypt';
import axios, { get } from 'axios';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import {
  calculateAverageLikes,
  getAllMediaObject,
  getInstagramAccessToken,
  getInstagramBusinesssAccountId,
  getInstagramMediaData,
  getInstagramMedias,
  getInstagramOverviewService,
  getInstagramUserData,
  getMediaInsight,
  getPageId,
  getTikTokVideoById,
  refreshInstagramToken,
  refreshTikTokToken,
  getInstagramEngagementRateOverTime,
  getInstagramMonthlyInteractions,
  getTikTokEngagementRateOverTime,
  getTikTokMonthlyInteractions,
} from '@services/socialMediaService';
import { batchRequests } from '@helper/batchRequests';

// Type definitions
export interface UrlData {
  url: string;
  submissionId: string;
  userId: string;
  userName: string;
  platform: 'Instagram' | 'TikTok'; // Add platform identifier
}

export interface MetricData {
  name: string;
  value: number;
}

export type MetricsMap = Record<string, number>;

export interface Totals {
  views: number;
  likes: number;
  comments: number;
  saved: number;
  totalInteractions: number;
  reach: number;
  shares: number;
  postCount?: number;
}

export interface MetricComparison {
  current: number;
  average: number;
  change: number;
  isAboveAverage: boolean;
  changeText: string;
}

export type ComparisonResult = Record<string, MetricComparison>;

// const CODE_VERIFIER = 'your_unique_code_verifier';
// const CODE_CHALLENGE = 'SHA256_hash_of_code_verifier';

const prisma = new PrismaClient();

// Memory cache for campaign averages
const campaignAveragesCache = new Map();
const CAMPAIGN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const getCachedCampaignAverages = (campaignId: string, platform: string) => {
  const cacheKey = `${campaignId}_${platform}`;
  if (campaignAveragesCache.has(cacheKey)) {
    const cached = campaignAveragesCache.get(cacheKey);
    const isExpired = Date.now() - cached.timestamp > CAMPAIGN_CACHE_TTL;
    if (!isExpired) {
      console.log(`📦 Using cached campaign averages for ${platform} campaign ${campaignId}`);
      return cached.data;
    } else {
      campaignAveragesCache.delete(cacheKey);
    }
  }
  return null;
};

const setCachedCampaignAverages = (campaignId: string, platform: string, data: any) => {
  const cacheKey = `${campaignId}_${platform}`;
  campaignAveragesCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });

  // Clean old cache entries (keep max 50)
  if (campaignAveragesCache.size > 50) {
    const entries = Array.from(campaignAveragesCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, campaignAveragesCache.size - 50);
    toRemove.forEach(([key]) => campaignAveragesCache.delete(key));
  }
};

interface InstagramData {
  user_id: string;
  permissions: string[];
  encryptedToken: { iv: string; content: string };
  expires_in: string;
}

function extractInstagramShortcode(url: string) {
  const regex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function extractTikTokVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Handle different TikTok URL formats
    if (urlObj.hostname.includes('tiktok.com')) {
      // Format: https://www.tiktok.com/@username/video/1234567890
      if (urlObj.pathname.includes('/video/')) {
        const videoId = urlObj.pathname.split('/video/')[1].split('?')[0];
        return videoId;
      }

      // Format: https://www.tiktok.com/@username/photo/1234567890 (for photo posts)
      if (urlObj.pathname.includes('/photo/')) {
        const photoId = urlObj.pathname.split('/photo/')[1].split('?')[0];
        return photoId;
      }

      // Handle short URLs like vm.tiktok.com
      if (urlObj.hostname.includes('vm.tiktok.com')) {
        const shortCode = urlObj.pathname.substring(1); // Remove leading slash
        return shortCode;
      }

      // Handle mobile URLs like m.tiktok.com
      if (urlObj.hostname.includes('m.tiktok.com')) {
        if (urlObj.pathname.includes('/v/')) {
          const videoId = urlObj.pathname.split('/v/')[1].split('.html')[0];
          return videoId;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Invalid TikTok URL:', error);
    return null;
  }
}

// Connect account
export const tiktokAuthentication = (_req: Request, res: Response) => {
  const csrfState = Math.random().toString(36).substring(2);
  res.cookie('csrfState', csrfState, { maxAge: 60000 });

  let url = 'https://www.tiktok.com/v2/auth/authorize/';

  url += '?client_key=' + process.env.TIKTOK_CLIENT_KEY;
  url += '&scope=user.info.basic,user.info.profile,user.info.stats,video.list';
  url += '&response_type=code';
  url += '&redirect_uri=' + process.env.TIKTOK_REDIRECT_URI;
  url += '&state=' + csrfState;
  // url += '&code_challenge=' + CODE_VERIFIER;
  url += '&code_challenge_method=S256';

  res.send(url);
};

// Get refresh token and access token
export const redirectTiktokAfterAuth = async (req: Request, res: Response) => {
  const code = req.query.code;

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    const { access_token, refresh_token } = tokenResponse.data;

    const encryptedAccessToken = encryptToken(access_token);
    const encryptedRefreshToken = encryptToken(refresh_token);

    const creator = await prisma.creator.update({
      where: {
        userId: req.session.userid,
      },
      data: {
        tiktokData: { ...tokenResponse.data, access_token: encryptedAccessToken, refresh_token: encryptedRefreshToken },
        isTiktokConnected: true,
      },
      include: { tiktokUser: true },
    });

    if (access_token) {
      console.log('Fetching TikTok user info and videos...');
      
      const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: {
          fields: 'open_id, union_id, display_name, avatar_url, following_count, follower_count, likes_count',
        },
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const userData = userInfoResponse.data.data.user;
      console.log(`Fetched user info for: ${userData.display_name}`);

      let videos = [];
      try {
        const videoInfoResponse = await axios.post(
          'https://open.tiktokapis.com/v2/video/list/',
          { max_count: 20 },
          {
            params: {
              fields:
                'cover_image_url, id, title, video_description, duration, embed_link, embed_html, like_count, comment_count, share_count, view_count',
            },
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          },
        );

        videos = videoInfoResponse.data.data.videos || [];
        console.log(`✅ Fetched ${videos.length} TikTok videos`);
      } catch (videoError: any) {
        console.error('⚠️  Failed to fetch TikTok videos:', videoError.response?.data || videoError.message);
        // Continue without videos - user can reconnect later
      }

      await prisma.tiktokUser.upsert({
        where: {
          creatorId: creator.id,
        },
        update: {
          display_name: userData.display_name,
          avatar_url: userData.avatar_url,
          following_count: userData.following_count,
          follower_count: userData.follower_count,
          likes_count: userData.likes_count,
        },
        create: {
          creatorId: creator.id,
          display_name: userData.display_name,
          avatar_url: userData.avatar_url,
          following_count: userData.following_count,
          follower_count: userData.follower_count,
          likes_count: userData.likes_count,
        },
      });

      if (videos && videos.length > 0) {
        console.log(`📹 Processing ${videos.length} TikTok videos for ${userData.display_name}`);
        
        for (const video of videos) {
          await prisma.tiktokVideo.upsert({
            where: {
              video_id: video.id,
            },
            update: {
              cover_image_url: video.cover_image_url,
              title: video.title,
              description: video.video_description, // Fixed: was video.description
              duration: parseFloat(video.duration) || 0,
              embed_link: video.embed_link,
              embed_html: video.embed_html,
              like_count: video.like_count,
              comment_count: video.comment_count,
              share_count: video.share_count, // Fixed: was video.comment_count
              view_count: video.view_count,
            },
            create: {
              cover_image_url: video.cover_image_url,
              title: video.title,
              description: video.video_description, // Fixed: was video.description
              duration: parseFloat(video.duration) || 0,
              embed_link: video.embed_link,
              embed_html: video.embed_html,
              like_count: video.like_count,
              comment_count: video.comment_count,
              share_count: video.share_count, // Fixed: was video.comment_count
              view_count: video.view_count,
              tiktokUserId: creator.tiktokUser?.id,
              video_id: video.id,
            },
          });
        }
        
        console.log(`✅ Saved ${videos.length} TikTok videos to database`);
      } else {
        console.log('⚠️  No TikTok videos found or failed to fetch videos');
      }
    }

    res.redirect(process.env.REDIRECT_CLIENT as string);
  } catch (error) {
    console.error('Error during TikTok OAuth:', error.response?.data || error.message);
    res.status(500).send('Error during TikTok OAuth');
  }
};

// Get Tiktok Data
export const tiktokData = async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        creator: {
          select: {
            tiktokUser: {
              include: {
                tiktokVideo: true,
              },
            },
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    // let accessToken = (user.creator?.tiktokData as any)?.access_token;

    // accessToken = decryptToken(accessToken);

    // // Get user profile info
    // const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
    //   params: {
    //     fields: 'open_id, union_id, display_name, avatar_url, following_count, follower_count, likes_count',
    //   },
    //   headers: { Authorization: `Bearer ${accessToken}` },
    // });

    // // Get user video lists
    // const videoInfoResponse = await axios.post(
    //   'https://open.tiktokapis.com/v2/video/list/',
    //   { max_count: 20 },
    //   {
    //     params: {
    //       fields:
    //         'cover_image_url, id, title, video_description, duration, embed_link, embed_html, like_count, comment_count, share_count, view_count',
    //     },
    //     headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    //   },
    // );

    // const data = { user: userInfoResponse.data, videos: videoInfoResponse.data };

    return res.status(200).json(user);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const handleDisconnectTiktok = async (req: Request, res: Response) => {
  const { userId } = req.body;
  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: userId,
      },
    });

    if (!creator || !creator.isTiktokConnected)
      return res.status(404).json({ message: 'Creator is not linked to TikTok' });

    const accessToken = decryptToken((creator?.tiktokData as any)?.access_token);

    if (!accessToken) return res.status(404).json({ message: 'Access token not found.' });

    await axios.post('https://open.tiktokapis.com/v2/oauth/revoke/', {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      token: accessToken,
    });

    const updatedCreator = await prisma.creator.update({
      where: {
        userId: creator.userId,
      },
      data: {
        isTiktokConnected: false,
        tiktokData: {},
      },
      include: {
        tiktokUser: true,
      },
    });

    await prisma.tiktokVideo.deleteMany({
      where: {
        tiktokUserId: updatedCreator.tiktokUser?.id,
      },
    });

    await prisma.tiktokUser.delete({
      where: {
        creatorId: creator.id,
      },
    });

    return res.status(200).json({ message: 'TikTok account disconnected successfully' });
  } catch (error) {
    return res.status(404).json(error);
  }
};

export const facebookAuthentication = (_req: Request, res: Response) => {
  const scopes = 'email,public_profile,pages_show_list,business_management,instagram_basic';
  const facebookLoginUrl = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${process.env.FACEBOOK_REDIRECT_URI}&response_type=code&scope=${scopes}&config_id=1804107983668617`;

  res.send(facebookLoginUrl);
};

export const redirectFacebookAuth = async (req: Request, res: Response) => {
  const code = req.query.code; // Facebook sends the code here

  try {
    if (!code || !req.session.userid) return res.status(400).json({ message: 'Bad requests' });

    // Exchange the code for an access token
    const response = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_CLIENT_SECRET,
        redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
        code: code,
      },
    });

    const { access_token } = response.data;

    // 60 days expiry
    const longLivedToken = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_CLIENT_SECRET,
        fb_exchange_token: access_token,
      },
    });

    await prisma.creator.update({
      where: {
        userId: req.session.userid,
      },
      data: {
        instagramData: {
          access_token: {
            value: encryptToken(longLivedToken?.data?.access_token),
            expiresAt: dayjs(longLivedToken?.data?.expires_in).format(),
          },
        },
        isFacebookConnected: true,
      },
    });

    // // Get User Info using the Access Token
    // const userInfo = await axios.get('https://graph.facebook.com/me', {
    //   params: {
    //     access_token: access_token,
    //     fields: 'id,name,email,picture', // You can choose which fields you want
    //   },
    // });

    // You can store the user info in the session or database here
    res.redirect(process.env.REDIRECT_CLIENT as string);
  } catch (error) {
    res.status(400).send('Error authenticating with Facebook');
  }
};

export const getUserInstagramData = async (req: Request, res: Response) => {
  const userId = req.session.userid || req.params.userId;
  const userContents = [];

  try {
    const data = await prisma.creator.findFirst({
      where: {
        userId: userId,
      },
    });

    const instagramData = data?.instagramData as any;

    const accessToken = decryptToken(instagramData?.access_token?.value);

    const pageId = await getPageId(accessToken);
    console.log(pageId);

    const instagramAccountId = await getInstagramBusinesssAccountId(accessToken, pageId);

    const userData: any = await getInstagramUserData(accessToken, instagramAccountId, [
      'followers_count',
      'follows_count',
      'media',
      'media_count',
    ]);

    const userMedia = userData.media.data || [];

    // for (const media of userMedia) {
    //   const response = await getInstagramMediaData(accessToken, media.id, [
    //     'comments_count',
    //     'like_count',
    //     'media_type',
    //     'media_url',
    //     'thumbnail_url',
    //   ]);

    //   console.log(response);

    //   // userContents.push(response);
    // }

    const userContents = await Promise.all(
      userMedia.map((media: { id: string }) =>
        getInstagramMediaData(accessToken, media.id, [
          'comments_count',
          'like_count',
          'media_type',
          'media_url',
          'thumbnail_url',
          'caption',
          'permalink',
        ]),
      ),
    );

    const compiledData = { user: userData, contents: userContents };

    return res.status(200).json(compiledData);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const handleDisconnectFacebook = async (req: Request, res: Response) => {
  const { userId } = req.body;
  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: userId,
      },
    });

    if (!creator || !creator.isFacebookConnected)
      return res.status(404).json({ message: 'Creator is not linked to Instagram' });

    const accessToken = decryptToken((creator?.instagramData as any)?.access_token?.value);

    if (!accessToken) return res.status(404).json({ message: 'Access token not found.' });

    const response = await axios.get(`https://graph.facebook.com/me`, {
      params: {
        fields: 'id',
        access_token: accessToken,
      },
    });

    await axios.delete(`https://graph.facebook.com/${response?.data?.id}/permissions`, {
      params: {
        access_token: accessToken,
      },
    });

    await prisma.creator.update({
      where: {
        userId: creator.userId,
      },
      data: {
        isFacebookConnected: false,
        instagramData: {},
      },
    });

    return res.status(200).json({ message: 'Instagram account disconnected successfully' });
  } catch (error) {
    console.log(error);
    return res.status(404).json(error);
  }
};

export const instagramCallback = async (req: Request, res: Response) => {
  const code = req.query.code;
  const userId = req.session.userid;

  if (!code) return res.status(404).json({ message: 'Code not found.' });
  if (!userId) return res.status(404).json({ message: 'Session Expired. Please log in again.' });

  try {
    // Long-lived token
    const data = await getInstagramAccessToken(code as string);

    const access_token = decryptToken(data.encryptedToken);

    const creator = await prisma.creator.update({
      where: {
        userId: userId,
      },
      data: {
        instagramData: data,
        isFacebookConnected: true, //Instagram
      },
    });

    const overview = await getInstagramOverviewService(access_token);

    const instagramUser = await prisma.instagramUser.upsert({
      where: {
        creatorId: creator.id,
      },
      update: {
        user_id: overview.user_id,
        followers_count: overview.followers_count,
        follows_count: overview.follows_count,
        media_count: overview.media_count,
        username: overview.username,
      },
      create: {
        user_id: overview.user_id,
        followers_count: overview.followers_count,
        follows_count: overview.follows_count,
        media_count: overview.media_count,
        username: overview.username,
        creatorId: creator.id,
      },
    });

    const medias = await getAllMediaObject(access_token, overview.user_id);

    for (const media of medias.sortedVideos) {
      await prisma.instagramVideo.upsert({
        where: {
          video_id: media.id,
        },
        update: {
          comments_count: media.comments_count,
          like_count: media.like_count,
          media_type: media.media_type,
          media_url: media.media_url,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
        },
        create: {
          comments_count: media.comments_count,
          like_count: media.like_count,
          media_type: media.media_type,
          media_url: media.media_url,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
          instagramUserId: instagramUser.id,
        },
      });
    }

    return res.status(200).redirect(process.env.REDIRECT_CLIENT as string);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getInstagramOverview = async (req: Request, res: Response) => {
  const userId = req.params.userId || req.session.userid;
  try {
    const user = await prisma.creator.findUnique({
      where: {
        userId: userId as string,
      },
      select: {
        instagramUser: {
          include: {
            instagramVideo: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    // const insta = user?.instagramData as any;

    // const access_token = decryptToken(insta.encryptedToken);

    // const overview = await getInstagramOverviewService(access_token);

    // const medias = await getAllMediaObject(access_token, overview.user_id);

    const average_like = calculateAverageLikes((user.instagramUser as any).instagramVideo);

    // const data = { user: { ...overview, average_like }, contents: [...medias.data] };
    // const data = Object.assign(user, { average_like });

    return res.status(200).json({ instagramUser: { ...user.instagramUser, average_like } });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const removeInstagramPermissions = async (req: Request, res: Response) => {
  const { userId, permissions } = req.params;

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: userId,
      },
    });

    if (!creator) return res.status(404).json({ message: 'User not found' });

    // const insta: InstagramData = creator.instagramData as unknown as InstagramData;

    // const access_token = decryptToken(insta.encryptedToken);

    // await revokeInstagramPermission(access_token);

    const updatedCreator = await prisma.creator.update({
      where: {
        id: creator.id,
      },
      data: {
        isFacebookConnected: false,
        instagramData: {},
      },
      select: {
        instagramUser: true,
      },
    });

    await prisma.instagramVideo.deleteMany({
      where: {
        instagramUserId: updatedCreator.instagramUser?.id,
      },
    });

    await prisma.instagramUser.delete({
      where: {
        id: updatedCreator.instagramUser?.id,
      },
    });

    return res.status(200).json({ message: 'Successfully revoke permission' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// V2 INSTAGRAM
export const handleInstagramCallback = async (req: Request, res: Response) => {
  const code = req.query.code;
  const userId = req.session.userid;

  if (!code) return res.status(404).json({ message: 'Code not found.' });
  if (!userId) return res.status(404).json({ message: 'Session Expired. Please log in again.' });

  try {
    const data = await getInstagramAccessToken(code as string);

    await prisma.$transaction(async (tx) => {
      const user = await tx.creator.findUnique({
        where: {
          userId: userId,
        },
      });

      if (!user) throw new Error('User not found');

      await tx.instagramUser.upsert({
        where: {
          creatorId: user.id,
        },
        update: {
          accessToken: data.encryptedToken,
          expiresIn: data.expires_in,
        },
        create: {
          accessToken: data.encryptedToken,
          expiresIn: data.expires_in,
          creatorId: user.id,
        },
      });

      await tx.creator.update({
        where: {
          id: user.id,
        },
        data: {
          isFacebookConnected: true,
        },
      });
    });

    return res.status(200).redirect(process.env.REDIRECT_CLIENT as string);
  } catch (error) {
    console.log(error);
    return res.status(400).json('Error authenticate instagram user');
  }
};

export const getInstagramMediaKit = async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) return res.status(400).json({ message: 'Missing parameter: userId' });

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        userId: userId as string,
      },
      include: {
        instagramUser: true,
      },
    });

    if (!creator) return res.status(404).json({ message: 'Creator not found' });

    if (!creator.isFacebookConnected) {
      return res.status(400).json({ message: 'Creator is not connected to instagram account' });
    }

    if (dayjs().isAfter(dayjs.unix(creator?.instagramUser?.expiresIn!))) {
      return res.status(400).json({ message: 'Instagram Token expired' });
    }

    const encryptedAccessToken = creator.instagramUser?.accessToken;
    if (!encryptedAccessToken) {
      return res.status(404).json({ message: 'Access token not found' });
    }

    const accessToken = decryptToken(encryptedAccessToken as any);
    // const accessToken = 'IGAAIGNU09lZBhBZAE9OSDE4VWVja1BhZA2pMOWkzVG9nTkJVWnZA0QkhKMlFXdTBVbW1fS0tUQWl5RE1BQTY4N0ktODhUQjRIU1RWQ1hBcHdmbWdUSTlBOVE2QVBELXN1azQzNFhSZA2dBWi1PVjhWaUxmaWZAMekl4U2FMMWJLWDk5awZDZD';

    const overview = await getInstagramOverviewService(accessToken);
    const medias = await getAllMediaObject(accessToken, overview.user_id, overview.media_count);

    // Get analytics data for charts with error handling
    let analytics: {
      engagementRates: number[];
      months: string[];
      monthlyInteractions: { month: string; interactions: number }[];
    } = {
      engagementRates: [],
      months: [],
      monthlyInteractions: [],
    };

    try {
      const engagementAnalytics = await getInstagramEngagementRateOverTime(accessToken);
      const monthlyAnalytics = await getInstagramMonthlyInteractions(accessToken);

      analytics = {
        engagementRates: engagementAnalytics.engagementRates,
        months: engagementAnalytics.months,
        monthlyInteractions: monthlyAnalytics.monthlyData,
      };
    } catch (analyticsError) {
      console.error('Failed to fetch Instagram analytics:', analyticsError);
      // analytics remains as empty arrays - frontend will use fallback
    }

    const instagramUser = await prisma.instagramUser.upsert({
      where: {
        creatorId: creator.id,
      },
      update: {
        followers_count: overview.followers_count,
        follows_count: overview.follows_count,
        media_count: overview.media_count,
        totalLikes: medias.totalLikes,
        totalComments: medias.totalComments,
        averageLikes: medias.averageLikes,
        averageComments: medias.averageComments,
        username: overview.username,
      },
      create: {
        creatorId: creator.id,
        followers_count: overview.followers_count,
        follows_count: overview.follows_count,
        media_count: overview.media_count,
        username: overview.username,
        totalLikes: medias.totalLikes,
        totalComments: medias.totalComments,
        averageLikes: medias.averageLikes,
        averageComments: medias.averageComments,
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.creator.update({
        where: {
          id: creator.id,
        },
        data: {
          instagram: instagramUser.username,
        },
      });
    });

    for (const media of medias.sortedVideos) {
      await prisma.instagramVideo.upsert({
        where: {
          video_id: media.id,
        },
        update: {
          comments_count: media.comments_count,
          like_count: media.like_count,
          media_type: media.media_type,
          media_url: media.media_url,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
          datePosted: dayjs(media.timestamp).toDate(),
          shortCode: media.shortcode,
        },
        create: {
          comments_count: media.comments_count,
          like_count: media.like_count,
          media_type: media.media_type,
          media_url: media.media_url,
          thumbnail_url: media.thumbnail_url,
          caption: media.caption,
          permalink: media.permalink,
          shortCode: media.shortcode,
          datePosted: dayjs(media.timestamp).toDate(),
          instagramUserId: instagramUser.id,
        },
      });
    }

    return res.status(200).json({ instagramUser, medias, creator });

    // return res.status(200).json({
    //   overview,
    //   medias,
    //   analytics,
    // });
  } catch (error) {
    console.error('Error in getInstagramMediaKit:', error);
    return res.status(400).json(error);
  }
};

export const getTikTokMediaKit = async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) return res.status(404).json({ message: 'Parameter missing: userId' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creator: {
          include: {
            tiktokUser: {
              include: {
                tiktokVideo: true,
              },
            },
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.creator) return res.status(404).json({ message: 'Creator profile not found' });

    // Use the helper function to ensure we have a valid token
    let accessToken: string;
    try {
      accessToken = await ensureValidTikTokToken(user.id);
    } catch (tokenError) {
      console.error('TikTok token error:', tokenError.message);
      return res.status(400).json({
        message: tokenError.message,
        requiresReconnection: true,
      });
    }

    // Get TikTok user profile overview
    const overviewRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: {
        fields: 'open_id,union_id,display_name,username,avatar_url,following_count,follower_count,likes_count',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const overview = overviewRes.data.data.user;

    // Get TikTok videos data
    let videosRes;
    try {
      videosRes = await axios.post(
        'https://open.tiktokapis.com/v2/video/list/',
        { max_count: 20 },
        {
          params: {
            fields:
              'id,title,video_description,duration,cover_image_url,embed_link,embed_html,like_count,comment_count,share_count,view_count,create_time',
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (videoError: any) {
      console.error('TikTok video list API error:', {
        status: videoError.response?.status,
        statusText: videoError.response?.statusText,
        data: videoError.response?.data,
        message: videoError.message,
      });

      // If it's a permission error, the user might need to reconnect
      if (videoError.response?.status === 403 || videoError.response?.status === 401) {
        throw new Error('TikTok permissions expired. Please reconnect your TikTok account.');
      }

      // For other errors, continue with empty videos array
      videosRes = { data: { data: { videos: [] } } };
    }

    const videos = videosRes.data.data?.videos || [];

    // Map TikTok API fields to expected frontend fields
    const mappedVideos = videos.map((video: any) => ({
      ...video,
      // Ensure we have the fields the frontend expects
      like: video.like_count || 0,
      comment: video.comment_count || 0,
      share: video.share_count || 0,
      view: video.view_count || 0,
      // Keep original fields for compatibility
      like_count: video.like_count || 0,
      comment_count: video.comment_count || 0,
      share_count: video.share_count || 0,
      view_count: video.view_count || 0,
    }));

    // Debug logging for staging
    console.log('TikTok API Response:', {
      status: videosRes.status,
      videosCount: videos.length,
      hasData: !!videosRes.data.data,
      responseStructure: {
        hasVideos: !!videosRes.data.data?.videos,
        videosType: typeof videosRes.data.data?.videos,
        videosLength: videosRes.data.data?.videos?.length,
      },
    });

    // Calculate analytics from videos
    const totalLikes = mappedVideos.reduce((sum: number, video: any) => sum + (video.like_count || 0), 0);
    const totalComments = mappedVideos.reduce((sum: number, video: any) => sum + (video.comment_count || 0), 0);
    const totalShares = mappedVideos.reduce((sum: number, video: any) => sum + (video.share_count || 0), 0);
    const totalViews = mappedVideos.reduce((sum: number, video: any) => sum + (video.view_count || 0), 0);

    const averageLikes = mappedVideos.length > 0 ? totalLikes / mappedVideos.length : 0;
    const averageComments = mappedVideos.length > 0 ? totalComments / mappedVideos.length : 0;
    const averageShares = mappedVideos.length > 0 ? totalShares / mappedVideos.length : 0;
    const averageViews = mappedVideos.length > 0 ? totalViews / mappedVideos.length : 0;

    // Get analytics data for charts with error handling
    let analytics: {
      engagementRates: number[];
      months: string[];
      monthlyInteractions: { month: string; interactions: number }[];
    } = {
      engagementRates: [],
      months: [],
      monthlyInteractions: [],
    };

    try {
      const engagementAnalytics = await getTikTokEngagementRateOverTime(accessToken);
      const monthlyAnalytics = await getTikTokMonthlyInteractions(accessToken);

      analytics = {
        engagementRates: engagementAnalytics.engagementRates,
        months: engagementAnalytics.months,
        monthlyInteractions: monthlyAnalytics.monthlyData,
      };
    } catch (analyticsError) {
      console.error('Failed to fetch TikTok analytics:', analyticsError);
      // analytics remains as empty arrays - frontend will use fallback
    }

    // Calculate engagement rate using the calculated values
    // TikTok Engagement Rate Formula: (Average Likes + Average Comments + Average Shares) / Followers × 100
    const engagement_rate = overview.follower_count
      ? ((averageLikes + averageComments + averageShares) / overview.follower_count) * 100
      : 0;

    // Update TikTok user data in database
    await prisma.tiktokUser.upsert({
      where: { creatorId: user.creator.id },
      update: {
        display_name: overview.display_name,
        username: overview.username,
        avatar_url: overview.avatar_url,
        following_count: overview.following_count,
        follower_count: overview.follower_count,
        likes_count: overview.likes_count,
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalShares: totalShares,
        averageLikes: averageLikes,
        averageComments: averageComments,
        averageShares: averageShares,
        engagement_rate: engagement_rate,
        lastUpdated: new Date(),
      } as any,
      create: {
        creatorId: user.creator.id,
        display_name: overview.display_name,
        username: overview.username,
        avatar_url: overview.avatar_url,
        following_count: overview.following_count,
        follower_count: overview.follower_count,
        likes_count: overview.likes_count,
        totalLikes: totalLikes,
        totalComments: totalComments,
        totalShares: totalShares,
        averageLikes: averageLikes,
        averageComments: averageComments,
        averageShares: averageShares,
        engagement_rate: engagement_rate,
        lastUpdated: new Date(),
      } as any,
    });

    await prisma.$transaction(async (tx) => {
      await tx.creator.update({
        where: {
          id: user.creator!.id,
        },
        data: {
          tiktok: overview.username,
        },
      });
    });

    // Prepare response data structure similar to Instagram
    const responseData = {
      overview: {
        display_name: overview.display_name,
        username: overview.username,
        follower_count: overview.follower_count,
        following_count: overview.following_count,
        likes_count: overview.likes_count,
      },
      medias: {
        sortedVideos: mappedVideos.slice(0, 5), // Top 5 videos for display
        averageLikes: Math.round(averageLikes),
        averageComments: Math.round(averageComments),
        averageShares: Math.round(averageShares),
        averageViews: Math.round(averageViews),
        totalLikes,
        totalComments,
        totalShares,
        totalViews,
      },
      analytics: analytics,
      tiktokUser: {
        display_name: overview.display_name,
        username: overview.username,
        follower_count: overview.follower_count,
        engagement_rate: engagement_rate,
        following_count: overview.following_count,
        likes_count: overview.likes_count,
      },
    };

    // Debug logging for response data
    console.log('TikTok Response Data Structure:', {
      sortedVideosCount: responseData.medias.sortedVideos.length,
      totalVideos: mappedVideos.length,
    });

    return res.status(200).json(responseData);
  } catch (error: any) {
    console.error('Error in getTikTokMediaKit:', error);
    return res.status(400).json({
      message: 'Failed to get TikTok media kit data',
      error: error.message,
    });
  }
};

async function getCampaignSubmissionUrls(campaignId: string): Promise<UrlData[]> {
  try {
    const submissions = await prisma.submission.findMany({
      where: {
        campaignId: campaignId,
        status: 'POSTED',
      },
      select: {
        id: true,
        userId: true,
        content: true,
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    const allUrls: UrlData[] = [];
    submissions.forEach((submission) => {
      if (submission.content) {
        // Instagram URL regex
        const instagramUrlRegex = /https?:\/\/(www\.)?instagram\.com\/[^\s]+/g;
        const instagramUrls = submission.content.match(instagramUrlRegex);

        // TikTok URL regex - handles multiple formats
        const tiktokUrlRegex = /https?:\/\/(www\.)?(vm\.|m\.)?tiktok\.com\/[^\s]+/g;
        const tiktokUrls = submission.content.match(tiktokUrlRegex);

        // Process Instagram URLs
        if (instagramUrls && instagramUrls.length > 0) {
          instagramUrls.forEach((url) => {
            const cleanUrl = url.replace(/[.,;!?]+$/, '');
            allUrls.push({
              url: cleanUrl,
              submissionId: submission.id,
              userId: submission.userId,
              userName: submission.user.name || '',
              platform: 'Instagram', // Add platform identifier
            });
          });
        }

        // Process TikTok URLs
        if (tiktokUrls && tiktokUrls.length > 0) {
          tiktokUrls.forEach((url) => {
            const cleanUrl = url.replace(/[.,;!?]+$/, '');
            allUrls.push({
              url: cleanUrl,
              submissionId: submission.id,
              userId: submission.userId,
              userName: submission.user.name || '',
              platform: 'TikTok', // Add platform identifier
            });
          });
        }
      }
    });

    console.log(`Extracted ${allUrls.length} URLs from campaign ${campaignId}`);

    return allUrls;
  } catch (error) {
    console.error('Error fetching campaign submissions:', error);
    return [];
  }
}

// Helper function to calculate campaign averages
function calculateCampaignAverages(campaignInsights: MetricData[][]): Totals {
  if (campaignInsights.length === 0) {
    return {
      views: 0,
      likes: 0,
      comments: 0,
      saved: 0,
      totalInteractions: 0,
      reach: 0,
      shares: 0,
      postCount: 0,
    };
  }

  const totals: Totals = {
    views: 0,
    likes: 0,
    comments: 0,
    saved: 0,
    totalInteractions: 0,
    reach: 0,
    shares: 0,
  };

  campaignInsights.forEach((insight) => {
    const metricsMap: MetricsMap = {};
    insight.forEach((metric: MetricData) => {
      metricsMap[metric.name] = metric.value || 0;
    });

    totals.views += metricsMap['views'] || 0;
    totals.likes += metricsMap['likes'] || 0;
    totals.comments += metricsMap['comments'] || 0;
    totals.saved += metricsMap['saved'] || 0;
    totals.totalInteractions += metricsMap['total_interactions'] || 0;
    totals.reach += metricsMap['reach'] || 0;
    totals.shares += metricsMap['shares'] || 0;
  });

  const count = campaignInsights.length;
  return {
    views: Math.round(totals.views / count),
    likes: Math.round(totals.likes / count),
    comments: Math.round(totals.comments / count),
    saved: Math.round(totals.saved / count),
    totalInteractions: Math.round(totals.totalInteractions / count),
    reach: Math.round(totals.reach / count),
    shares: Math.round(totals.shares / count),
    postCount: count,
  };
}

// Helper function to compare current post with campaign averages
function calculateCampaignComparison(
  currentInsight: MetricData[],
  campaignAverages: Totals,
  campaignPostsCount = 0,
): ComparisonResult {
  const currentMetricsMap: MetricsMap = {};
  currentInsight.forEach((metric) => {
    currentMetricsMap[metric.name] = metric.value || 0;
  });

  const currentMetrics: Totals = {
    views: currentMetricsMap['views'] || 0,
    likes: currentMetricsMap['likes'] || 0,
    comments: currentMetricsMap['comments'] || 0,
    saved: currentMetricsMap['saved'] || 0,
    totalInteractions: currentMetricsMap['total_interactions'] || 0,
    reach: currentMetricsMap['reach'] || 0,
    shares: currentMetricsMap['shares'] || 0,
  };

  const comparison: ComparisonResult = {};
  (Object.keys(currentMetrics) as (keyof Totals)[]).forEach((metric) => {
    const current = currentMetrics[metric] || 0;
    const average = campaignAverages[metric] || 0;
    const change = average > 0 ? ((current - average) / average) * 100 : current > 0 ? 100 : 0;

    comparison[metric] = {
      current,
      average,
      change,
      isAboveAverage: change > 0,
      changeText: `${change > 0 ? '+' : ''}${change.toFixed(0)}%`,
    };
  });

  return comparison;
}

async function ensureValidInstagramToken(userId: string): Promise<string> {
  const creator = await prisma.creator.findFirst({
    where: {
      userId: userId,
    },
    include: {
      instagramUser: true,
    },
  });

  if (!creator) throw new Error('Creator not found');
  if (!creator.isFacebookConnected || !creator.instagramUser) {
    throw new Error('Creator is not connected to instagram account');
  }

  const encryptedAccessToken = creator.instagramUser?.accessToken;
  if (!encryptedAccessToken) throw new Error('Access token not found');

  let accessToken = decryptToken(encryptedAccessToken as any);

  // Check if token is expired
  const isExpired = dayjs().isAfter(dayjs.unix(creator.instagramUser.expiresIn!));

  if (isExpired) {
    console.log('Instagram token expired, attempting refresh...');

    try {
      // Refresh the token using the existing service
      const refreshedTokenData = await refreshInstagramToken(accessToken);

      // Encrypt the new token
      const newEncryptedAccessToken = encryptToken(refreshedTokenData.access_token);

      // Calculate new expiry time
      const currentTime = dayjs();
      const newExpiryTime = currentTime.add(refreshedTokenData.expires_in, 'second').unix();

      // Update the database with new token
      await prisma.instagramUser.update({
        where: {
          creatorId: creator.id,
        },
        data: {
          accessToken: newEncryptedAccessToken,
          expiresIn: newExpiryTime,
        },
      });

      accessToken = refreshedTokenData.access_token;
      console.log('Instagram token refreshed successfully');
    } catch (refreshError) {
      console.error('Failed to refresh Instagram token:', refreshError);
      throw new Error('Instagram token expired and refresh failed. Please reconnect your Instagram account.');
    }
  }

  return accessToken;
}

export const getInstagramMediaInsight = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { url, campaignId } = req.query; // Added campaignId parameter

  if (!userId) return res.status(404).json({ message: 'Parameter missing: userId' });
  if (!url) return res.status(404).json({ message: 'Query missing: url' });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Use the helper function to ensure we have a valid token
    let accessToken: string;
    try {
      accessToken = await ensureValidInstagramToken(user.id);
    } catch (tokenError) {
      return res.status(400).json({
        message: tokenError.message,
        requiresReconnection: tokenError.message.includes('refresh failed'),
      });
    }

    // Get creator info for media count
    const creator = await prisma.creator.findFirst({
      where: {
        userId: user.id,
      },
      select: {
        instagramUser: true,
      },
    });

    const { videos } = await getInstagramMedias(accessToken, creator?.instagramUser?.media_count as number);

    const shortCode = extractInstagramShortcode(url as string);

    const video = videos.find((item: any) => item?.shortcode === shortCode);

    if (!video) {
      console.error('Shortcode not found:', { shortCode, url, videoCount: videos.length });

      return res.status(404).json({
        message: `This is the url shortcode: ${shortCode} but we can't find the video. This post might not belong to the connected Instagram account.`,
        shortCode,
        url,
        videoCount: videos.length,
      });
    }

    // Get current post insight
    const insight = await getMediaInsight(accessToken, video?.id);

    // Campaign averages calculation
    let campaignAverages = null;
    let campaignComparison = null;
    let campaignPostsCount = 0;

    if (campaignId) {
      console.log(`🎯 Calculating campaign averages for campaign: ${campaignId}`);

      // Check cache first
      const cachedAverages = getCachedCampaignAverages(campaignId as string, 'Instagram');
      if (cachedAverages) {
        campaignAverages = cachedAverages.averages;
        campaignPostsCount = cachedAverages.postsCount;
        campaignComparison = calculateCampaignComparison(insight, campaignAverages, campaignPostsCount);
        console.log('Using cached campaign averages:', campaignAverages);
      } else {
        try {
          // Get all campaign submission URLs (now includes both Instagram and TikTok)
          const campaignUrls = await getCampaignSubmissionUrls(campaignId as string);
          // Filter for Instagram URLs only
          const instagramUrls = campaignUrls.filter((urlData) => urlData.platform === 'Instagram');
          console.log(
            `📊 Found ${instagramUrls.length} Instagram campaign URLs out of ${campaignUrls.length} total URLs`,
          );

          if (instagramUrls.length > 0) {
            // Process each campaign URL to get insights
            const campaignInsightsResults = await batchRequests(
              instagramUrls,
              async (urlData, index) => {
                const campaignShortCode = extractInstagramShortcode(urlData.url);
                if (!campaignShortCode) return null;

                const campaignVideo = videos.find((item: any) => item?.shortcode === campaignShortCode);
                if (!campaignVideo) return null;

                try {
                  const campaignInsight = await getMediaInsight(accessToken, campaignVideo.id);
                  return campaignInsight && campaignInsight.length > 0 ? campaignInsight : null;
                } catch (error) {
                  console.error(`Error processing campaign URL ${urlData.url}:`, error);
                  return null;
                }
              },
              3, // Process 2 at a time
              1200, // 800ms delay between batches
            );

            const campaignInsights = campaignInsightsResults
              .filter((result) => result.status === 'fulfilled' && result.value !== null)
              .map((result) => result.value);

            console.log(`📈 Successfully processed ${campaignInsights.length} campaign posts`);
            campaignPostsCount = campaignInsights.length;

            // Calculate averages (reusing existing function)
            if (campaignInsights.length > 0) {
              campaignAverages = calculateCampaignAverages(campaignInsights);

              // Cache the result
              setCachedCampaignAverages(campaignId as string, 'Instagram', {
                averages: campaignAverages,
                postsCount: campaignPostsCount,
              });

              // Compare current post with campaign averages (reusing existing function)
              campaignComparison = calculateCampaignComparison(insight, campaignAverages, campaignInsights.length);

              console.log('Campaign averages calculated and cached:', campaignAverages);
            }
          }
        } catch (error) {
          console.error('Error calculating campaign averages:', error);
          // Continue without campaign data if there's an error
        }
      }
    }

    // Enhanced response with campaign data only
    const response = {
      insight,
      video,
      // Campaign comparison data
      campaignAverages: campaignAverages,
      campaignComparison: campaignComparison,
      campaignPostsCount: campaignPostsCount,
      hasCampaignData: !!campaignAverages,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

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

export const getTikTokVideoInsight = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { url, campaignId } = req.query;

  if (!userId) return res.status(404).json({ message: 'Parameter missing: userId' });
  if (!url) return res.status(404).json({ message: 'Query missing: url' });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Use the helper function to ensure we have a valid token
    let accessToken: string;
    try {
      accessToken = await ensureValidTikTokToken(user.id);
    } catch (tokenError) {
      return res.status(400).json({
        message: tokenError.message,
        requiresReconnection: true,
      });
    }

    // Test the token to make sure it's working
    try {
      const testResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: {
          fields: 'open_id,display_name',
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (testError) {
      console.error('Token test failed even after refresh:', testError.response?.status, testError.response?.data);
      return res.status(400).json({
        message: 'TikTok token is invalid. Please reconnect your TikTok account.',
        requiresReconnection: true,
        error: testError.response?.data,
      });
    }

    // Extract video ID from URL
    const videoId = extractTikTokVideoId(url as string);
    console.log('Extracted video ID:', videoId);

    if (!videoId) {
      return res.status(400).json({ message: 'Invalid TikTok URL or unable to extract video ID' });
    }

    // Fetch the current video
    const videoResponse = await getTikTokVideoById(accessToken, videoId);
    const videos = videoResponse?.data?.videos;

    if (!videos || videos.length === 0) {
      return res.status(404).json({ message: 'Video not found or not accessible' });
    }

    const video = videos[0];

    // Format the response similar to Instagram
    const formattedVideo = {
      id: video.id,
      title: video.title,
      description: video.video_description,
      media_url: video.cover_image_url,
      cover_image_url: video.cover_image_url,
      embed_link: video.embed_link,
      embed_html: video.embed_html,
      duration: video.duration,
      like_count: video.like_count,
      comment_count: video.comment_count,
      share_count: video.share_count,
      view_count: video.view_count,
      timestamp: video.create_time,
    };

    // Create insight-like data from available metrics
    const insight = [
      { name: 'views', value: video.view_count || 0 },
      { name: 'likes', value: video.like_count || 0 },
      { name: 'comments', value: video.comment_count || 0 },
      { name: 'shares', value: video.share_count || 0 },
      {
        name: 'total_interactions',
        value: (video.like_count || 0) + (video.comment_count || 0) + (video.share_count || 0),
      },
    ];

    // Campaign averages calculation
    let campaignAverages = null;
    let campaignComparison = null;
    let campaignPostsCount = 0;

    if (campaignId) {
      console.log(`🎯 Calculating TikTok campaign averages for campaign: ${campaignId}`);

      // Check cache first
      const cachedAverages = getCachedCampaignAverages(campaignId as string, 'TikTok');
      if (cachedAverages) {
        campaignAverages = cachedAverages.averages;
        campaignPostsCount = cachedAverages.postsCount;
        campaignComparison = calculateCampaignComparison(insight, campaignAverages, campaignPostsCount);
        console.log('Using cached TikTok campaign averages:', campaignAverages);
      } else {
        try {
          // Get all campaign submission URLs (now includes both Instagram and TikTok)
          const campaignUrls = await getCampaignSubmissionUrls(campaignId as string);
          // Filter for TikTok URLs only
          const tiktokUrls = campaignUrls.filter((urlData) => urlData.platform === 'TikTok');
          console.log(`📊 Found ${tiktokUrls.length} TikTok campaign URLs out of ${campaignUrls.length} total URLs`);

          if (tiktokUrls.length > 0) {
            // Process each campaign URL to get insights
            const campaignInsightsResults = await batchRequests(
              tiktokUrls,
              async (urlData, index) => {
                const campaignVideoId = extractTikTokVideoId(urlData.url);
                if (!campaignVideoId) return null;

                try {
                  const campaignVideoResponse = await getTikTokVideoById(accessToken, campaignVideoId);
                  const campaignVideos = campaignVideoResponse?.data?.videos;

                  if (!campaignVideos || campaignVideos.length === 0) return null;

                  const campaignVideo = campaignVideos[0];

                  // Create insight data from campaign video metrics
                  const campaignInsight = [
                    { name: 'views', value: campaignVideo.view_count || 0 },
                    { name: 'likes', value: campaignVideo.like_count || 0 },
                    {
                      name: 'comments',
                      value: campaignVideo.comment_count || 0,
                    },
                    { name: 'shares', value: campaignVideo.share_count || 0 },
                    {
                      name: 'total_interactions',
                      value:
                        (campaignVideo.like_count || 0) +
                        (campaignVideo.comment_count || 0) +
                        (campaignVideo.share_count || 0),
                    },
                  ];

                  return campaignInsight;
                } catch (error) {
                  console.error(`Error processing TikTok campaign URL ${urlData.url}:`, error);
                  return null;
                }
              },
              2, // Process 2 at a time
              1200, // 1200ms delay between batches for TikTok
            );

            const campaignInsights = campaignInsightsResults
              .filter((result) => result.status === 'fulfilled' && result.value !== null)
              .map((result) => result.value);

            console.log(`📈 Successfully processed ${campaignInsights.length} TikTok campaign posts`);
            campaignPostsCount = campaignInsights.length;

            // Calculate averages (reusing existing function)
            if (campaignInsights.length > 0) {
              campaignAverages = calculateCampaignAverages(campaignInsights);

              // Cache the result
              setCachedCampaignAverages(campaignId as string, 'TikTok', {
                averages: campaignAverages,
                postsCount: campaignPostsCount,
              });

              // Compare current post with campaign averages (reusing existing function)
              campaignComparison = calculateCampaignComparison(insight, campaignAverages, campaignInsights.length);

              console.log('TikTok Campaign averages calculated and cached:', campaignAverages);
            }
          }
        } catch (error) {
          console.error('Error calculating TikTok campaign averages:', error);
          // Continue without campaign data if there's an error
        }
      }
    }

    // Enhanced response with campaign data
    const response = {
      video: formattedVideo,
      insight,
      // Campaign comparison data
      campaignAverages: campaignAverages,
      campaignComparison: campaignComparison,
      campaignPostsCount: campaignPostsCount,
      hasCampaignData: !!campaignAverages,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error getting TikTok video insight:', error);
    return res.status(400).json({
      message: 'Failed to get TikTok video insight',
      error: error.message,
    });
  }
};

