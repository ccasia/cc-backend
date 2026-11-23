import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import {
  removePostInsightScreenshotHandler,
  listPostInsightsHandler,
  addPostInsightScreenshotsHandler,
  reviewPostInsightMetricsHandler,
} from './post-insights.controller';

// Mounted at /campaign/:campaignId/post-insights
const router = Router({ mergeParams: true });

router.get('/', authenticate, listPostInsightsHandler);
router.put('/', authenticate, addPostInsightScreenshotsHandler);
router.delete('/:id/screenshots', authenticate, removePostInsightScreenshotHandler);
router.post('/:id/metrics-review', authenticate, reviewPostInsightMetricsHandler);

export default router;
