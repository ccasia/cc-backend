import { Prisma } from '@prisma/client';
import fs from 'fs/promises';
import { UploadedFile } from 'express-fileupload';
import { prisma } from '@/src/prisma/prisma';
import { getIo } from '@configs/socket';
import { uploadImage } from '@configs/cloudStorage.config';
import { canManageCampaign } from '@modules/campaign/featured-video/featured-video.service';
import {
  combineInsightValues,
  extractInsightsFromImage,
  InsightImageResult,
  InsightPlatform,
  INSIGHT_OCR_MODEL,
} from '@services/insightOcrService';
import { MAX_SCREENSHOTS } from '@utils/insightScreenshots';

export class PostInsightsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const POST_INSIGHTS_SELECT = {
  id: true,
  submissionId: true,
  postUrl: true,
  values: true,
  screenshots: true,
  conflicts: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

const PLATFORM_NAMES: Record<InsightPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

export const postPlatform = (postUrl: string): InsightPlatform | null => {
  if (/instagram\.com|instagr\.am/i.test(postUrl)) return 'instagram';
  if (/tiktok\.com/i.test(postUrl)) return 'tiktok';
  return null;
};

/** Campaign managers can do everything. Creators only reach their own submissions. */
export const getAccess = async (userId: string, campaignId: string) => ({
  isManager: await canManageCampaign(userId, campaignId),
});

/**
 * The post must be approved (POSTED) and belong to the submission, either as a
 * stored posting URL or inside the submission content.
 */
const resolvePost = async (userId: string, campaignId: string, submissionId: string, postUrl: string) => {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, campaignId },
    select: {
      userId: true,
      status: true,
      content: true,
      submissionPostingUrls: { where: { postUrl }, select: { id: true }, take: 1 },
    },
  });
  if (!submission) throw new PostInsightsError(404, 'Submission not found in this campaign');

  const { isManager } = await getAccess(userId, campaignId);
  if (!isManager && submission.userId !== userId) throw new PostInsightsError(403, 'Forbidden');

  if (submission.status !== 'POSTED') {
    throw new PostInsightsError(400, 'You can add insights only after the posting link is approved');
  }

  const isPost = !!submission.submissionPostingUrls.length || (submission.content?.includes(postUrl) ?? false);
  if (!isPost) throw new PostInsightsError(400, 'postUrl is not a post of this submission');

  return { creatorId: submission.userId };
};

// Company key first, then the uploader's own key, then the most recently saved key.
// Creators have no key, so they use the newest admin key (old keys are more likely revoked).
const resolveApiKey = async (userId: string) => {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const own = await prisma.aiModel.findFirst({ where: { userId, apiKey: { not: '' } }, select: { apiKey: true } });
  if (own?.apiKey) return own.apiKey;
  const latest = await prisma.aiModel.findFirst({
    where: { apiKey: { not: '' } },
    orderBy: { updatedAt: 'desc' },
    select: { apiKey: true },
  });
  return latest?.apiKey ?? null;
};

export const listPostInsights = async (userId: string, campaignId: string, submissionId?: string) => {
  const { isManager } = await getAccess(userId, campaignId);

  if (!isManager) {
    if (!submissionId) throw new PostInsightsError(403, 'Forbidden');
    const owns = await prisma.submission.count({ where: { id: submissionId, campaignId, userId } });
    if (!owns) throw new PostInsightsError(403, 'Forbidden');
  }

  return prisma.insightOcrResult.findMany({
    where: { campaignId, ...(submissionId && { submissionId }) },
    select: POST_INSIGHTS_SELECT,
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Tells open pages to reload this post's insights. Admins get it through the campaign room,
 * the creator through their own user room. Ids only: the campaign room has no access check.
 */
const notifyChanged = ({
  campaignId,
  submissionId,
  creatorId,
  actorId,
}: {
  campaignId: string;
  submissionId: string | null;
  creatorId: string | null;
  actorId: string;
}) => {
  try {
    const rooms = creatorId ? [campaignId, creatorId] : [campaignId];
    getIo().to(rooms).emit('post-insights:updated', { campaignId, submissionId, actorId });
  } catch (error) {
    console.error('Could not send the post insights update:', error);
  }
};

interface Uploader {
  id: string;
  name: string | null;
  role: string;
}
type StoredScreenshot = InsightImageResult & { url: string; uploadedBy?: Uploader; uploadedAt?: string };

// Values are always re-read from every screenshot, so adding or removing one keeps them in sync.
const toRowData = (screenshots: StoredScreenshot[]) => {
  const { values, conflicts } = combineInsightValues(screenshots);
  return {
    model: INSIGHT_OCR_MODEL,
    values,
    conflicts,
    screenshots: screenshots as unknown as Prisma.InputJsonValue,
    totalCostUsd: screenshots.reduce((sum, screenshot) => sum + (screenshot.usage?.costUsd ?? 0), 0),
  };
};

const readScreenshot = async (apiKey: string | null, file: UploadedFile): Promise<InsightImageResult> =>
  apiKey
    ? extractInsightsFromImage({
        apiKey,
        fileName: file.name,
        mimeType: file.mimetype,
        data: await fs.readFile(file.tempFilePath),
      })
    : {
        fileName: file.name,
        platform: 'unknown',
        screen: 'other',
        fields: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        durationMs: 0,
        error: 'No Gemini API key',
      };

/**
 * Reads the new screenshots, uploads them, and adds them to the post's insights.
 * One record is one post, so it holds one platform. Screenshots from the other platform are not saved:
 * they belong to that platform's posting link. Unknown platforms are kept, so a bad read never blocks.
 */
export const addPostInsightScreenshots = async ({
  userId,
  campaignId,
  submissionId,
  postUrl,
  files,
}: {
  userId: string;
  campaignId: string;
  submissionId: string;
  postUrl: string;
  files: UploadedFile[];
}) => {
  const { creatorId } = await resolvePost(userId, campaignId, submissionId, postUrl);

  const where = { submissionId_postUrl: { submissionId, postUrl } };
  const existing = await prisma.insightOcrResult.findUnique({ where, select: { screenshots: true } });
  const current = (existing?.screenshots ?? []) as unknown as StoredScreenshot[];

  const room = MAX_SCREENSHOTS - current.length;
  if (files.length > room) {
    throw new PostInsightsError(
      400,
      room > 0
        ? `This post has ${current.length} screenshots. You can add ${room} more.`
        : `This post already has ${MAX_SCREENSHOTS} screenshots. Remove one first.`,
    );
  }

  const [apiKey, uploader] = await Promise.all([
    resolveApiKey(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, role: true } }),
  ]);

  // Read first, so screenshots from the other platform are never uploaded.
  const images = await Promise.all(files.map((file) => readScreenshot(apiKey, file)));

  const platform = postPlatform(postUrl);
  const isOtherPlatform = (image: InsightImageResult) =>
    !!platform && image.platform !== 'unknown' && image.platform !== platform;
  const accepted = images.flatMap((image, i) => (isOtherPlatform(image) ? [] : [{ image, file: files[i] }]));
  const skipped = images
    .filter(isOtherPlatform)
    .map((image) => ({ fileName: image.fileName, platform: image.platform }));

  if (!accepted.length) {
    const other = PLATFORM_NAMES[skipped[0].platform as InsightPlatform];
    throw new PostInsightsError(
      400,
      `These are ${other} insights, but this post is on ${PLATFORM_NAMES[platform as InsightPlatform]}. Add them to the ${other} post.`,
    );
  }

  const urls = await Promise.all(accepted.map(({ file }) => uploadImage(file.tempFilePath, file.name, 'insightOcr')));

  const uploadedAt = new Date().toISOString();
  const added = accepted.map(({ image }, i) => ({ ...image, url: urls[i], uploadedBy: uploader, uploadedAt }));
  const data = toRowData([...current, ...added]);

  const result = await prisma.insightOcrResult.upsert({
    where,
    create: { ...data, campaignId, submissionId, postUrl, createdById: userId },
    update: data,
    select: POST_INSIGHTS_SELECT,
  });

  notifyChanged({ campaignId, submissionId, creatorId, actorId: userId });
  return { ...result, skipped };
};

/**
 * Removes one screenshot. Managers can remove any; others only their own.
 * Returns null when it was the last one, because the record is then deleted.
 */
export const removePostInsightScreenshot = async (userId: string, campaignId: string, id: string, url: string) => {
  const row = await prisma.insightOcrResult.findFirst({
    where: { id, campaignId },
    select: { screenshots: true, createdById: true, submissionId: true, submission: { select: { userId: true } } },
  });
  if (!row) throw new PostInsightsError(404, 'Insights not found');

  const screenshots = row.screenshots as unknown as StoredScreenshot[];
  const target = screenshots.find((screenshot) => screenshot.url === url);
  if (!target) throw new PostInsightsError(404, 'Screenshot not found');

  // Screenshots saved before uploaders were tracked belong to the record's creator.
  const uploaderId = target.uploadedBy?.id ?? row.createdById;
  const { isManager } = await getAccess(userId, campaignId);
  if (!isManager && uploaderId !== userId) throw new PostInsightsError(403, 'You can only remove your own screenshots');

  const rest = screenshots.filter((screenshot) => screenshot.url !== url);
  const result = rest.length
    ? await prisma.insightOcrResult.update({ where: { id }, data: toRowData(rest), select: POST_INSIGHTS_SELECT })
    : await prisma.insightOcrResult.delete({ where: { id } }).then(() => null);

  notifyChanged({
    campaignId,
    submissionId: row.submissionId,
    creatorId: row.submission?.userId ?? null,
    actorId: userId,
  });
  return result;
};
