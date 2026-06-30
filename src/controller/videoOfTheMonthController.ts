import { Request, Response } from 'express';

import {
  getFeaturedVideos,
  listCuratedVideos,
  searchFeaturableSubmissions,
  createFeaturedVideo,
  updateFeaturedVideo,
  deleteFeaturedVideo,
} from '@services/videoOfTheMonthService';

// GET /api/creator/videos-of-the-month — mobile home feed
export const getVideosOfTheMonth = async (_req: Request, res: Response) => {
  try {
    const videos = await getFeaturedVideos();
    return res.status(200).json(videos);
  } catch (error) {
    console.error('getVideosOfTheMonth error', error);
    return res.status(500).json({ message: 'Failed to load videos of the month' });
  }
};

// GET /api/video-of-the-month — admin curation table
export const getCuratedVideos = async (_req: Request, res: Response) => {
  try {
    const videos = await listCuratedVideos();
    return res.status(200).json(videos);
  } catch (error) {
    console.error('getCuratedVideos error', error);
    return res.status(500).json({ message: 'Failed to load curated videos' });
  }
};

// GET /api/video-of-the-month/submissions?search= — pickable submissions
export const getFeaturableSubmissions = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const submissions = await searchFeaturableSubmissions(search);
    return res.status(200).json(submissions);
  } catch (error) {
    console.error('getFeaturableSubmissions error', error);
    return res.status(500).json({ message: 'Failed to search submissions' });
  }
};

// POST /api/video-of-the-month
export const addVideoOfTheMonth = async (req: Request, res: Response) => {
  try {
    const createdById = req.userId;
    if (!createdById) {
      return res.status(401).json({ message: 'You are not logged in' });
    }

    const { submissionId, videoIndex, order } = req.body ?? {};
    if (!submissionId || typeof submissionId !== 'string') {
      return res.status(400).json({ message: 'submissionId is required' });
    }

    const created = await createFeaturedVideo({
      submissionId,
      videoIndex: typeof videoIndex === 'number' ? videoIndex : undefined,
      order: typeof order === 'number' ? order : undefined,
      createdById,
    });
    return res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN';
    if (message === 'SUBMISSION_NOT_FOUND') {
      return res.status(404).json({ message: 'Submission not found' });
    }
    if (message === 'SUBMISSION_HAS_NO_VIDEO') {
      return res.status(400).json({ message: 'That submission has no video to feature' });
    }
    if (message === 'VIDEO_INDEX_OUT_OF_RANGE') {
      return res.status(400).json({ message: 'videoIndex is out of range for that submission' });
    }
    // Unique constraint on submissionId — already featured.
    if ((error as { code?: string })?.code === 'P2002') {
      return res.status(409).json({ message: 'That submission is already featured' });
    }
    console.error('addVideoOfTheMonth error', error);
    return res.status(500).json({ message: 'Failed to feature video' });
  }
};

// PATCH /api/video-of-the-month/:id
export const editVideoOfTheMonth = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { order, featured, videoIndex } = req.body ?? {};

    const updated = await updateFeaturedVideo(id, {
      order: typeof order === 'number' ? order : undefined,
      featured: typeof featured === 'boolean' ? featured : undefined,
      videoIndex: typeof videoIndex === 'number' ? videoIndex : undefined,
    });
    return res.status(200).json(updated);
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ message: 'Featured video not found' });
    }
    console.error('editVideoOfTheMonth error', error);
    return res.status(500).json({ message: 'Failed to update featured video' });
  }
};

// DELETE /api/video-of-the-month/:id
export const removeVideoOfTheMonth = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteFeaturedVideo(id);
    return res.status(204).send();
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ message: 'Featured video not found' });
    }
    console.error('removeVideoOfTheMonth error', error);
    return res.status(500).json({ message: 'Failed to remove featured video' });
  }
};
