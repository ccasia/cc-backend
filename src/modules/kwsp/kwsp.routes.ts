import express from 'express';
import { authenticate } from '@middlewares/authenticate';
import { submitKWSPForm } from './kwsp.controller';

const router = express.Router();

router.post('/submit', authenticate, submitKWSPForm);

export default router;
