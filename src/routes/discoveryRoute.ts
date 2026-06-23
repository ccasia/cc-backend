import { Router } from 'express';
import {
  addCreatorToListController,
  createBookmarkListController,
  deleteBookmarkListController,
  getBookmarkListCreatorsController,
  getBookmarkListsController,
  getDiscoveryCreatorsList,
  getDiscoveryCreatorsExportDataController,
  getNonPlatformDiscoveryCreatorsList,
  inviteDiscoveryCreatorsController,
  removeCreatorFromListController,
} from '@controllers/discoveryController';
import { authenticate } from '@middlewares/authenticate';

const router = Router();

router.use(authenticate);
router.get('/creators/export-data', getDiscoveryCreatorsExportDataController);
router.get('/creators', getDiscoveryCreatorsList);
router.get('/non-platform-creators', getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', inviteDiscoveryCreatorsController);
router.get('/bookmark-lists', getBookmarkListsController);
router.post('/bookmark-lists', createBookmarkListController);
router.get('/bookmark-lists/creators', getBookmarkListCreatorsController);
router.delete('/bookmark-lists/:listId', deleteBookmarkListController);
router.post('/bookmark-lists/:listId/creators', addCreatorToListController);
router.delete('/bookmark-lists/:listId/creators', removeCreatorFromListController);

export default router;
