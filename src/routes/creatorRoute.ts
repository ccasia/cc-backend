import { Router } from 'express';
// import { validateToken } from '@utils/jwtHelper';
import { getCreators, deleteCreator, getCreatorByID, updateCreator } from '../controller/creatorController';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
const router = Router();

router.get('/getAll', isSuperAdmin, getCreators);
router.get('/getCreatorByID/:id', isSuperAdmin, getCreatorByID);
router.delete('/delete/:id', isSuperAdmin, deleteCreator);
router.patch('/update-creator', updateCreator);

export default router;
