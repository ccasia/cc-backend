import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isCreator } from '@middlewares/isCreator';
import {
  dismissArchetypeQuizPrompt,
  getMyArchetypeQuiz,
  recordArchetypeQuizShare,
  requireOpenArchetypeQuiz,
  submitArchetypeQuiz,
} from './archetype-quiz.controller';

// Mounted at /mobile/archetype-quiz
const router = Router();

router.use(authenticate, isCreator, requireOpenArchetypeQuiz);

router.get('/me', getMyArchetypeQuiz);
router.post('/submit', submitArchetypeQuiz);
router.post('/dismiss-prompt', dismissArchetypeQuizPrompt);
router.post('/share', recordArchetypeQuizShare);

export default router;
