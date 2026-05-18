import express from 'express';
import { submitKWSPForm } from '../controller/kwspController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

router.post('/submit', authenticate, submitKWSPForm);

export default router;
