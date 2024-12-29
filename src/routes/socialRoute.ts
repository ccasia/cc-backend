import { redirectTiktok } from '@controllers/socialController';
import { encryptToken, decryptToken } from '@helper/encrypt';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Prisma, PrismaClient } from '@prisma/client';
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

    await prisma.creator.update({
      where: {
        userId: req.session.userid,
      },
      data: {
        tiktokToken: { encryptedAccessToken, encryptedRefreshToken },
      },
    });

    // Get user info
    // const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
    //   params: {
    //     fields: 'open_id, union_id, display_name, avatar_url, following_count, follower_count, likes_count',
    //   },
    //   headers: { Authorization: `Bearer ${access_token}` },
    // });

    // const videoInfoResponse = await axios.post(
    //   'https://open.tiktokapis.com/v2/video/list/',
    //   { max_count: 20 },
    //   {
    //     params: {
    //       fields: 'cover_image_url, id, title',
    //     },
    //     headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    //   },
    // );

    // const userInfo = userInfoResponse.data;

    // const videoInfo = videoInfoResponse.data;

    res.redirect('https://staging.cultcreativeasia.com/dashboard/user/profile');
    // res.json({ user: userInfo, video: videoInfo });
  } catch (error) {
    console.error('Error during TikTok OAuth:', error.response?.data || error.message);
    res.status(500).send('Error during TikTok OAuth');
  }
});

router.get('/tiktok', async (req: Request, res: Response) => {
  const userId = req.session.userid;
  try {
    const user = await prisma.creator.findFirst({
      where: {
        userId: userId,
      },
    });

    if (!user) return res.status(404).json({ message: 'Creator not found.' });

    const tiktokToken = (user?.tiktokToken as any)?.encryptedAccessToken;

    console.log('TIKTOKTOKEN', tiktokToken);

    const access_token = decryptToken(tiktokToken);

    console.log('ACCESSTOKEN', access_token);

    //  Get user info
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

    return res.json({ userInfo, videoInfo });
  } catch (error) {
    return res.status(400).json(error);
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
