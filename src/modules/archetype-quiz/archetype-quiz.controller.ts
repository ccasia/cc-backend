import { NextFunction, Request, Response } from 'express';
import { isArchetypeQuizOpen } from './archetype-quiz.schedule';
import { ArchetypeQuizError, dismissPrompt, getState, recordShare, submit } from './archetype-quiz.service';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof ArchetypeQuizError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`[archetype-quiz] ${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

// A 403 before launch hides the banner and pop-up in every app version.
export const requireOpenArchetypeQuiz = (_req: Request, res: Response, next: NextFunction) => {
  if (isArchetypeQuizOpen(new Date())) return next();
  return res.status(403).json({ message: 'The quiz is not open yet.' });
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
