import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isTreasureHuntSuperadmin } from '@middlewares/isTreasureHuntSuperadmin';
import { getAppVersionPolicies, patchAppVersionPolicy } from './app-version.controller';

const router = Router();

// minimumVersion can lock every user out of the app, so only role=superadmin
// may change it (the strict guard, not the mode-based onlySuperadmin.isSuperAdmin)
router.use(authenticate, isTreasureHuntSuperadmin);

router.get('/', getAppVersionPolicies);
router.patch('/:platform', patchAppVersionPolicy);

export default router;
