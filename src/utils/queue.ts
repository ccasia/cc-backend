import { Queue } from 'bullmq';
import connection from '@configs/redis';

export const invoiceQueue = new Queue('invoice-queue', {
  connection,
});

export const bulkInvoiceQueue = new Queue('bulk-invoice-queue', {
  connection,
});

export const xeroWebhookQueue = new Queue('xero-webhook-queue', {
  connection,
});

/**
 * Guest profile extraction. Its own queue on purpose, so paid provider work
 * never shares a worker with invoice processing.
 */
export const engagementExtractionQueue = new Queue('engagement-extraction-queue', {
  connection,
  defaultJobOptions: {
    // No blind restart. A failed provider run is a decision for the worker,
    // and a retry must never start a second paid run by itself.
    attempts: 1,
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});

/**
 * Put one extraction on the queue.
 *
 * The job ID is the extraction ID, so one durable work record can only ever
 * have one job. BullMQ keeps a finished job under that ID (failed ones for a
 * day), and `add` silently ignores a duplicate ID rather than raising. A plain
 * `add` therefore does nothing for a record that has already run, which made
 * reconciliation report a requeue that never happened.
 *
 * So a finished job is cleared first. A job that is still waiting, delayed or
 * active is left alone: it is going to run on its own, and removing it could
 * start a second paid provider run.
 */
export async function enqueueExtraction(
  extractionId: string,
  options: { removeOnComplete?: boolean } = {},
): Promise<void> {
  const existing = await engagementExtractionQueue.getJob(extractionId);

  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
    } else {
      // Already queued or running. Adding again would be the no-op anyway.
      return;
    }
  }

  await engagementExtractionQueue.add(
    'extract',
    { extractionId },
    { jobId: extractionId, ...(options.removeOnComplete ? { removeOnComplete: true } : {}) },
  );
}

/**
 * One Bright Data scrape per approved post per day, for creators with no
 * connected account. One attempt only: a retry would start a second paid job.
 */
export const postMetricsScrapeQueue = new Queue('post-metrics-scrape-queue', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});

/**
 * The job ID dedupes a burst of enqueues for one post. The durable once-a-day
 * rule is `SubmissionPostingUrl.metricsScrapedAt`, checked by the worker.
 */
export interface PostScrapeJobData {
  postingUrlId: string;
  /** Carried so the API can tell the campaign room when the job ends. */
  campaignId: string;
  submissionId: string;
}

export async function enqueuePostScrape(data: PostScrapeJobData): Promise<void> {
  const jobId = `post-scrape-${data.postingUrlId}`;
  const existing = await postMetricsScrapeQueue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed') return;
    await existing.remove();
  }

  await postMetricsScrapeQueue.add('scrape', data, { jobId });
}

/**
 * One job per approved submission. It only plans: it extracts the links and
 * queues a scrape for each unconnected one. Planning spends no credits, so it
 * may retry; the paid scrape below never does.
 */
export const postingLinkApprovedQueue = new Queue('posting-link-approved-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});

/**
 * A waiting job already reads the submission's current links when it runs,
 * so a second approval event for the same submission is dropped.
 */
export async function enqueuePostingLinkApproved(submissionId: string): Promise<void> {
  const jobId = `posting-link-approved-${submissionId}`;
  const existing = await postingLinkApprovedQueue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed') return;
    await existing.remove();
  }

  await postingLinkApprovedQueue.add('plan', { submissionId }, { jobId });
}
