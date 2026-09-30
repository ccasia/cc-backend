// Must be the first import: it populates `process.env` before any module
// below reads it. Docker resolves `env_file` when a container is created, not
// when it restarts, so without this the worker runs on whatever environment
// existed at creation time and silently ignores a later `.env` edit. dotenv
// never overwrites a variable that is already set, so a real deployment
// environment still wins.
import 'dotenv/config';

import { Worker } from 'bullmq';

import connection from '@configs/redis';
import { loadExtractionConfig } from '@configs/guestProfileExtractionConfig';
import { createBrightDataGateway } from '@services/guestProfileExtraction/brightDataGateway';
import {
  cleanupExpiredExtractions,
  getExtractionHealth,
  processExtraction,
  reconcileExtractions,
  type ExtractionDeps,
} from '@services/guestProfileExtraction/guestProfileExtractionService';
import { applyExtractionToPendingPitchesSafe } from '@services/guestProfileExtraction/pendingPitchMetrics';
import { cacheDiscoveryThumbnail } from '@services/socialMediaService';
import { enqueueExtraction } from '@utils/queue';
import { prisma } from '@/src/prisma/prisma';

/**
 * Dedicated worker for guest profile extraction.
 *
 * Run it as its own process:
 *   yarn run-engagement-worker
 *
 * It is deliberately separate from the invoice worker and runs at low
 * concurrency, because every job here can spend money. Each extraction holds a
 * slot for up to BRIGHTDATA_POLL_TIMEOUT_SECONDS while Bright Data works.
 */

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const HEALTH_INTERVAL_MS = 60_000;

const config = loadExtractionConfig();

const deps: ExtractionDeps = {
  store: prisma as never,
  gateway: createBrightDataGateway(config),
  config,
  // One durable work record, one job. A finished job under the same ID is
  // cleared first, or reconciliation could never requeue anything.
  enqueue: (extractionId: string) => enqueueExtraction(extractionId, { removeOnComplete: true }),
  log: (message, context) => console.log(`[engagement-worker] ${message}`, context ?? ''),
  cacheThumbnail: cacheDiscoveryThumbnail,
};

const worker = new Worker(
  'engagement-extraction-queue',
  async (job) => {
    const { extractionId } = job.data as { extractionId: string };
    await processExtraction(extractionId, deps);
    try {
      await applyExtractionToPendingPitchesSafe(extractionId, prisma as never, (message, context) =>
        console.error(`[engagement-worker] ${message}`, context ?? ''),
      );
    } catch (error) {
      console.error(
        `[engagement-worker] pending pitch apply failed for ${extractionId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  },
  { connection, concurrency: config.workerConcurrency },
);

worker.on('failed', (job, error) => {
  console.error(`[engagement-worker] job ${job?.id} failed:`, error?.message);
});

worker.on('ready', () => {
  // The datasets and contract versions are logged so a stale container is
  // easy to spot: Docker bakes `env_file` at container creation, so a
  // restarted (not recreated) container can run an older build. Never the token.
  const describe = (platform: 'instagram' | 'tiktok') => {
    const { posts, profile, contractVersion } = config.scrapers[platform];
    return `${contractVersion} posts=${posts.datasetId}${posts.discoverBy ? `(${posts.discoverBy})` : ''} profile=${profile.datasetId}`;
  };
  console.log(`[engagement-worker] ready, concurrency ${config.workerConcurrency}`, {
    instagram: describe('instagram'),
    tiktok: describe('tiktok'),
    pollTimeoutSeconds: config.pollTimeoutSeconds,
    maxPostsPerProfile: config.maxPostsPerProfile,
  });
});

/** Recover work the previous process left behind. */
let reconciling = false;

async function reconcileNow(): Promise<void> {
  // A slow pass must never overlap the next one: two passes would double the
  // requests to Bright Data and could match the same row twice.
  if (reconciling) return;
  reconciling = true;
  try {
    const report = await reconcileExtractions(deps);
    if (report.rateLimited) {
      console.error('[engagement-worker] ALERT Bright Data answered 429 during reconciliation; paused until next pass');
    }
    if (report.exhausted.length > 0) {
      console.error('[engagement-worker] ALERT reconciliation gave up on:', report.exhausted.join(', '));
      for (const extractionId of report.exhausted) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await applyExtractionToPendingPitchesSafe(extractionId, prisma as never, (message, context) =>
            console.error(`[engagement-worker] ${message}`, context ?? ''),
          );
        } catch (error) {
          console.error(
            `[engagement-worker] pending pitch apply failed for ${extractionId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
  } catch (error) {
    console.error('[engagement-worker] ALERT reconciliation failed:', (error as Error)?.message);
  } finally {
    reconciling = false;
  }
}

async function reportHealth(): Promise<void> {
  try {
    const health = await getExtractionHealth(deps);
    if (!health.healthy) {
      health.alerts.forEach((alert) => console.error(`[engagement-worker] ALERT ${alert}`));
    }
  } catch (error) {
    console.error('[engagement-worker] health check failed:', (error as Error)?.message);
  }
}

void reconcileNow();
setInterval(() => void reconcileNow(), RECONCILE_INTERVAL_MS).unref();
setInterval(() => void reportHealth(), HEALTH_INTERVAL_MS).unref();
setInterval(() => void cleanupExpiredExtractions(deps), 6 * 60 * 60_000).unref();

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[engagement-worker] ${signal} received, closing`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
