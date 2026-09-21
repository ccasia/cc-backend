import { ApifyClient } from 'apify-client';

import type { ExtractionConfig } from '@configs/guestProfileExtractionConfig';

/**
 * The only place this backend talks to Apify.
 *
 * Everything below the interface is replaceable, so tests run a fake gateway
 * and never spend money or touch the network.
 */

export type RunState =
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'ABORTING'
  | 'ABORTED'
  | 'TIMING-OUT'
  | 'TIMED-OUT';

export interface RunSnapshot {
  runId: string;
  state: RunState;
  /** The build that actually ran. Checked against the pinned build. */
  buildNumber: string | null;
  defaultDatasetId: string | null;
  costUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StartRunInput {
  actorId: string;
  build: string;
  input: Record<string, unknown>;
  timeoutSecs: number;
  maxItems: number;
}

export type StartRunResult =
  | { ok: true; runId: string }
  /**
   * The call may or may not have started a paid run. The caller must record
   * REQUIRES_RECONCILIATION and must never start another run.
   */
  | { ok: false; ambiguous: true; message: string }
  | { ok: false; ambiguous: false; code: string; message: string };

export interface ApifyGateway {
  startRun(input: StartRunInput): Promise<StartRunResult>;
  getRun(runId: string): Promise<RunSnapshot | null>;
  listDatasetItems(datasetId: string, limit: number): Promise<unknown[]>;
  /** Reconciliation only. Finds a run this backend may have started already. */
  findRecentRun(actorId: string, startedAfter: Date): Promise<RunSnapshot[]>;
}

/** A start failure we can be sure did not create a run. */
const DEFINITE_FAILURES = /^(400|401|403|404)$/;

export function createApifyGateway(config: ExtractionConfig): ApifyGateway {
  const client = new ApifyClient({ token: config.token });

  return {
    async startRun(input) {
      try {
        // The build belongs in the start options. Never a colon-qualified
        // actor ID such as `actorId:build`.
        const run = await client.actor(input.actorId).start(input.input, {
          build: input.build,
          timeout: input.timeoutSecs,
          maxItems: input.maxItems,
          // No blind restart. A failed run is a decision for the worker.
        });

        if (!run?.id) {
          return { ok: false, ambiguous: true, message: 'The start call returned no run ID.' };
        }
        return { ok: true, runId: run.id };
      } catch (error) {
        const status = String((error as { statusCode?: number })?.statusCode ?? '');
        const message = (error as Error)?.message ?? 'The start call failed.';

        if (DEFINITE_FAILURES.test(status)) {
          return { ok: false, ambiguous: false, code: `HTTP_${status}`, message };
        }
        // A timeout or a 5xx may still have started a paid run.
        return { ok: false, ambiguous: true, message };
      }
    },

    async getRun(runId) {
      const run = await client.run(runId).get();
      if (!run) return null;

      return {
        runId: run.id,
        state: run.status as RunState,
        buildNumber: run.buildNumber ?? null,
        defaultDatasetId: run.defaultDatasetId ?? null,
        costUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null,
        startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
        finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
      };
    },

    async listDatasetItems(datasetId, limit) {
      const page = await client.dataset(datasetId).listItems({ limit, clean: true });
      return page.items ?? [];
    },

    async findRecentRun(actorId, startedAfter) {
      const page = await client.actor(actorId).runs().list({ desc: true, limit: 50 });
      return (page.items ?? [])
        .filter((run) => !!run.startedAt && new Date(run.startedAt) >= startedAfter)
        .map((run) => ({
          runId: run.id,
          state: run.status as RunState,
          buildNumber: run.buildNumber ?? null,
          defaultDatasetId: run.defaultDatasetId ?? null,
          costUsd:
            typeof (run as { usageTotalUsd?: number }).usageTotalUsd === 'number'
              ? ((run as { usageTotalUsd?: number }).usageTotalUsd ?? null)
              : null,
          startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
          finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
        }));
    },
  };
}
