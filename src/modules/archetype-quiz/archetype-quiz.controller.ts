import { NextFunction, Request, Response } from 'express';
import { ARCHETYPE_QUIZ_LAUNCH_AT, isArchetypeQuizOpen } from './archetype-quiz.schedule';
import { ArchetypeQuizError, dismissPrompt, getState, recordShare, submit } from './archetype-quiz.service';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof ArchetypeQuizError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`[archetype-quiz] ${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

// A 403 before launch hides the banner and pop-up in every app version.
// opensAt and the server's now let an open app ask again at launch, to the
// millisecond and without a refresh, whatever the phone's clock says.
export const requireOpenArchetypeQuiz = (_req: Request, res: Response, next: NextFunction) => {
  const now = new Date();
  if (isArchetypeQuizOpen(now)) return next();
  return res.status(403).json({
    message: 'The quiz is not open yet.',
    opensAt: ARCHETYPE_QUIZ_LAUNCH_AT.toISOString(),
    now: now.toISOString(),
  });
};

// Public: sign-up asks this before the creator has an account, to decide
// whether the quiz comes before onboarding.
export const getArchetypeQuizStatus = (_req: Request, res: Response) => {
  const now = new Date();
  return res.status(200).json({
    open: isArchetypeQuizOpen(now),
    opensAt: ARCHETYPE_QUIZ_LAUNCH_AT.toISOString(),
    now: now.toISOString(),
  });
};

export const getMyArchetypeQuiz = async (req: Request, res: Response) => {
  try {
    return res.status(200).json(await getState(req.userId as string));
  } catch (error) {
    return handleError(res, error, 'Failed to load archetype quiz');
  }
};

export const submitArchetypeQuiz = async (req: Request, res: Response) => {
  try {
    return res.status(200).json(await submit(req.userId as string, req.body));
  } catch (error) {
    return handleError(res, error, 'Failed to submit archetype quiz');
  }
};

export const dismissArchetypeQuizPrompt = async (req: Request, res: Response) => {
  try {
    return res.status(200).json(await dismissPrompt(req.userId as string));
  } catch (error) {
    return handleError(res, error, 'Failed to dismiss archetype quiz prompt');
  }
};

export const recordArchetypeQuizShare = async (req: Request, res: Response) => {
  try {
    await recordShare(req.userId as string);
    return res.status(204).send();
  } catch (error) {
    return handleError(res, error, 'Failed to record archetype quiz share');
  }
};
