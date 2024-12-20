import { redirectTiktok } from '@controllers/socialController';
import { encryptToken } from '@helper/encrypt';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Router, Request, Response } from 'express';

const router = Router();

const CLIENT_KEY = 'sbawx99tuchkscwygv';
const CLIENT_SECRET = 'oIjGT7T8WJPWwL2POjTyYI75WRwVj8nh';
const TIKTOK_REDIRECT_URI = `https://staging.cultcreativeasia.com/api/social/tiktok/callback`;

const prisma = new PrismaClient();

router.get('/oauth/tiktok', isLoggedIn, redirectTiktok);

router.get('/tiktok/callback', async (req: Request, res: Response) => {
  const code = req.query.code;

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    const { access_token, refresh_token } = tokenResponse.data;

    const encryptedAccessToken = encryptToken(access_token);
    const encryptedRefreshToken = encryptToken(refresh_token);

    console.log('EAT', encryptedAccessToken);
    console.log('ERT', encryptedRefreshToken);

    await prisma.creator.update({
      where: {
        userId: req.session.userid,
      },
      data: {
        tiktokToken: { encryptedAccessToken, encryptedRefreshToken },
      },
    });

    // Get user info
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
          fields: 'cover_image_url, id, title',
        },
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      },
    );

    const userInfo = userInfoResponse.data;

    const videoInfo = videoInfoResponse.data;

    res.json({ user: userInfo, video: videoInfo });
  } catch (error) {
    console.error('Error during TikTok OAuth:', error.response?.data || error.message);
    res.status(500).send('Error during TikTok OAuth');
  }
});

// router.get('/tiktok/callback', isLoggedIn, redirectTiktok);

// router.get('/facebook/callback', (req: Request, res: Response) => {
//   try {
//     console.log('DAS');
//   } catch (error) {
//     console.log(error);
//   }
// });

export default router;
