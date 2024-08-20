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
} from '../controller/creatorController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
import { needPermissions } from 'src/middleware/needPermissions';
import { isLoggedIn } from 'src/middleware/onlyLogin';
const router = Router();

router.get('/getAll', needPermissions(['list:creator']), isSuperAdmin, getCreators);
router.get('/getMediaKit', needPermissions(['list:creator']), isSuperAdmin, getMediaKit);
router.get('/getCreatorByID/:id', needPermissions(['view:creator']), isSuperAdmin, getCreatorByID);
router.delete('/delete/:id', needPermissions(['delete:creator']), isSuperAdmin, deleteCreator);
router.patch('/update-creator', needPermissions(['update:creator']), updateCreator);
router.patch('/update-media-kit', isLoggedIn, updateMediaKit);
router.get('/getCreatorFullInfoById/:id', needPermissions(['view:creator']), isSuperAdmin, getCreatorFullInfoById);

export default router;
