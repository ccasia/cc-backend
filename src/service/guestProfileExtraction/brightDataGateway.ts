import axios, { type AxiosInstance } from 'axios';

import { BRIGHTDATA_API_BASE_URL, type ExtractionConfig } from '@configs/guestProfileExtractionConfig';

/**
 * The only place this backend talks to Bright Data.
 *
 * Everything below the interface is replaceable, so tests run a fake gateway
 * and never spend money or touch the network.
 *
 * Rules that come from Bright Data, not from us:
 *  - 25 or more 429 responses inside 5 minutes blacklist the server's IP until
 *    support clears it. A 429 is therefore a definite failure that is never
 *    retried automatically; an admin retries.
 *  - A rerun is a new paid job. Nothing here ever reruns.
 *  - A canceled job delivers no data and stops billing.
 */

/** `starting|running` -> RUNNING, `ready` -> SUCCEEDED, `failed`, `canceled`. */
export type JobState = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface JobSnapshot {
  /** Bright Data `snapshot_id`, for example `sd_m1a2b3c4d5`. */
  jobId: string;
  state: JobState;
  /** Bright Data `error_message` on a failed job, for example "Snapshot is empty". */
  errorMessage: string | null;
}

export interface StartJobInput {
  datasetId: string;
  /** Adds `type=discover_new&discover_by=<value>` when set. */
  discoverBy: string | null;
  input: Record<string, unknown>[];
}

export type StartRunResult =
  | { ok: true; runId: string }
  /**
   * The call may or may not have started a paid job. The caller must record
   * REQUIRES_RECONCILIATION and must never start another job.
   */
  | { ok: false; ambiguous: true; message: string }
  | { ok: false; ambiguous: false; code: string; message: string };

export interface ScraperGateway {
  startJob(input: StartJobInput): Promise<StartRunResult>;
  /** Null when Bright Data answers 404 "Snapshot does not exist". */
  getJob(jobId: string): Promise<JobSnapshot | null>;
  listItems(jobId: string): Promise<unknown[]>;
  /** Best effort. Never throws: a cancel that fails only costs money. */
  cancelJob(jobId: string): Promise<void>;
  /**
   * Reconciliation only. Finds the job an ambiguous start may have created.
   *
   * Returns matches best first: a running or ready job before a failed or
   * canceled one, then the oldest after `since`. Job IDs in `excludeJobIds`
   * (owned by other rows) are never returned. Throws `RateLimitedError` on a
   * 429, so the caller can stop the whole pass.
   */
  findRecentJobs(
    datasetId: string,
    since: Date,
    inputUrl: string,
    options?: { excludeJobIds?: readonly string[] },
  ): Promise<JobSnapshot[]>;
}

/**
 * Bright Data answered 429. Repeated 429s blacklist the server's IP, so a
 * caller that sees this must stop sending requests for now, not retry.
 */
export class RateLimitedError extends Error {
  constructor(message = 'Bright Data answered 429 Too Many Requests.') {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/** A trigger failure we can be sure did not create a job. */
const DEFINITE_FAILURES = /^(400|401|403|404)$/;

/** Short enough that a hung call cannot hold a worker slot for long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Reconciliation lists this many recent jobs, at most. */
const RECONCILE_SCAN_LIMIT = 50;

/**
 * Input reads per lookup, at most. Each read is one request, and a burst of
 * them is how reconciliation could reach Bright Data's 429 blacklist.
 */
const RECONCILE_MAX_INPUT_READS = 10;

/** Pause between input reads, so one lookup never bursts. */
const RECONCILE_READ_PAUSE_MS = 250;

/** Bright Data's clock and ours may differ a little. */
const CLOCK_SKEW_MS = 60_000;

const STATE_BY_STATUS: Record<string, JobState> = {
  starting: 'RUNNING',
  running: 'RUNNING',
  ready: 'SUCCEEDED',
  failed: 'FAILED',
  canceled: 'CANCELLED',
  cancelled: 'CANCELLED',
};

/**
 * An unknown status is read as still running. The poll deadline then cancels
 * the job, which is safer than treating it as done and reading no data.
 */
export const toJobState = (status: unknown): JobState =>
  STATE_BY_STATUS[String(status ?? '').toLowerCase()] ?? 'RUNNING';

const statusOf = (error: unknown): number | null => {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : null;
};

const messageOf = (error: unknown, fallback: string): string => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 500);
  if (data && typeof data === 'object') {
    const fields = data as { error?: unknown; message?: unknown };
    if (typeof fields.error === 'string') return fields.error.slice(0, 500);
    if (typeof fields.message === 'string') return fields.message.slice(0, 500);
  }
  return (error as Error)?.message ?? fallback;
};

const normalizeUrl = (url: unknown): string =>
  typeof url === 'string' ? url.trim().toLowerCase().replace(/\/+$/, '') : '';

function toSnapshot(jobId: string, body: unknown): JobSnapshot {
  const fields = (body ?? {}) as { status?: unknown; error_message?: unknown; error?: unknown };
  const error = typeof fields.error_message === 'string' ? fields.error_message : fields.error;
  return {
    jobId,
    state: toJobState(fields.status),
    errorMessage: typeof error === 'string' && error.trim() ? error.trim() : null,
  };
}

export interface GatewayOptions {
  /** Pause between reconciliation input reads. Tests pass 0. */
  readPauseMs?: number;
}

const wait = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export function createBrightDataGateway(
  config: ExtractionConfig,
  http?: AxiosInstance,
  options: GatewayOptions = {},
): ScraperGateway {
  const readPauseMs = options.readPauseMs ?? RECONCILE_READ_PAUSE_MS;
  const client =
    http ??
    axios.create({
      baseURL: BRIGHTDATA_API_BASE_URL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    });

  return {
    async startJob({ datasetId, discoverBy, input }) {
      const params: Record<string, string> = { dataset_id: datasetId, format: 'json', include_errors: 'true' };
      if (discoverBy) {
        params.type = 'discover_new';
        params.discover_by = discoverBy;
      }

      try {
        const response = await client.post('/datasets/v3/trigger', input, { params });
        const snapshotId = (response.data as { snapshot_id?: unknown })?.snapshot_id;
        if (typeof snapshotId !== 'string' || !snapshotId) {
          return { ok: false, ambiguous: true, message: 'The trigger call returned no snapshot_id.' };
        }
        return { ok: true, runId: snapshotId };
      } catch (error) {
        const status = statusOf(error);
        const message = messageOf(error, 'The trigger call failed.');

        // Bright Data refused the job: nothing was created. Never retried here,
        // because repeated 429s blacklist the server's IP.
        if (status === 429) return { ok: false, ambiguous: false, code: 'RATE_LIMITED', message };
        if (status !== null && DEFINITE_FAILURES.test(String(status))) {
          return { ok: false, ambiguous: false, code: `HTTP_${status}`, message };
        }
        // A timeout, a 5xx, or a dropped connection may still have started a
        // paid job.
        return { ok: false, ambiguous: true, message };
      }
    },

    async getJob(jobId) {
      try {
        const response = await client.get(`/datasets/v3/progress/${encodeURIComponent(jobId)}`);
        return toSnapshot(jobId, response.data);
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },

    async listItems(jobId) {
      const response = await client.get(`/datasets/v3/snapshot/${encodeURIComponent(jobId)}`, {
        params: { format: 'json' },
      });
      // A ready job answers with the array. Anything else (for example a 202
      // `{ status: 'building' }`) is not data; throwing leaves the record for
      // reconciliation to resume rather than parsing nothing as "no posts".
      if (!Array.isArray(response.data)) {
        throw new Error(`Snapshot ${jobId} returned no item array (HTTP ${response.status}).`);
      }
      return response.data;
    },

    async cancelJob(jobId) {
      try {
        await client.post(`/datasets/v3/snapshot/${encodeURIComponent(jobId)}/cancel`);
      } catch {
        // 400 "Snapshot is not running" means it already finished. Any other
        // failure only means the job runs to its end and is billed.
      }
    },

    async findRecentJobs(datasetId, since, inputUrl, { excludeJobIds = [] } = {}) {
      // Any 429 here ends the lookup at once. See RateLimitedError.
      const get = async (url: string, config?: Record<string, unknown>) => {
        try {
          return await client.get(url, config);
        } catch (error) {
          if (statusOf(error) === 429) throw new RateLimitedError(messageOf(error, 'Too many requests.'));
          throw error;
        }
      };

      const response = await get('/datasets/v3/snapshots', {
        params: {
          dataset_id: datasetId,
          from_date: new Date(since.getTime() - CLOCK_SKEW_MS).toISOString(),
          trigger_type: 'API',
          limit: RECONCILE_SCAN_LIMIT,
        },
      });

      const excluded = new Set(excludeJobIds);
      const earliest = since.getTime() - CLOCK_SKEW_MS;
      const rows = (Array.isArray(response.data) ? response.data : [])
        .map((row) => {
          const fields = (row ?? {}) as { id?: unknown; snapshot_id?: unknown; created?: unknown };
          const jobId = typeof fields.id === 'string' ? fields.id : fields.snapshot_id;
          const created = typeof fields.created === 'string' ? Date.parse(fields.created) : Number.NaN;
          return { row, jobId: typeof jobId === 'string' && jobId ? jobId : null, created };
        })
        // Another row's job is never ours, so it is skipped without a read.
        .filter(
          (entry): entry is { row: unknown; jobId: string; created: number } =>
            entry.jobId !== null && !excluded.has(entry.jobId),
        )
        // The date filter is applied again here, in case the API reads
        // `from_date` at day granularity.
        .filter((entry) => Number.isNaN(entry.created) || entry.created >= earliest)
        // Oldest first: this row made one start attempt, right after `since`.
        .sort((a, b) => (a.created || 0) - (b.created || 0));

      const wanted = normalizeUrl(inputUrl);
      const alive: JobSnapshot[] = [];
      const dead: JobSnapshot[] = [];
      let reads = 0;

      for (const entry of rows) {
        if (reads >= RECONCILE_MAX_INPUT_READS) break;
        // eslint-disable-next-line no-await-in-loop
        if (reads > 0) await wait(readPauseMs);
        reads += 1;

        // A job is ours only when its input names this exact profile. Many
        // profiles share one dataset.
        // eslint-disable-next-line no-await-in-loop
        const inputs = await get(`/datasets/v3/snapshot/${encodeURIComponent(entry.jobId)}/input`);
        const list = Array.isArray(inputs.data) ? inputs.data : [];
        if (!list.some((item) => normalizeUrl((item as { url?: unknown })?.url) === wanted)) continue;

        const snapshot = toSnapshot(entry.jobId, entry.row);
        if (snapshot.state === 'RUNNING' || snapshot.state === 'SUCCEEDED') {
          // The best possible match. No need to read further.
          alive.push(snapshot);
          break;
        }
        dead.push(snapshot);
      }
      return [...alive, ...dead];
    },
  };
}
