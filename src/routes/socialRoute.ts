import {
  facebookAuthentication,
  getInstagramMediaInsight,
  getInstagramMediaKit,
  getInstagramOverview,
  getTikTokVideoInsight,
  getUserInstagramData,
  handleDisconnectFacebook,
  handleDisconnectTiktok,
  handleInstagramCallback,
  instagramCallback,
  redirectFacebookAuth,
  redirectTiktokAfterAuth,
  removeInstagramPermissions,
  tiktokAuthentication,
  tiktokData,
  getTikTokMediaKit,
} from '@controllers/socialController';
import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.get('/oauth/tiktok', authenticate, tiktokAuthentication);

router.get('/tiktok/callback', authenticate, redirectTiktokAfterAuth);

router.get('/tiktok/:userId', authenticate, tiktokData);

router.get('/auth/facebook', facebookAuthentication);

router.get('/auth/facebook/callback', redirectFacebookAuth);

router.get('/instagram/:userId', authenticate, getUserInstagramData);

router.post('/tiktok/disconnect', authenticate, handleDisconnectTiktok);

router.post('/facebook/disconnect', authenticate, handleDisconnectFacebook);

router.get('/auth/instagram/callback', instagramCallback);

router.get('/instagram/overview/:userId', authenticate, getInstagramOverview);

router.delete('/instagram/permissions/:userId', authenticate, removeInstagramPermissions);

// Instagram, V2
router.get('/v2/auth/instagram/callback', handleInstagramCallback);
router.get('/v2/instagramOverview/:userId', getInstagramMediaKit);
router.get('/v2/mediaInsight/:userId', getInstagramMediaInsight);

// TikTok, V2
router.get('/v2/tiktokMediaInsight/:userId', getTikTokVideoInsight);
router.get('/v2/tiktokMediaKit/:userId', getTikTokMediaKit);

export default router;
