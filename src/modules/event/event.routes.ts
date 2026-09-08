import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { createEvent, deleteEvent, getAllEvents, updateEvent } from './event.controller';

const router = Router();

router.use(authenticate);
router.get('/', getAllEvents);
router.post('/createEvent', createEvent);
router.patch('/deleteEvent', deleteEvent);
router.put('/updateEvent', updateEvent);

export default router;
