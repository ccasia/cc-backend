import { Router } from 'express';
import {
  registerUser,
  login,
  displayAll,
  registerCreator,
  registerClient,
  verifyAdmin,
  registerSuperAdmin,
  getprofile,
  changePassword,
  logout,
  getCurrentUser,
  checkCreator,
  // updateCreator,
  verifyCreator,
  updateCreator,
  updateClient,
  resendVerifyTokenAdmin,
  checkTokenValidity,
  updateProfileCreator,
  registerFinanceUser,
  resendVerificationLinkCreator,
  resendVerificationLinkClient,
  inviteClient,
  verifyClientInvite,
  setupClientPassword,
  verifyClient,
  deleteAccount,
  setupTwoFactor,
  sendVerificationCode,
  verifyCode,
  getOtpStatus,
  resendVerificationCode,
  getSessionStatus,
} from '@controllers/authController';

import { validateToken } from '@utils/jwtHelper';

import passport from '../auth/googleAuth';
import { isLoggedIn } from '@middlewares/onlyLogin';
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  message: { status: 429, message: 'Too many requests. Please try again in a minute.' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

const router = Router();

// router.get('/', isLoggedIn, displayAll);
router.get('/me', getprofile);
router.get('/otp-status', getOtpStatus);
router.get('/verifyAdmin', verifyAdmin);
router.get('/checkTokenValidity/:token', checkTokenValidity);
router.get('/currentUser', validateToken, getCurrentUser);
router.get('/checkCreator', validateToken, checkCreator);
router.get('/session-status', getSessionStatus);

// Google Auth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', passport.authenticate('google', { session: true }), (req, res) => {
  const user = req.user as any;
  if (!user) return res.status(401).json({ message: 'Authentication failed' });

  const session = req.session;
  session.userid = user.id;

  res.redirect(`${process.env.BACKEND_URL}/dashboard`);
});

router.post('/login', login);

router.post('/logout', logout);
router.post('/register', registerUser);
router.post('/resendVerifyToken', resendVerifyTokenAdmin);
router.post('/verifyCreator', verifyCreator);
router.post('/registerCreator', registerCreator);
router.post('/registerClient', registerClient);
router.post('/registerSuperAdmin', registerSuperAdmin);
router.post('/registerFinanceUser', registerFinanceUser);
router.post('/resendVerificationLinkCreator', resendVerificationLinkCreator);
router.post('/resendVerificationLinkClient', resendVerificationLinkClient);
router.post('/verifyClient', verifyClient);
router.post('/setupTwoFactor', isLoggedIn, setupTwoFactor);

router.post('/send-code', sendVerificationCode);
router.post('/resend-code', resendVerificationCode);
router.patch('/verify-code', verifyCode);

// Client authentication routes
router.post('/invite-client', inviteClient);
router.get('/verify-client-invite', verifyClientInvite);
router.post('/setup-client-password', setupClientPassword);

router.put('/updateCreator', isLoggedIn, updateCreator);
router.patch('/updateClient', isLoggedIn, updateClient);

router.patch('/updateProfileCreator', updateProfileCreator);
router.patch('/changePassword', validateToken, changePassword);

router.delete('/account', isLoggedIn, deleteAccount);

export default router;
