import { Router } from 'express';
import { authenticate } from '@middlewares/authenticate';
import { isCreator } from '@middlewares/isCreator';
import {
  dismissArchetypeQuizPrompt,
  getArchetypeQuizStatus,
  getMyArchetypeQuiz,
  recordArchetypeQuizShare,
  requireOpenArchetypeQuiz,
  submitArchetypeQuiz,
} from './archetype-quiz.controller';

// Mounted at /mobile/archetype-quiz
const router = Router();

// Before the auth guard: a new creator has no account yet.
router.get('/status', getArchetypeQuizStatus);

router.use(authenticate, isCreator, requireOpenArchetypeQuiz);

router.get('/me', getMyArchetypeQuiz);
router.post('/submit', submitArchetypeQuiz);
router.post('/dismiss-prompt', dismissArchetypeQuizPrompt);
router.post('/share', recordArchetypeQuizShare);

export default router;
