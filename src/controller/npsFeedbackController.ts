import { Request, Response } from 'express';
import {
  submitNpsFeedbackSafe,
  checkShouldShowCreatorNPS,
  getNpsFeedbackList,
  getNpsFeedbackStats,
} from '@services/npsFeedbackService';

const ALLOWED_SORT_FIELDS = ['createdAt', 'rating'];
const VALID_USER_TYPES = ['CLIENT', 'CREATOR'];

// POST /api/nps-feedback — Submit NPS feedback (client or creator)
export const submitFeedback = async (req: Request, res: Response) => {
  const userId = req.session.userid;
  const { rating, feedback, deviceType, deviceModel, deviceVendor, os, browser } = req.body;

  try {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' });
    }
    if (feedback && feedback.length > 2000) {
      return res.status(400).json({ message: 'Feedback must be 2000 characters or less' });
    }

    const result = await submitNpsFeedbackSafe(userId, rating, feedback, { deviceType, deviceModel, deviceVendor, os, browser });
    if (!result) {
      return res.status(409).json({ message: 'Feedback already submitted' });
    }
    return res.status(201).json({ message: 'Feedback submitted successfully', data: result });
  } catch (error) {
    console.error('Error submitting NPS feedback:', error);
    return res.status(500).json({ message: 'Failed to submit feedback' });
  }
};

// GET /api/nps-feedback/check-creator — Check if creator should see NPS modal
export const checkCreatorNps = async (req: Request, res: Response) => {
  try {
    const shouldShow = await checkShouldShowCreatorNPS(req.session.userid);
    return res.status(200).json({ showNPS: shouldShow });
  } catch (error) {
    return res.status(200).json({ showNPS: false });
  }
};

// GET /api/nps-feedback — List all NPS feedback (superadmin only)
export const getAllFeedback = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';
    const sortBy = ALLOWED_SORT_FIELDS.includes(req.query.sortBy as string)
      ? (req.query.sortBy as string)
      : 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const userType = VALID_USER_TYPES.includes(req.query.userType as string)
      ? (req.query.userType as string)
      : undefined;
    const rating = req.query.rating ? parseInt(req.query.rating as string) : undefined;

    const result = await getNpsFeedbackList({ page, limit, search, sortBy, sortOrder, startDate, endDate, userType, rating });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching NPS feedback:', error);
    return res.status(500).json({ message: 'Failed to fetch feedback' });
  }
};

// GET /api/nps-feedback/stats — Get summary stats (superadmin only)
export const getFeedbackStats = async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const userType = VALID_USER_TYPES.includes(req.query.userType as string)
      ? (req.query.userType as string)
      : undefined;
    const stats = await getNpsFeedbackStats({ startDate, endDate, userType });
    return res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching NPS feedback stats:', error);
    return res.status(500).json({ message: 'Failed to fetch feedback stats' });
  }
};
