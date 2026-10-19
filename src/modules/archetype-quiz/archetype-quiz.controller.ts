import { Request, Response } from 'express';
import { ArchetypeQuizError, dismissPrompt, getState, submit } from './archetype-quiz.service';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof ArchetypeQuizError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`[archetype-quiz] ${fallback}:`, error);
  return res.status(500).json({ message: fallback });
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
