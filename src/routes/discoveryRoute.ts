import { Router } from 'express';
import {
  addDiscoveryBookmarkController,
  getDiscoveryBookmarksController,
  getDiscoveryCreatorsList,
  getDiscoveryCreatorsExportDataController,
  getNonPlatformDiscoveryCreatorsList,
  inviteDiscoveryCreatorsController,
  removeDiscoveryBookmarkController,
} from '@controllers/discoveryController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.use(authenticate);
router.get('/creators/export-data', getDiscoveryCreatorsExportDataController);
router.get('/creators', getDiscoveryCreatorsList);
router.get('/non-platform-creators', getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', inviteDiscoveryCreatorsController);
router.get('/bookmarks', getDiscoveryBookmarksController);
router.post('/bookmarks', addDiscoveryBookmarkController);
router.delete('/bookmarks', removeDiscoveryBookmarkController);

export default router;
