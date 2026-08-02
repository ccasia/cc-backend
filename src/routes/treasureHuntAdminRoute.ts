import { Router } from 'express';

import { authenticate } from '../middleware/authenticate';
import { isTreasureHuntSuperadmin } from '../middleware/isTreasureHuntSuperadmin';
import { createTreasureHuntAdminController } from '../controller/treasureHuntAdminController';
import { treasureHuntAdminService } from '../service/treasureHuntComposition';

const router = Router();
const controller = createTreasureHuntAdminController({ service: treasureHuntAdminService });

// Every treasure-hunt admin route is strict-superadmin only. This guard checks
// User.role === 'superadmin' and does NOT admit ordinary admins in god/advanced
// mode (unlike onlySuperadmin.isSuperAdmin).
router.use(authenticate, isTreasureHuntSuperadmin);

// Find Cipta is a one-time event: /current resolves (and on first use creates)
// the single hunt. Must stay above /:huntId or the param route swallows it.
router.get('/current', controller.getCurrentHunt);

router.get('/', controller.listHunts);
router.post('/', controller.createHunt);
router.get('/:huntId', controller.getHunt);
router.patch('/:huntId', controller.updateHunt);
router.get('/:huntId/dashboard', controller.getDashboard);
router.get('/:huntId/participants', controller.getParticipants);
router.get('/:huntId/export.csv', controller.exportParticipants);

router.post('/:huntId/locations', controller.addLocation);
router.post('/:huntId/locations/reorder', controller.reorderLocations);
router.patch('/:huntId/locations/:locationId', controller.updateLocation);
router.delete('/:huntId/locations/:locationId', controller.deleteLocation);
router.post('/:huntId/locations/:locationId/publish-qr', controller.publishQr);
router.post('/:huntId/locations/:locationId/sync-analytics', controller.syncAnalytics);

router.post('/:huntId/publish', controller.publishHunt);
router.post('/:huntId/pause', controller.pauseHunt);
router.post('/:huntId/resume', controller.resumeHunt);
router.post('/:huntId/reactivate', controller.reactivateHunt);
router.post('/:huntId/archive', controller.archiveHunt);

export default router;
