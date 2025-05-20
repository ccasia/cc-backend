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
  getInstagramContentById,
  getCreatorByInstagramContent,
  getTiktokContentById,
  getCreatorByTiktokContent,
} from '@controllers/socialController';
import { Router } from 'express';
import { isLoggedIn } from '@middlewares/onlyLogin';

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

router.get('/instagram/content/:contentId', getInstagramContentById);

router.get('/instagram/creator/:contentId', getCreatorByInstagramContent);

router.get('/tiktok/content/:contentId', getTiktokContentById);

router.get('/tiktok/creator/:contentId', getCreatorByTiktokContent);

router.delete('/instagram/permissions/:userId', isLoggedIn, removeInstagramPermissions);

export default router;
