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
  crawlCreator,
  getCreatorSocialMediaData,
} from '@controllers/creatorController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { needPermissions } from '@middlewares/needPermissions';
import { isLoggedIn } from '@middlewares/onlyLogin';

const router = Router();

router.get('/getAllCreators', isSuperAdmin, getCreators);
router.get('/getMediaKit', isSuperAdmin, getMediaKit);
router.get('/getCreatorByID/:id', isSuperAdmin, getCreatorByID);
router.get('/getCreatorFullInfoById/:id', isSuperAdmin, getCreatorFullInfoById);
router.get('/crawl-result', getCreatorSocialMediaData);

router.post('/crawl', crawlCreator);

router.patch('/update-creator', isLoggedIn, updateCreator);
router.patch('/update-media-kit', isLoggedIn, updateMediaKit);
router.patch('/updatePaymentForm', isLoggedIn, updatePaymentForm);
router.patch('/updateCreatorForm', isLoggedIn, updateCreatorForm);

router.delete('/delete/:id', isSuperAdmin, deleteCreator);

export default router;
