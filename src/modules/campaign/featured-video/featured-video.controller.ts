import { Request, Response } from 'express';
import {
  FeaturedVideoError,
  FeaturedVideoTarget,
  canManageCampaign,
  canViewCampaign,
  listFeaturedVideos,
  setFeaturedVideo,
} from './featured-video.service';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof FeaturedVideoError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

export const listFeaturedVideosHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  try {
    // Same 403 whether the campaign is missing or not theirs, so IDs can't be probed.
    if (!(await canViewCampaign(req.userId as string, campaignId))) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json(await listFeaturedVideos(campaignId));
  } catch (error) {
    return handleError(res, error, 'Error fetching featured videos');
  }
};

export const setFeaturedVideoHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  const { submissionId, manualEntryId, postUrl, featured } = req.body ?? {};

  if ((submissionId === undefined) === (manualEntryId === undefined)) {
    return res.status(400).json({ message: 'Provide exactly one of submissionId or manualEntryId' });
  }
  if (typeof featured !== 'boolean') return res.status(400).json({ message: 'featured must be a boolean' });

  let target: FeaturedVideoTarget;
  if (manualEntryId !== undefined) {
    if (typeof manualEntryId !== 'string' || !manualEntryId) {
      return res.status(400).json({ message: 'manualEntryId must be a non-empty string' });
    }
    target = { manualEntryId };
  } else {
    if (typeof submissionId !== 'string' || !submissionId) {
      return res.status(400).json({ message: 'submissionId must be a non-empty string' });
    }
    if (typeof postUrl !== 'string' || !postUrl.trim()) {
      return res.status(400).json({ message: 'postUrl is required' });
    }
    target = { submissionId, postUrl: postUrl.trim() };
  }

  try {
    if (!(await canManageCampaign(req.userId as string, campaignId))) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const state = await setFeaturedVideo(campaignId, target, featured, req.userId as string);
    return res.status(200).json(state);
  } catch (error) {
    return handleError(res, error, 'Error updating featured video');
  }
};
