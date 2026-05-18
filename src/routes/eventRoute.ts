import { Router } from 'express';
import { createEvent, deleteEvent, getAllEvents, updateEvent } from '@controllers/eventController';
import { authenticate } from '../middleware/authenticate';

const router = Router();

router.use(authenticate);
router.get('/', getAllEvents);
router.post('/createEvent', createEvent);
router.patch('/deleteEvent', deleteEvent);
router.put('/updateEvent', updateEvent);

export default router;
