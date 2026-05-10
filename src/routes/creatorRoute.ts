import { Router } from 'express';
// import { validateToken } from '@utils/jwtHelper';
import {
  getCreators,
  getCreatorCount,
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
  updateCreatorPreference,
  exportCreatorsToSheet,
  createKanban,
  createCampaignCreator,
  markMediaKitMandatory,
  unmarkMediaKitMandatory,
} from '@controllers/creatorController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
// import { needPermissions } from '@middlewares/needPermissions';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

// Optimized endpoint - returns only count instead of all creators
router.get('/count', getCreatorCount);
router.get('/getAllCreators', getCreators);
router.get('/getMediaKit', isSuperAdmin, getMediaKit);
router.get('/getCreatorByID/:id', isSuperAdmin, getCreatorByID);
router.get('/getCreatorFullInfoById/:id', getCreatorFullInfoById);
router.get('/public/getCreatorFullInfoById/:id', getCreatorFullInfoByIdPublic);
router.get('/getCreatorSocialMediaData', getCreatorSocialMediaData);
router.get('/creator/:id/social-media', getCreatorSocialMediaDataById);
router.get('/getPartnerships/:id', authenticate, getPartnerships);

router.get('/exportCreators', isSuperAdmin, exportCreatorsToSheet);

// router.post('/crawl', crawlCreator);

router.post('/createKanban', createKanban);
router.post('/createCreator', createCampaignCreator);
router.post('/markMediaKitMandatory', isSuperAdmin, markMediaKitMandatory);
router.post('/unmarkMediaKitMandatory', isSuperAdmin, unmarkMediaKitMandatory);

router.patch('/updateSocialMediaUsername', authenticate, updateSocialMedia);
router.patch('/update-creator', authenticate, updateCreator);
router.patch('/update-media-kit', authenticate, updateMediaKit);
router.patch('/updatePaymentForm', authenticate, updatePaymentForm);
router.patch('/updateCreatorForm', authenticate, updateCreatorForm);
router.patch('/updatePreference/:id', authenticate, updateCreatorPreference);

router.delete('/delete/:id', isSuperAdmin, deleteCreator);

export default router;
