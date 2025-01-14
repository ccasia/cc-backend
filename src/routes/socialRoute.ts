import { redirectTiktokAfterAuth, tiktokAuthentication, tiktokData } from '@controllers/socialController';
import { Router, Request, Response } from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const router = Router();

const FACEBOOK_APP_ID = '1912785502516586';
const REDIRECT_URI = 'https://staging.cultcreativeasia.com/api/social/auth/facebook/callback';

const prisma = new PrismaClient();

router.get('/oauth/tiktok', isLoggedIn, tiktokAuthentication);

router.get('/tiktok/callback', isLoggedIn, redirectTiktokAfterAuth);

router.get('/tiktok/:userId', isLoggedIn, tiktokData);

router.get('/auth/facebook', (req: Request, res: Response) => {
  const scopes = 'email,public_profile,pages_show_list,business_management,instagram_basic';
  const facebookLoginUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${scopes}&config_id=1804107983668617`;

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
