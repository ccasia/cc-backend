import { Router } from 'express';

import { authenticate } from '@middlewares/authenticate';
import { isSalesAndMarketing } from '@middlewares/isSalesAndMarketing';
import {
  getVideosOfTheMonth,
  getCuratedVideos,
  getFeaturableSubmissions,
  addVideoOfTheMonth,
  editVideoOfTheMonth,
  removeVideoOfTheMonth,
} from '@controllers/videoOfTheMonthController';

const router = Router();

router.use(authenticate);

// Mobile home feed — any authenticated user (creators) can read the curated list.
router.get('/feed', getVideosOfTheMonth);

// Curation — gated to CS / Sales & Marketing (CSM, CSL, sales_and_marketing
// slug; god/advanced mode bypasses).
router.get('/', isSalesAndMarketing, getCuratedVideos);
router.get('/submissions', isSalesAndMarketing, getFeaturableSubmissions);
router.post('/', isSalesAndMarketing, addVideoOfTheMonth);
router.patch('/:id', isSalesAndMarketing, editVideoOfTheMonth);
router.delete('/:id', isSalesAndMarketing, removeVideoOfTheMonth);

export default router;
