import {
  facebookAuthentication,
  getUserInstagramData,
  handleDisconnectFacebook,
  handleDisconnectTiktok,
  redirectFacebookAuth,
  redirectTiktokAfterAuth,
  tiktokAuthentication,
  tiktokData,
} from '@controllers/socialController';
import { Router, Request, Response } from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const router = Router();

router.get('/oauth/tiktok', isLoggedIn, tiktokAuthentication);

router.get('/tiktok/callback', isLoggedIn, redirectTiktokAfterAuth);

router.get('/tiktok/:userId', isLoggedIn, tiktokData);

router.get('/auth/facebook', facebookAuthentication);

router.get('/auth/facebook/callback', redirectFacebookAuth);

router.get('/instagram/:userId', isLoggedIn, getUserInstagramData);

router.post('/tiktok/disconnect', isLoggedIn, handleDisconnectTiktok);

router.post('/facebook/disconnect', isLoggedIn, handleDisconnectFacebook);

export default router;
