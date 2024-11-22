import { Router } from 'express';
import {
  registerUser,
  login,
  displayAll,
  registerCreator,
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
  resendVerifyTokenAdmin,
  checkTokenValidity,
  updateProfileCreator,
  registerFinanceUser,
  resendVerificationLinkCreator,
} from '@controllers/authController';
import {
  getXero,
  xeroCallBack,
  getXeroContacts,
  checkAndRefreshAccessToken,
  checkRefreshToken,
} from '@controllers/invoiceController';
import { validateToken } from '@utils/jwtHelper';
// import { needPermissions } from '@middlewares/needPermissions';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

// router.get('/', isLoggedIn, displayAll);
router.get('/me', isLoggedIn, getprofile);
router.get('/verifyAdmin', verifyAdmin);
router.get('/checkTokenValidity/:token', checkTokenValidity);
router.get('/currentUser', validateToken, getCurrentUser);
router.get('/checkCreator', validateToken, checkCreator);

router.post('/login', login);
router.post('/logout', logout);
router.post('/register', registerUser);
router.post('/resendVerifyToken', resendVerifyTokenAdmin);
router.post('/verifyCreator', verifyCreator);
router.post('/registerCreator', registerCreator);
router.post('/registerSuperAdmin', registerSuperAdmin);
router.post('/registerFinanceUser', registerFinanceUser);
router.post('/resendVerificationLinkCreator', resendVerificationLinkCreator);

router.put('/updateCreator', validateToken, updateCreator);

router.patch('/updateProfileCreator', validateToken, updateProfileCreator);
router.patch('/changePassword', validateToken, changePassword);

export default router;
