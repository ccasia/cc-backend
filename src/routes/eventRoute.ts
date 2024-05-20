import { Router } from 'express';
import { createEvent, deleteEvent, getAllEvents, updateEvent } from 'src/controller/eventController';

const router = Router();

router.get('/', getAllEvents);
router.post('/createEvent', createEvent);
router.patch('/deleteEvent', deleteEvent);
router.put('/updateEvent', updateEvent);

export default router;
