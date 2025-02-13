import { decryptToken, encryptToken } from '@helper/encrypt';
import axios from 'axios';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import {
  getAllMediaObject,
  getInstagramAccessToken,
  getInstagramBusinesssAccountId,
  getInstagramMediaData,
  getInstagramOverviewService,
  getInstagramUserData,
  getPageId,
} from '@services/socialMediaService';

// const CODE_VERIFIER = 'your_unique_code_verifier';
// const CODE_CHALLENGE = 'SHA256_hash_of_code_verifier';

const prisma = new PrismaClient();

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

    await prisma.creator.update({
      where: {
        userId: req.session.userid,
      },
      data: {
        tiktokData: { ...tokenResponse.data, access_token: encryptedAccessToken, refresh_token: encryptedRefreshToken },
        isTiktokConnected: true,
      },
    });

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
        creator: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    let accessToken = (user.creator?.tiktokData as any)?.access_token;

    accessToken = decryptToken(accessToken);

    // Get user profile info
    const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: {
        fields: 'open_id, union_id, display_name, avatar_url, following_count, follower_count, likes_count',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Get user video lists
    const videoInfoResponse = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: 20 },
      {
        params: {
          fields:
            'cover_image_url, id, title, video_description, duration, embed_link, embed_html, like_count, comment_count, share_count, view_count',
        },
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      },
    );

    const data = { user: userInfoResponse.data, videos: videoInfoResponse.data };

    return res.status(200).json(data);
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

    const response = await axios.post('https://open.tiktokapis.com/v2/oauth/revoke/', {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      token: accessToken,
    });

    await prisma.creator.update({
      where: {
        userId: creator.userId,
      },
      data: {
        isTiktokConnected: false,
        tiktokData: {},
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

  // console.log(req);

  if (!code) return res.status(404).json({ message: 'Code not found.' });
  if (!userId) return res.status(404).json({ message: 'Session Expired. Please log in again.' });

  try {
    const data = await getInstagramAccessToken(code as string);

    await prisma.creator.update({
      where: {
        userId: userId,
      },
      data: {
        instagramData: data,
        isFacebookConnected: true,
      },
    });

    return res.status(200).redirect(process.env.REDIRECT_CLIENT as string);
  } catch (error) {
    console.log('CALLBACK ERROR', error);
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
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const insta = user?.instagramData as any;

    const overview = await getInstagramOverviewService((user.instagramData as any).access_token);

    const medias = await getAllMediaObject(insta.access_token, insta.user_id);

    const data = { user: { ...overview }, contents: [...medias.data] };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};
