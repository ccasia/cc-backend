import { Request, Response } from 'express';
import { getScreenshots, removeTempFiles, validateScreenshots } from '@utils/insightScreenshots';
import {
  PostInsightsError,
  addPostInsightScreenshots,
  listPostInsights,
  removePostInsightScreenshot,
  reviewPostInsightMetrics,
} from './post-insights.service';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof PostInsightsError) return res.status(error.status).json({ message: error.message });

  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

export const listPostInsightsHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  const submissionId = typeof req.query.submissionId === 'string' ? req.query.submissionId : undefined;

  try {
    return res.status(200).json(await listPostInsights(req.userId as string, campaignId, submissionId));
  } catch (error) {
    return handleError(res, error, 'Error fetching post insights');
  }
};

export const addPostInsightScreenshotsHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  const { submissionId, postUrl } = req.body ?? {};
  const files = getScreenshots(req);

  try {
    if (typeof submissionId !== 'string' || !submissionId) {
      return res.status(400).json({ message: 'submissionId is required' });
    }
    if (typeof postUrl !== 'string' || !postUrl.trim()) return res.status(400).json({ message: 'postUrl is required' });

    const invalid = validateScreenshots(files);
    if (invalid) return res.status(400).json({ message: invalid });

    const result = await addPostInsightScreenshots({
      userId: req.userId as string,
      campaignId,
      submissionId,
      postUrl: postUrl.trim(),
      files,
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, 'Error saving post insights');
  } finally {
    await removeTempFiles(files);
  }
};

export const removePostInsightScreenshotHandler = async (req: Request, res: Response) => {
  const { campaignId, id } = req.params;
  const { url } = req.body ?? {};

  if (typeof url !== 'string' || !url) return res.status(400).json({ message: 'url is required' });

  try {
    const result = await removePostInsightScreenshot(req.userId as string, campaignId, id, url);
    return result ? res.status(200).json(result) : res.status(204).send();
  } catch (error) {
    return handleError(res, error, 'Error removing the screenshot');
  }
};

// POST /:id/metrics-review { approve: true } uses the lower screenshot numbers; false keeps the current ones.
export const reviewPostInsightMetricsHandler = async (req: Request, res: Response) => {
  const { campaignId, id } = req.params;
  const { approve } = req.body ?? {};

  if (typeof approve !== 'boolean') return res.status(400).json({ message: 'approve must be true or false' });

  try {
    return res.status(200).json(await reviewPostInsightMetrics(req.userId as string, campaignId, id, approve));
  } catch (error) {
    return handleError(res, error, 'Error reviewing the screenshot numbers');
  }
};
