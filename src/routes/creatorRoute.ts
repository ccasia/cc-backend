import { Router } from 'express';
// import { validateToken } from '@utils/jwtHelper';
import {
  getCreators,
  deleteCreator,
  getCreatorByID,
  updateCreator,
  updateMediaKit,
  getMediaKit,
  getCreatorFullInfoById,
  updatePaymentForm,
  updateCreatorForm,
  // crawlCreator,
  getCreatorSocialMediaData,
  getCreatorSocialMediaDataById,
  getCreatorFullInfoByIdPublic,
  updateSocialMedia,
  getPartnerships,
} from '@controllers/creatorController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
// import { needPermissions } from '@middlewares/needPermissions';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/getAllCreators', getCreators);
router.get('/getMediaKit', isSuperAdmin, getMediaKit);
router.get('/getCreatorByID/:id', isSuperAdmin, getCreatorByID);
router.get('/getCreatorFullInfoById/:id',  getCreatorFullInfoById);
router.get('/public/getCreatorFullInfoById/:id', getCreatorFullInfoByIdPublic);
router.get('/getCreatorSocialMediaData', getCreatorSocialMediaData);
router.get('/creator/:id/social-media', getCreatorSocialMediaDataById);
router.get('/getPartnerships/:id', isLoggedIn, getPartnerships);

// router.post('/crawl', crawlCreator);

router.patch('/updateSocialMediaUsername', isLoggedIn, updateSocialMedia);
router.patch('/update-creator', isLoggedIn, updateCreator);
router.patch('/update-media-kit', isLoggedIn, updateMediaKit);
router.patch('/updatePaymentForm', isLoggedIn, updatePaymentForm);
router.patch('/updateCreatorForm', isLoggedIn, updateCreatorForm);

router.delete('/delete/:id', isSuperAdmin, deleteCreator);

export default router;
