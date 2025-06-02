import { decryptToken, encryptToken } from '@helper/encrypt';
import axios from 'axios';
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
} from '@services/socialMediaService';

// const CODE_VERIFIER = 'your_unique_code_verifier';
// const CODE_CHALLENGE = 'SHA256_hash_of_code_verifier';

const prisma = new PrismaClient();

interface InstagramData {
  user_id: string;
  permissions: string[];
  encryptedToken: { iv: string; content: string };
  expires_in: string;
}

enum MetricProfileInsights {}

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
      const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: {
          fields: 'open_id, union_id, display_name, avatar_url, following_count, follower_count, likes_count',
        },
        headers: { Authorization: `Bearer ${access_token}` },
      });

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

      const userData = userInfoResponse.data.data.user;

      const videos = videoInfoResponse.data.data.videos;

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

      for (const video of videos) {
        await prisma.tiktokVideo.upsert({
          where: {
            video_id: video.id,
          },
          update: {
            cover_image_url: video.cover_image_url,
            title: video.title,
            description: video.description,
            duration: parseFloat(video.duration),
            embed_link: video.embed_link,
            embed_html: video.embed_html,
            like_count: video.like_count,
            comment_count: video.comment_count,
            share_count: video.comment_count,
            view_count: video.view_count,
          },
          create: {
            cover_image_url: video.cover_image_url,
            title: video.title,
            description: video.description,
            duration: parseFloat(video.duration),
            embed_link: video.embed_link,
            embed_html: video.embed_html,
            like_count: video.like_count,
            comment_count: video.comment_count,
            share_count: video.comment_count,
            view_count: video.view_count,
            tiktokUserId: creator.tiktokUser?.id,
            video_id: video.id,
          },
        });
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

    if (!creator.isFacebookConnected)
      return res.status(400).json({ message: 'Creator is not connected to instagram account' });

    if (dayjs().isAfter(dayjs.unix(creator?.instagramUser?.expiresIn!))) {
      return res.status(400).json({ message: 'Instagram Token expired' });
    }

    const encryptedAccessToken = creator.instagramUser?.accessToken;
    if (!encryptedAccessToken) return res.status(404).json({ message: 'Access token not found' });

    const accessToken = decryptToken(encryptedAccessToken as any);

    const overview = await getInstagramOverviewService(accessToken);
    const medias = await getAllMediaObject(accessToken, overview.user_id, overview.media_count);

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

    return res.status(200).json({ overview, medias });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getInstagramMediaInsight = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { url } = req.query;

  if (!userId) return res.status(404).json({ message: 'Parameter missing: userId' });
  if (!url) return res.status(404).json({ message: 'Query missing: url' });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const creator = await prisma.creator.findFirst({
      where: {
        userId: user.id,
      },
      select: {
        instagramUser: true,
        isFacebookConnected: true,
      },
    });

    if (!creator) return res.status(404).json({ message: 'User is not a creator' });
    if (!creator.isFacebookConnected || !creator.instagramUser)
      return res.status(400).json({ message: 'Creator is not connected to instagram account' });

    if (dayjs().isAfter(dayjs.unix(creator?.instagramUser?.expiresIn!))) {
      return res.status(400).json({ message: 'Instagram Token expired' });
    }

    const encryptedAccessToken = creator.instagramUser?.accessToken;
    if (!encryptedAccessToken) return res.status(404).json({ message: 'Access token not found' });

    const accessToken = decryptToken(encryptedAccessToken as any);
    // const accessToken = 'IGAAIGNU09lZBhBZAE5zNFZARbmlkbThTbEdVdTBkWndaUDhzRFNFMkwzbkZAINTY5dDdTbTVNaUNRemNGRmdGVFZAzdy1VSDRwRFBzSDNWQWt3a3NTeWZAKMXZAmVFpTMVRONDE1eU5kMk9jT2xmS0o4UV9SOTZAwVkJYWVBld3NXYzhrSQZDZD'

    const { videos } = await getInstagramMedias(accessToken, creator.instagramUser.media_count as number);

    const shortCode = extractInstagramShortcode(url as string);

    const video = videos.find((item: any) => item?.shortcode === shortCode);

    console.log('ASDSAD', video);

    if (!video)
      return res
        .status(404)
        .json({ message: `This is the url shortcode: ${shortCode} but we can't find the video shortcode.` });

    // NEW: Get the previous video (the one posted before this video)
    // Since videos are sorted by timestamp (newest first), find the video right after the current one in the array
    const currentVideoIndex = videos.findIndex((item: any) => item?.shortcode === shortCode);
    const previousVideo =
      currentVideoIndex !== -1 && currentVideoIndex < videos.length - 1 ? videos[currentVideoIndex + 1] : null;

    // console.log('Pervious video data: ', previousVideo);

    const insight = await getMediaInsight(accessToken, video?.id);

    // Calculate percentage changes if previous video exists
    let changes = {};
    let previousPostData = null;

    if (previousVideo) {
      // Extract previous video metrics
      previousPostData = {
        timestamp: previousVideo.timestamp,
        likes: previousVideo.like_count || 0,
        comments: previousVideo.comments_count || 0,
        saved: 0, // We don't have this in the video object, would need separate API call
        shares: 0, // We don't have this in the video object, would need separate API call
      };

      // Get current metrics
      const currentMetrics = {
        likes: video.like_count || insight.find((i: { name: string }) => i.name === 'likes')?.value || 0,
        comments: video.comments_count || insight.find((i: { name: string }) => i.name === 'comments')?.value || 0,
        saved: insight.find((i: { name: string }) => i.name === 'saved')?.value || 0,
        shares: insight.find((i: { name: string }) => i.name === 'shares')?.value || 0,
      };

      // Calculate percentage changes
      changes = {
        likes:
          previousPostData.likes > 0
            ? ((currentMetrics.likes - previousPostData.likes) / previousPostData.likes) * 100
            : currentMetrics.likes > 0
              ? 100
              : 0,
        comments:
          previousPostData.comments > 0
            ? ((currentMetrics.comments - previousPostData.comments) / previousPostData.comments) * 100
            : currentMetrics.comments > 0
              ? 100
              : 0,
        saved:
          previousPostData.saved > 0
            ? ((currentMetrics.saved - previousPostData.saved) / previousPostData.saved) * 100
            : currentMetrics.saved > 0
              ? 100
              : 0,
        shares:
          previousPostData.shares > 0
            ? ((currentMetrics.shares - previousPostData.shares) / previousPostData.shares) * 100
            : currentMetrics.shares > 0
              ? 100
              : 0,
      };
    }

    return res.status(200).json({
      insight,
      video,
      previousPost: previousPostData,
      changes: changes,
      hasPreviousPost: !!previousPostData,
    });
  } catch (error) {
    // console.log(error);
    return res.status(400).json(error);
  }
};

export const getTikTokVideoInsight = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { url } = req.query;

  if (!userId) return res.status(404).json({ message: 'Parameter missing: userId' });
  if (!url) return res.status(404).json({ message: 'Query missing: url' });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const creator = await prisma.creator.findFirst({
      where: {
        userId: user.id,
      },
      select: {
        tiktokData: true,
        isTiktokConnected: true,
      },
    });

    if (!creator) return res.status(404).json({ message: 'User is not a creator' });
    if (!creator.isTiktokConnected || !creator.tiktokData) {
      return res.status(400).json({ message: 'Creator is not connected to TikTok account' });
    }

    const tiktokData = creator.tiktokData as any;
    console.log('TikTok Data structure:', Object.keys(tiktokData)); // Debug

    // const encryptedAccessToken = tiktokData?.access_token;

    // if (!encryptedAccessToken) return res.status(404).json({ message: 'TikTok access token not found' });

    // const accessToken = decryptToken(encryptedAccessToken);
    const accessToken = 'act.q0zdw8SAAWGnra2c7isdYicog1w3szmfWuFgU5g9ZDlEffyMCt5JagB2p8sp!5620.va';

    // Debug: Check token format (don't log the full token for security)
    console.log('Access token format check:', {
      hasToken: !!accessToken,
      startsWithAct: accessToken?.startsWith('act.'),
      tokenLength: accessToken?.length,
      firstChars: accessToken?.substring(0, 10),
    });

    // Extract video ID from URL
    const videoId = extractTikTokVideoId(url as string);
    console.log('Extracted video ID:', videoId); // Debug

    if (!videoId) {
      return res.status(400).json({ message: 'Invalid TikTok URL or unable to extract video ID' });
    }

    // Test the token first with user info endpoint
    try {
      const testResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
        params: {
          fields: 'open_id,display_name',
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      console.log('Token test successful:', testResponse.data);
    } catch (testError) {
      console.error('Token test failed:', testError.response?.status, testError.response?.data);
      return res.status(400).json({
        message: 'Access token is invalid or expired',
        error: testError.response?.data,
      });
    }

    // Now try to fetch the video
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
      { name: 'saved', value: 0 },
      { name: 'reach', value: 0 },
      {
        name: 'total_interactions',
        value: (video.like_count || 0) + (video.comment_count || 0) + (video.share_count || 0),
      },
      { name: 'profile_visits', value: 0 },
    ];

    return res.status(200).json({
      video: formattedVideo,
      insight,
    });
  } catch (error) {
    console.error('Error getting TikTok video insight:', error);
    return res.status(400).json({
      message: 'Failed to get TikTok video insight',
      error: error.message,
    });
  }
};
