import { redirectTiktok } from '@controllers/socialController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import axios from 'axios';
import { Router, Request, Response } from 'express';

const router = Router();

const CLIENT_KEY = 'sbawx99tuchkscwygv';
const CLIENT_SECRET = 'oIjGT7T8WJPWwL2POjTyYI75WRwVj8nh';
const TIKTOK_REDIRECT_URI = `https://localhost/api/social/tiktok/callback`;

router.get('/oauth/tiktok', isLoggedIn, redirectTiktok);

router.get('/tiktok/callback', async (req: Request, res: Response) => {
  const code = req.query.code;

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token',
      JSON.stringify({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    const { access_token } = tokenResponse.data;

    // Get user info
    const userInfoResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const userInfo = userInfoResponse.data;

    console.log(userInfo);

    res.json({ user: userInfo });
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
