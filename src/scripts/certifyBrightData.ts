/**
 * Live certification of the Bright Data datasets that guest profile extraction
 * reads. SPENDS BRIGHT DATA CREDITS: each profile triggers a posts job and a
 * profile job (about `--posts` records plus one).
 *
 * For each profile it triggers both jobs, polls `/progress`, downloads the
 * snapshot, saves SANITIZED output as a test fixture, and prints a coverage
 * report: date presence, view counters, list order, pinned join, TikTok
 * counter types, error row shapes, records per job, and job duration.
 *
 * Usage:
 *   BRIGHTDATA_API_TOKEN=... npx tsx src/scripts/certifyBrightData.ts \
 *     https://www.instagram.com/<handle>=normal \
 *     https://www.tiktok.com/@<handle>=normal \
 *     [--posts=20] [--compare-ig-modes] [--timeout=600]
 *
 * `<url>=<case>` names the fixture: `<platform>-<case>-<purpose>.json` in
 * test/guestProfileExtraction/fixtures/brightdata/. `--compare-ig-modes` also
 * runs the first Instagram profile with `discover_by=url` next to
 * `url_all_reels`.
 */
import 'dotenv/config';

import fs from 'fs';
import path from 'path';

import axios, { type AxiosInstance } from 'axios';

import { BRIGHTDATA_API_BASE_URL, SCRAPERS, type ScraperJob } from '../config/guestProfileExtractionConfig';
import { normalizeProfileUrl } from '../service/guestProfileExtraction/profileUrlNormalizer';
import type { SupportedPlatform } from '../types/guestProfileExtraction';

const FIXTURE_DIR = path.join(__dirname, '../../test/guestProfileExtraction/fixtures/brightdata');

/** Personal or bulky content that must never land in a fixture. */
const DROP_KEYS = new Set([
  'description',
  'caption',
  'biography',
  'bio',
  'top_comments',
  'latest_comments',
  'email',
  'business_email',
  'phone',
  'business_phone',
  'external_url',
  'bio_link',
  'links',
  'transcript',
  'subtitles',
  'music',
  'audio',
  'profile_biography',
  'signature',
  'bio_hashtags',
  'bio_link',
  'email_address',
  'external_urls',
  'external_url_title',
  'hashtags',
  'post_hashtags',
  'tagged_users',
  'tagged_user',
  'highlights',
  'pronouns',
  'fbid',
  'partner_id',
  'profile_name',
  'top_videos',
  'top_posts_data',
  'carousel_images',
  'original_sound',
  'subtitle_info',
]);

/** Links that identify the post or profile stay; every other URL is media. */
const KEEP_URL_KEYS = new Set(['url', 'profile_url', 'input', 'post_url']);

export function sanitize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      // `comments` is a count on grid posts and a list of texts elsewhere.
      if (k === 'comments' && Array.isArray(v)) continue;
      const cleaned = sanitize(v, k);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && !KEEP_URL_KEYS.has(key)) return undefined;
  return value;
}

interface JobRun {
  label: string;
  snapshotId: string | null;
  status: string;
  errorMessage: string | null;
  seconds: number;
  items: unknown[];
  triggerError: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runJob(
  http: AxiosInstance,
  label: string,
  job: ScraperJob,
  input: Record<string, unknown>[],
  timeoutSeconds: number,
): Promise<JobRun> {
  const started = Date.now();
  const params: Record<string, string> = { dataset_id: job.datasetId, format: 'json', include_errors: 'true' };
  if (job.discoverBy) {
    params.type = 'discover_new';
    params.discover_by = job.discoverBy;
  }

  let snapshotId: string;
  try {
    const response = await http.post('/datasets/v3/trigger', input, { params });
    snapshotId = response.data?.snapshot_id;
    if (!snapshotId) throw new Error(`no snapshot_id: ${JSON.stringify(response.data)}`);
  } catch (error) {
    const data = (error as { response?: { status?: number; data?: unknown } }).response;
    return {
      label,
      snapshotId: null,
      status: 'trigger_failed',
      errorMessage: null,
      seconds: 0,
      items: [],
      triggerError: data ? `HTTP ${data.status}: ${JSON.stringify(data.data)}` : (error as Error).message,
    };
  }
  console.log(`  ${label}: triggered ${snapshotId}`);

  let status = 'starting';
  let errorMessage: string | null = null;
  while ((Date.now() - started) / 1000 < timeoutSeconds) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(5000);
    try {
      // eslint-disable-next-line no-await-in-loop
      const progress = await http.get(`/datasets/v3/progress/${snapshotId}`);
      status = String(progress.data?.status ?? 'unknown');
      errorMessage = progress.data?.error_message ?? progress.data?.error ?? null;
    } catch (error) {
      status = `progress_error_${(error as { response?: { status?: number } }).response?.status ?? 'network'}`;
    }
    if (['ready', 'failed', 'canceled'].includes(status)) break;
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  if (status !== 'ready') {
    if (!['failed', 'canceled'].includes(status)) {
      await http.post(`/datasets/v3/snapshot/${snapshotId}/cancel`).catch(() => undefined);
      status = `timeout(${status}) -> canceled`;
    }
    return { label, snapshotId, status, errorMessage, seconds, items: [], triggerError: null };
  }

  const download = await http.get(`/datasets/v3/snapshot/${snapshotId}`, { params: { format: 'json' } });
  const items = Array.isArray(download.data) ? download.data : [];
  return { label, snapshotId, status, errorMessage, seconds, items, triggerError: null };
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${Math.round((100 * n) / d)}%`);
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const isErrorRow = (item: any) => !!(item?.error || item?.error_code);

function shortcodeOf(url: unknown): string | null {
  return (typeof url === 'string' && /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url)?.[1]) || null;
}

function newestFirst(dates: (string | null | undefined)[]): string {
  const ms = dates.filter(has).map((d) => Date.parse(d as string));
  if (ms.length < 2) return 'n/a (<2 dates)';
  const sorted = ms.every((v, i) => i === 0 || v <= ms[i - 1]);
  return `${sorted ? 'yes' : 'NO'} (${ms.length} dates)`;
}

function report(platform: SupportedPlatform, posts: JobRun, profile: JobRun): void {
  const line = (run: JobRun) =>
    `${run.label}: ${run.status}${run.errorMessage ? ` "${run.errorMessage}"` : ''}${
      run.triggerError ? ` TRIGGER ${run.triggerError}` : ''
    } | ${run.items.length} records | ${run.seconds}s | ${run.snapshotId ?? '-'}`;
  console.log(`  ${line(posts)}`);
  console.log(`  ${line(profile)}`);

  const errors = [...posts.items, ...profile.items].filter(isErrorRow);
  if (errors.length > 0) {
    console.log('  error rows:', JSON.stringify(sanitize(errors.slice(0, 3))));
  }

  const rows = posts.items.filter((i) => !isErrorRow(i)) as any[];
  const prof = (profile.items.filter((i) => !isErrorRow(i)) as any[])[0];
  if (platform === 'instagram') {
    const grid = new Map<string, any>();
    for (const p of prof?.posts ?? []) {
      const code = shortcodeOf(p?.url);
      if (code) grid.set(code, p);
    }
    const joined = rows.filter((r) => grid.has(r.shortcode ?? shortcodeOf(r.url)));
    console.log(`  IG reels: ${rows.length}`);
    console.log(`    date_posted present: ${pct(rows.filter((r) => has(r.date_posted)).length, rows.length)}`);
    console.log(
      `    date after grid fallback: ${pct(
        rows.filter((r) => has(r.date_posted) || has(grid.get(r.shortcode ?? shortcodeOf(r.url))?.datetime)).length,
        rows.length,
      )}`,
    );
    console.log(`    video_play_count null: ${pct(rows.filter((r) => !has(r.video_play_count)).length, rows.length)}`);
    console.log(`    views null: ${pct(rows.filter((r) => !has(r.views)).length, rows.length)}`);
    console.log(`    likes null: ${pct(rows.filter((r) => !has(r.likes)).length, rows.length)}`);
    console.log(`    shortcode present: ${pct(rows.filter((r) => has(r.shortcode)).length, rows.length)}`);
    console.log(`    user_posted present: ${pct(rows.filter((r) => has(r.user_posted)).length, rows.length)}`);
    console.log(`    newest-first by date_posted: ${newestFirst(rows.map((r) => r.date_posted))}`);
    console.log(
      `    reels in profile grid: ${joined.length}; pinned among them: ${
        joined.filter((r) => grid.get(r.shortcode ?? shortcodeOf(r.url))?.is_pinned === true).length
      }; pinned in grid overall: ${[...grid.values()].filter((p) => p?.is_pinned === true).length}`,
    );
    console.log(
      `    profile: account=${prof?.account ?? '-'} followers=${prof?.followers ?? '-'} is_private=${
        prof?.is_private ?? '-'
      } grid=${grid.size}`,
    );
  } else {
    console.log(`  TikTok posts: ${rows.length}`);
    console.log(`    digg_count present: ${pct(rows.filter((r) => has(r.digg_count)).length, rows.length)}`);
    console.log(`    share_count types: ${[...new Set(rows.map((r) => typeof r.share_count))].join(',') || 'n/a'}`);
    console.log(`    post_id types: ${[...new Set(rows.map((r) => typeof r.post_id))].join(',') || 'n/a'}`);
    console.log(
      `    profile_username present: ${pct(rows.filter((r) => has(r.profile_username)).length, rows.length)}`,
    );
    console.log(`    create_time present: ${pct(rows.filter((r) => has(r.create_time)).length, rows.length)}`);
    console.log(`    play_count null: ${pct(rows.filter((r) => !has(r.play_count)).length, rows.length)}`);
    console.log(`    collect_count present: ${pct(rows.filter((r) => has(r.collect_count)).length, rows.length)}`);
    console.log(`    newest-first by create_time: ${newestFirst(rows.map((r) => r.create_time))}`);
    const flags = ['is_pinned', 'is_ad', 'is_sponsored', 'pinned'].filter((k) => rows.some((r) => k in r));
    console.log(`    pinned/ad flags present: ${flags.join(',') || 'none'}`);
    console.log(
      `    profile: account_id=${prof?.account_id ?? '-'} followers=${prof?.followers ?? '-'} is_private=${
        prof?.is_private ?? '-'
      }`,
    );
  }
  if (rows[0]) console.log(`    posts item keys: ${Object.keys(rows[0]).sort().join(',')}`);
  if (prof) console.log(`    profile item keys: ${Object.keys(prof).sort().join(',')}`);
}

function save(platform: SupportedPlatform, caseName: string, purpose: string, run: JobRun): void {
  // A job Bright Data refused to start has nothing to certify.
  if (run.triggerError) return;
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = path.join(FIXTURE_DIR, `${platform}-${caseName}-${purpose}.json`);
  const payload = {
    certifiedAt: new Date().toISOString(),
    snapshotId: run.snapshotId,
    status: run.status,
    errorMessage: run.errorMessage,
    triggerError: run.triggerError,
    seconds: run.seconds,
    items: sanitize(run.items),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const posts = Number(option('posts') ?? 20);
  const timeout = Number(option('timeout') ?? 600);
  const compare = args.includes('--compare-ig-modes');
  const targets = args.filter((a) => !a.startsWith('--'));

  const token = (process.env.BRIGHTDATA_API_TOKEN ?? '').trim();
  if (!token) throw new Error('BRIGHTDATA_API_TOKEN is not set.');
  if (targets.length === 0) throw new Error('Pass at least one profile URL. See the header for usage.');

  const http = axios.create({
    baseURL: BRIGHTDATA_API_BASE_URL,
    timeout: 60_000,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  let compared = false;
  // One profile at a time. Parallel runs would be faster but make a burst of
  // 429s (and an IP blacklist) more likely.
  for (const target of targets) {
    const [rawUrl, caseName = 'case'] = target.split(/=(?=[^=]*$)/);
    const normalized = normalizeProfileUrl(rawUrl);
    if (!normalized.ok) {
      console.error(`skip ${rawUrl}: ${normalized.message}`);
      continue;
    }
    const { platform, canonicalUrl } = normalized.profile;
    const scrapers = SCRAPERS[platform];
    console.log(`\n== ${platform} ${canonicalUrl} (${caseName})`);

    // eslint-disable-next-line no-await-in-loop
    const [postsRun, profileRun] = await Promise.all([
      runJob(http, 'posts', scrapers.posts, [{ url: canonicalUrl, num_of_posts: posts }], timeout),
      runJob(http, 'profile', scrapers.profile, [{ url: canonicalUrl }], timeout),
    ]);
    report(platform, postsRun, profileRun);
    save(platform, caseName, 'posts', postsRun);
    save(platform, caseName, 'profile', profileRun);

    if (compare && platform === 'instagram' && !compared) {
      compared = true;
      // eslint-disable-next-line no-await-in-loop
      const alt = await runJob(
        http,
        'posts(discover_by=url)',
        { ...scrapers.posts, discoverBy: 'url' },
        [{ url: canonicalUrl, num_of_posts: posts }],
        timeout,
      );
      report(platform, alt, profileRun);
      save(platform, caseName, 'posts-discover-url', alt);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
