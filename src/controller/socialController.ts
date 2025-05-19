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
  getInstagramOverviewService,
  getInstagramUserData,
  getPageId,
  revokeInstagramPermission,
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
    const data = await getInstagramAccessToken(code as string);

    const access_token = decryptToken(data.encryptedToken);

    const creator = await prisma.creator.update({
      where: {
        userId: userId,
      },
      data: {
        instagramData: data,
        isFacebookConnected: true,
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

    for (const media of medias) {
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

// Get Instagram content by ID
export const getInstagramContentById = async (req: Request, res: Response) => {
  const { contentId } = req.params;
  
  try {
    // First check our database
    const existingContent = await prisma.instagramVideo.findFirst({
      where: { 
        permalink: {
          contains: contentId
        }
      }
    });
    
    if (existingContent) {
      return res.status(200).json({ instagramVideo: existingContent });
    }

    // If not found, get from Instagram API
    const creator = await prisma.creator.findFirst({
      where: { 
        isFacebookConnected: true 
      },
      include: { 
        instagramUser: true 
      }
    });

    if (!creator?.instagramData) {
      return res.status(404).json({ 
        message: 'No connected Instagram account found'
      });
    }

    const instagramData = creator.instagramData as any;
    if (!instagramData?.access_token?.value) {
      return res.status(404).json({ 
        message: 'Instagram access token not found'
      });
    }

    const accessToken = decryptToken(instagramData.access_token.value);
    
    try {
      // Use Instagram Business ID to get media data
      const mediaData = await getInstagramMediaData(accessToken, contentId, [
        'comments_count',
        'like_count',
        'media_type',
        'media_url',
        'thumbnail_url',
        'caption',
        'permalink',
        'timestamp', // Added timestamp field for date posted
      ]);

      if (!mediaData) {
        return res.status(404).json({ 
          message: 'Content not found on Instagram'
        });
      }

      // Store in database for future use
      const newContent = await prisma.instagramVideo.create({
        data: {
          video_id: contentId,
          comments_count: mediaData.comments_count || 0,
          like_count: mediaData.like_count || 0,
          media_type: mediaData.media_type,
          media_url: mediaData.media_url,
          caption: mediaData.caption,
          permalink: mediaData.permalink,
          timestamp: mediaData.timestamp,
          instagramUserId: creator.instagramUser?.id
        }
      });

      // Return combined data with insights
      return res.status(200).json({ 
        instagramVideo: {
          ...newContent,
        } 
      });

    } catch (instagramError) {
      console.error('Instagram API Error:', instagramError);
      return res.status(500).json({ 
        error: 'Failed to fetch from Instagram API',
        details: instagramError.message
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch content',
      details: error.message
    });
  }
};

export const getCreatorByInstagramContent = async (req: Request, res: Response) => {
  const { contentId } = req.params;
  
  try {
    // First try to find the content in our database
    const content = await prisma.instagramVideo.findFirst({
      where: {
        OR: [
          { id: contentId },
          { permalink: { contains: contentId } }
        ]
      },
      include: {
        instagramUser: {
          include: {
            creator: {
              include: {
                user: true
              }
            }
          }
        },
      }
    });

    if (!content || !content.instagramUser) {
      return res.status(404).json({
        message: 'Content not found in our system'
      });
    }

    return res.status(200).json({
      username: content.instagramUser.username,
      name: content.instagramUser.creator.user.name
    });
    
  } catch (error) {
    console.error('Error fetching creator:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch creator information',
      message: error.message
    });
  }
};