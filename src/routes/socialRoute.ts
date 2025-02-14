import {
  facebookAuthentication,
  getInstagramOverview,
  getUserInstagramData,
  handleDisconnectFacebook,
  handleDisconnectTiktok,
  instagramCallback,
  redirectFacebookAuth,
  redirectTiktokAfterAuth,
  removeInstagramPermissions,
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

router.get('/auth/instagram/callback', instagramCallback);

router.get('/instagram/overview/:userId', isLoggedIn, getInstagramOverview);

router.delete('/instagram/permissions/:userId', isLoggedIn, removeInstagramPermissions);

export default router;
