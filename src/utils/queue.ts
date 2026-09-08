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
