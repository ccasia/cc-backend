import { Request, Response } from 'express';
import {
  submitNpsFeedback,
  getNpsFeedbackList,
  getNpsFeedbackStats,
} from '@services/npsFeedbackService';

/**
 * POST /api/nps-feedback — Submit NPS feedback (client only)
 */
export const submitFeedback = async (req: Request, res: Response) => {
  const userId = req.session.userid;
  const { rating, feedback } = req.body;

  try {
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const result = await submitNpsFeedback(userId, 'CLIENT', rating, feedback);

    return res.status(201).json({ message: 'Feedback submitted successfully', data: result });
  } catch (error) {
    console.error('Error submitting NPS feedback:', error);
    return res.status(500).json({ message: 'Failed to submit feedback' });
  }
};

/**
 * GET /api/nps-feedback — List all NPS feedback (superadmin only)
 */
export const getAllFeedback = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

    const result = await getNpsFeedbackList({ page, limit, search, sortBy, sortOrder });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching NPS feedback:', error);
    return res.status(500).json({ message: 'Failed to fetch feedback' });
  }
};

/**
 * GET /api/nps-feedback/stats — Get summary stats (superadmin only)
 */
export const getFeedbackStats = async (req: Request, res: Response) => {
  try {
    const stats = await getNpsFeedbackStats();
    return res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching NPS feedback stats:', error);
    return res.status(500).json({ message: 'Failed to fetch feedback stats' });
  }
};
