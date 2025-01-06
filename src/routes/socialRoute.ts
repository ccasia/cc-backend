import { redirectTiktok } from '@controllers/socialController';
import { encryptToken, decryptToken } from '@helper/encrypt';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Router, Request, Response } from 'express';

const router = Router();

const CLIENT_KEY = 'sbawx99tuchkscwygv';
const CLIENT_SECRET = 'oIjGT7T8WJPWwL2POjTyYI75WRwVj8nh';
const TIKTOK_REDIRECT_URI = `https://staging.cultcreativeasia.com/api/social/tiktok/callback`;

const FACEBOOK_APP_ID = '1912785502516586';
const REDIRECT_URI = 'https://staging.cultcreativeasia.com/api/social/auth/facebook/callback';

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

    res.redirect('https://staging.cultcreativeasia.com/dashboard/user/profile');
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

router.get('/auth/facebook', (req: Request, res: Response) => {
  const scopes =
    'pages_show_list,business_management,instagram_basic,instagram_manage_comments,instagram_manage_insights,pages_read_engagement';
  const facebookLoginUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${REDIRECT_URI}&scope=${scopes}`;
  // res.redirect(facebookLoginUrl);
  res.send(facebookLoginUrl);
});

router.get('/auth/facebook/callback', async (req, res) => {
  const code = req.query.code; // Facebook sends the code here

  try {
    // Exchange the code for an access token
    const response = await axios.get('https://graph.facebook.com/v13.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: 'b6e9940df5d931e7488cddd5dc42d5cd',
        redirect_uri: REDIRECT_URI,
        code: code,
      },
    });

    const { access_token } = response.data;

    // Get User Info using the Access Token
    const userInfo = await axios.get('https://graph.facebook.com/me', {
      params: {
        access_token: access_token,
        fields: 'id,name,email,picture', // You can choose which fields you want
      },
    });

    // You can store the user info in the session or database here
    res.json(userInfo.data); // Send user info as a response (or redirect to a front-end page)
  } catch (error) {
    console.error('Error fetching Facebook access token:', error);
    res.status(500).send('Error authenticating with Facebook');
  }
});

export default router;
