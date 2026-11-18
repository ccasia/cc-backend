import { aiSettings, getCampaigns, updateAiSettings } from '@controllers/aiController';
import { extractInsightScreenshots, saveInsightOcrResult } from '@controllers/insightOcrController';
import { authenticate } from '@middlewares/authenticate';
import { isAnyAdmin } from '@middlewares/onlySuperadmin';
import { Router } from 'express';

const aiRouter = Router();

aiRouter.get('/', authenticate, aiSettings);
aiRouter.get('/campaigns', authenticate, getCampaigns);

aiRouter.patch('/configure', authenticate, updateAiSettings);

aiRouter.post('/insight-ocr', authenticate, isAnyAdmin, extractInsightScreenshots);
aiRouter.post('/insight-ocr/results', authenticate, isAnyAdmin, saveInsightOcrResult);

export default aiRouter;
