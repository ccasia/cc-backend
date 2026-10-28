import { Router } from 'express';
import { getAppVersionCheck } from './app-version.controller';

const router = Router();

router.get('/', getAppVersionCheck);

export default router;
