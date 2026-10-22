import { extractAndStoreSubmissionUrls } from '@services/submissionUrlService';
import { queuePostScrape } from './queuePostScrape';
import { notScrapedToday } from './scrapeDay';
import { prisma } from '@/src/prisma/prisma';

export const CONNECTION_SELECT = {
  isFacebookConnected: true,
  isTiktokConnected: true,
  instagramUser: { select: { id: true } },
  tiktokUser: { select: { id: true } },
} as const;

interface CreatorConnection {
  isFacebookConnected: boolean;
  isTiktokConnected: boolean;
  instagramUser: { id: string } | null;
  tiktokUser: { id: string } | null;
}

/** Connected platforms stay on the Meta/TikTok API pipeline; the rest are scraped. */
export function isPlatformConnected(creator: CreatorConnection | null | undefined, platform: string): boolean {
  if (platform === 'Instagram') return Boolean(creator?.isFacebookConnected && creator.instagramUser);
  if (platform === 'TikTok') return Boolean(creator?.isTiktokConnected && creator.tiktokUser);
  return false;
}

/**
 * Queues a Bright Data scrape for each link of a POSTED submission whose
 * platform the creator has not connected. Connected platforms stay on the
 * Meta/TikTok API pipeline; if that API later fails, insightFetchService
 * falls back to `queuePostScrape` itself.
 *
 * Runs in the engagement worker as a `posting-link-approved-queue` job. The
 * result is the job's return value; the API reads it to tell the campaign room.
 */
export interface PlanResult {
  campaignId: string | null;
  submissionId: string;
  queued: number;
}

export async function planPostScrapes(submissionId: string): Promise<PlanResult> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { content: true, userId: true, status: true, campaignId: true },
  });
  if (!submission?.content || submission.status !== 'POSTED') {
    return { campaignId: submission?.campaignId ?? null, submissionId, queued: 0 };
  }

  // Rows touched by this extraction are the submission's current links.
  // Older rows can belong to a link that was rejected and replaced.
  const extractedSince = new Date();
  await extractAndStoreSubmissionUrls(submissionId, submission.content);

  const [postingUrls, creator] = await Promise.all([
    prisma.submissionPostingUrl.findMany({
      where: { submissionId, updatedAt: { gte: extractedSince }, ...notScrapedToday(extractedSince) },
      select: { id: true, platform: true },
    }),
    prisma.creator.findUnique({
      where: { userId: submission.userId },
      select: CONNECTION_SELECT,
    }),
  ]);

  const toScrape = postingUrls.filter(({ platform }) => !isPlatformConnected(creator, platform));
  await Promise.all(
    toScrape.map(({ id }) => queuePostScrape({ postingUrlId: id, campaignId: submission.campaignId, submissionId })),
  );
  return { campaignId: submission.campaignId, submissionId, queued: toScrape.length };
}
