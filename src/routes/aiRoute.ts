import { aiSettings, getCampaigns, updateAiSettings } from '@controllers/aiController';
import { authenticate } from '@middlewares/onlyLogin';
import { Router } from 'express';

const aiRouter = Router();

aiRouter.get('/', authenticate, aiSettings);
aiRouter.get('/campaigns', authenticate, getCampaigns);

aiRouter.patch('/configure', authenticate, updateAiSettings);

export default aiRouter;
