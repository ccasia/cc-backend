import {
  clearColumn,
  createColumn,
  createTask,
  deleteColumn,
  editColumn,
  getKanbanBoard,
  moveColumn,
  moveTask,
} from '@controllers/kanbanController';
import { authenticate } from '@middlewares/onlyLogin';
import { Router } from 'express';

const router = Router();

router.get('/', authenticate, getKanbanBoard);

router.post('/createColumn', authenticate, createColumn);
router.post('/createTask', authenticate, createTask);

router.patch('/moveColumn', authenticate, moveColumn);
router.patch('/updateColumn', authenticate, editColumn);
router.patch('/moveTask', authenticate, moveTask);
router.patch('/clearColumn', authenticate, clearColumn);

router.delete('/deleteColumn', authenticate, deleteColumn);

export default router;
