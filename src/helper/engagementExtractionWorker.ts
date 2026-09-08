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
import { createApifyGateway } from '@services/guestProfileExtraction/apifyGateway';
import {
  cleanupExpiredExtractions,
  getExtractionHealth,
  processExtraction,
  reconcileExtractions,
  type ExtractionDeps,
} from '@services/guestProfileExtraction/guestProfileExtractionService';
import { enqueueExtraction } from '@utils/queue';
import { PrismaClient } from '@prisma/client';

/**
 * Dedicated worker for guest profile extraction.
 *
 * Run it as its own process:
 *   yarn run-engagement-worker
 *
 * It is deliberately separate from the invoice worker and runs at low
 * concurrency, because every job here can spend money.
 */

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const HEALTH_INTERVAL_MS = 60_000;

const config = loadExtractionConfig();
const prisma = new PrismaClient();

const deps: ExtractionDeps = {
  store: prisma as never,
  gateway: createApifyGateway(config),
  config,
  // One durable work record, one job. A finished job under the same ID is
  // cleared first, or reconciliation could never requeue anything.
  enqueue: (extractionId: string) => enqueueExtraction(extractionId, { removeOnComplete: true }),
  log: (message, context) => console.log(`[engagement-worker] ${message}`, context ?? ''),
};

const worker = new Worker(
  'engagement-extraction-queue',
  async (job) => {
    const { extractionId } = job.data as { extractionId: string };
    await processExtraction(extractionId, deps);
  },
  { connection, concurrency: config.workerConcurrency },
);

worker.on('failed', (job, error) => {
  console.error(`[engagement-worker] job ${job?.id} failed:`, error?.message);
});

worker.on('ready', () => {
  // The resolved actors are logged because they are the one setting that can
  // be silently wrong: Docker bakes `env_file` at container creation, so a
  // restarted container can hold an actor ID the code no longer speaks to,
  // and the run then fails on input validation rather than on the actor name.
  console.log(`[engagement-worker] ready, concurrency ${config.workerConcurrency}`, {
    instagram: `${config.actors.instagram.actorId}@${config.actors.instagram.build}`,
    tiktok: `${config.actors.tiktok.actorId}@${config.actors.tiktok.build}`,
  });
});

/** Recover work the previous process left behind. */
async function reconcileNow(): Promise<void> {
  try {
    const report = await reconcileExtractions(deps);
    if (report.exhausted.length > 0) {
      console.error('[engagement-worker] ALERT reconciliation gave up on:', report.exhausted.join(', '));
    }
  } catch (error) {
    console.error('[engagement-worker] ALERT reconciliation failed:', (error as Error)?.message);
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
