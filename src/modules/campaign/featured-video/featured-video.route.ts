import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { listFeaturedVideosHandler, setFeaturedVideoHandler } from './featured-video.controller';

// Mounted at /campaign/:campaignId/featured-videos
const router = Router({ mergeParams: true });

router.get('/', authenticate, listFeaturedVideosHandler);
router.put('/', authenticate, setFeaturedVideoHandler);

export default router;
