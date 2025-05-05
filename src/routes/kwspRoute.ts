import express from 'express';
import { submitKWSPForm } from '../controller/kwspController';

const router = express.Router();

router.post('/submit', submitKWSPForm);

export default router;
