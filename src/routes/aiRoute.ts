import { aiSettings, getCampaigns, updateAiSettings } from '@controllers/aiController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Router } from 'express';

const aiRouter = Router();

aiRouter.get('/', isLoggedIn, aiSettings);
aiRouter.get('/campaigns', isLoggedIn, getCampaigns);

aiRouter.patch('/configure', isLoggedIn, updateAiSettings);

export default aiRouter;
