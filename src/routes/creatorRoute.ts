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
const router = Router();

router.get('/getAll', isSuperAdmin, getCreators);
router.get('/getMediaKit', isSuperAdmin, getMediaKit);
router.get('/getCreatorByID/:id', isSuperAdmin, getCreatorByID);
router.delete('/delete/:id', isSuperAdmin, deleteCreator);
router.patch('/update-creator', updateCreator);
router.patch('/update-media-kit', updateMediaKit);
router.get('/getCreatorFullInfoById/:id', isSuperAdmin, getCreatorFullInfoById);

export default router;
