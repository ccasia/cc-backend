import { QueueEvents } from 'bullmq';

import connection from '@configs/redis';
import { getIo } from '@configs/socket';
import { enqueuePostingLinkApproved, postMetricsScrapeQueue } from '@utils/queue';
import { isPrimaryInstance } from '@utils/instance';
import {
  POSTING_LINK_APPROVED_EVENT,
  postingLinkEvents,
  type PostingLinkApprovedPayload,
} from '@utils/postingLinkEvents';

/**
 * Catches posting-link approvals and hands them to BullMQ. The API process
 * does nothing else here: URL extraction, the connection check, and the paid
 * scrape all run in the engagement worker (`yarn run-engagement-worker`).
 *
 * The worker cannot reach the browser, so this process also watches both
 * queues and tells the campaign room when a scrape starts and ends:
 *  - `analytics:post-scrape:queued`  { campaignId, submissionId }
 *  - `analytics:post-scrape:finished` { campaignId, submissionId, outcome }
 */
export const POST_SCRAPE_QUEUED_EVENT = 'analytics:post-scrape:queued';
export const POST_SCRAPE_FINISHED_EVENT = 'analytics:post-scrape:finished';

postingLinkEvents.on(POSTING_LINK_APPROVED_EVENT, ({ submissionId }: PostingLinkApprovedPayload) => {
  enqueuePostingLinkApproved(submissionId).catch((error: Error) =>
    console.error(`❌ Failed to queue posting-link approval for submission ${submissionId}:`, error.message),
  );
});

interface ScrapeJobResult {
  campaignId?: string | null;
  submissionId?: string;
  queued?: number;
  outcome?: string;
}

/** BullMQ hands the return value over as a JSON string. */
const readResult = (returnvalue: unknown): ScrapeJobResult => {
  if (typeof returnvalue !== 'string') return (returnvalue ?? {}) as ScrapeJobResult;
  try {
    return JSON.parse(returnvalue) as ScrapeJobResult;
  } catch {
    return {};
  }
};

const emitToCampaign = (event: string, payload: ScrapeJobResult): void => {
  if (!payload.campaignId) return;
  try {
    getIo().to(payload.campaignId).emit(event, payload);
  } catch (error) {
    console.error(`❌ Could not emit ${event}:`, (error as Error).message);
  }
};

// Every API copy would receive these queue events, so only the primary copy relays them.
// The approval handler above stays on every copy: the approving request can land on any of them.
if (isPrimaryInstance) {
  const planEvents = new QueueEvents('posting-link-approved-queue', { connection });
  const scrapeEvents = new QueueEvents('post-metrics-scrape-queue', { connection });

  planEvents.on('completed', ({ returnvalue }) => {
    const result = readResult(returnvalue);
    if (result.queued) emitToCampaign(POST_SCRAPE_QUEUED_EVENT, result);
  });

  scrapeEvents.on('completed', ({ returnvalue }) => {
    const { campaignId, submissionId, outcome } = readResult(returnvalue);
    emitToCampaign(POST_SCRAPE_FINISHED_EVENT, { campaignId, submissionId, outcome });
  });

  scrapeEvents.on('failed', async ({ jobId }) => {
    try {
      const job = await postMetricsScrapeQueue.getJob(jobId);
      const { campaignId, submissionId } = (job?.data ?? {}) as ScrapeJobResult;
      emitToCampaign(POST_SCRAPE_FINISHED_EVENT, { campaignId, submissionId, outcome: 'FAILED' });
    } catch (error) {
      console.error(`❌ Could not report failed post scrape ${jobId}:`, (error as Error).message);
    }
  });
}
