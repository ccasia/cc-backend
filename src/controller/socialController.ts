import { decryptToken, encryptToken } from '@helper/encrypt';
import axios from 'axios';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

// const CODE_VERIFIER = 'your_unique_code_verifier';
// const CODE_CHALLENGE = 'SHA256_hash_of_code_verifier';

const prisma = new PrismaClient();

// Connect account
export const tiktokAuthentication = (req: Request, res: Response) => {
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
      },
    });

    res.redirect('https://staging.cultcreativeasia.com/dashboard/user/profile');
  } catch (error) {
    console.error('Error during TikTok OAuth:', error.response?.data || error.message);
    res.status(500).send('Error during TikTok OAuth');
  }
};

// Get Tiktok Data
export const tiktokData = async (req: Request, res: Response) => {
  const { userId } = req.params;

  console.log(req.params);

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
          fields: 'cover_image_url, id, title, video_description, duration, embed_link',
        },
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      },
    );

    const data = { user: userInfoResponse.data, videos: videoInfoResponse.data };

    return res.status(200).json(data);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// Revoke access
