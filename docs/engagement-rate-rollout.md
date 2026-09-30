# Guest profile metrics: rollout and rollback

Automatic engagement rate for non-platform creators. Plan:
`engagement-rate-new/`. This file is the operational runbook.

## The switch

One server-side decision controls **both** the automatic flow and the current
manual form. The browser asks for the answer and never decides.

```
GET /api/campaign/v3/guest-profile-metrics/decision  ->  { enabled, reason }
```

Enabled shows the new dialog. Disabled, still loading, or a failed call shows
the existing `NonPlatformCreatorFormDialog`, unchanged.

## Environment

```dotenv
# Master switch. Off in production until every release gate passes.
GUEST_PROFILE_METRICS_ENABLED=false

# Stage 1: named admins only. Comma separated user IDs.
GUEST_PROFILE_METRICS_ADMIN_IDS=

# Stage 2 alternative: every internal superadmin, no list to maintain.
GUEST_PROFILE_METRICS_SUPERADMINS_ONLY=false

# Required. Bright Data API key (Control Panel > Account settings > API keys). Backend only.
BRIGHTDATA_API_TOKEN=
# How long the worker polls one job before it cancels it. Discovery jobs take 1-7 min.
BRIGHTDATA_POLL_TIMEOUT_SECONDS=420
# num_of_posts per profile on the posts job. Set from certification.
BRIGHTDATA_MAX_POSTS_PER_PROFILE=20

# How many extractions run at once.
#
# This is NOT a spending limit. Bright Data allows 5,000 concurrent jobs, so
# there is no provider memory cap. Each extraction holds a worker slot for up
# to BRIGHTDATA_POLL_TIMEOUT_SECONDS; raise this if `stuck` climbs in health.
ENGAGEMENT_WORKER_CONCURRENCY=4

# Retention.
ENGAGEMENT_RETENTION_DAYS=30
ENGAGEMENT_RECEIPT_TTL_MINUTES=30

# Optional. Leave all three unset for the open defaults.
#   ENGAGEMENT_MAX_ACTIVE_PER_ADMIN     unset = no limit
#   ENGAGEMENT_MAX_PROFILES_PER_BATCH   unset = no limit
#   ENGAGEMENT_CACHE_TTL_MINUTES        unset or 0 = always fetch fresh
```

## Spending

There is no per-admin limit, no batch limit, and no per-job cost cap. Caching
is off, so every fetch is two fresh paid jobs (posts + profile, about
`BRIGHTDATA_MAX_POSTS_PER_PROFILE + 1` records). That is a deliberate choice:
fresh numbers are worth more than the saving.

Bright Data reports no per-job cost, so `costUsd` and `profileCostUsd` stay
null. Check spend in the Bright Data dashboard. Price at 2026-09: $1.50 / 1K
records pay-as-you-go, 5,000 free records a month.

If you ever want a limit back, set the variable. The code honours it.

## The formula

From v2 onwards both platforms share one shape:

```
ER = 100 × (Σ(likes + comments + saves + shares) / 10) / median(views)
```

- Ten most recent valid posts. Pinned, ad, sponsored and repost items never count.
- Views are the denominator, so the Instagram sample is Reels and video only.
  A photo carries no view count and is dropped as a missing counter.
  Views come from `video_play_count`, which is the number Instagram prints
  under the Reel. Bright Data also returns `views`, an older metric worth about
  a third of it; reading that one understated every rate.
- Saves are optional. No Instagram source reports them. TikTok reports
  `collect_count`; an absent save count adds nothing and is never guessed.
- Formula IDs: `instagram_recent_10_median_view_v2`,
  `tiktok_recent_10_median_view_v2`.

### Two jobs per extraction, on both platforms

Setup, datasets and the field contract: `docs/brightdata-setup.md`.

| Job | Dataset | Supplies |
|---|---|---|
| posts (Instagram) | Reels discovery `gd_lyclm20il4r5helnj`, `discover_by=url_all_reels` | the post metrics |
| posts (TikTok) | Posts by Profile Fast API `gd_m7n5v2gq296pex2f5m` | the post metrics |
| profile (Instagram) | Profiles `gd_l1vikfch901nx3by4` | followers, private flag, 12-post grid (pinned flag, fallback dates) |
| profile (TikTok) | Profiles `gd_l1villgoiiidt09ci` | followers, private flag |

Both job IDs (`snapshot_id`, `sd_...`) are stored before polling
(`actorRunId`, `profileActorRunId`), so a paid job is never untracked. The
profile job is best effort: a failure only costs the follower count — v2 does
not divide by followers, so the rate still computes. A job still running at
`BRIGHTDATA_POLL_TIMEOUT_SECONDS` is canceled, which stops billing.

**The Instagram posts job lists Reels, not posts.** The rate divides by views,
and only a video carries one. Measured 2026-09-07 on `claude0417` with the
previous provider: a posts listing returned 39 items of which only 3 passed
the policy.

**Instagram dates: hybrid fallback.** Instagram no longer exposes a Reel's
publish date to Bright Data (August 2026). The adapter uses `date_posted`, then
the profile grid's `datetime` for the same shortcode, then no date. An undated
Reel is kept, the sample is ordered by provider list order, and the row records
`publishedAt` in `unverifiedFlags`. The breakdown shows `—` for its date.

**Pinned.** Instagram: known only for Reels inside the 12-post grid; others are
unverified. TikTok: no pinned, ad or sponsored flag at all; all three stay
unverified. The newest-first sort usually pushes an old pinned post out.

A 429 from Bright Data is a definite failure (`RATE_LIMITED`) and is never
retried automatically: 25 of them in 5 minutes blacklist the server's IP.

A row stores the ID that produced its number. Rows written by a v1 build keep
`..._v1` and their old rate, and the UI keeps explaining them with the old
formula. Nothing is recomputed in place.

## What is stored per fetch

Two typed records, both free of provider payload:

- `selectedPosts` — the ten posts the formula used, with likes, comments,
  saves, shares, views, and the publish time. `ratePercent` is null from v2
  onwards: the rate is one mean over one median, so no rate belongs to a
  single post.
- `candidatePosts` — **every** post the provider returned, up to
  `BRIGHTDATA_MAX_POSTS_PER_PROFILE`, each with the same counters plus `accepted`,
  `rejectedReason` (for example `PINNED`, `SPONSORED`, `MISSING_COUNTER`),
  and `usedInSample`.

`candidatePosts` is kept on an `INSUFFICIENT_DATA` result too. That is the
evidence for why ten valid posts were not found.

Neither holds a caption, a media URL, an avatar, a bio, hashtags, or music
data. A test asserts it.

How the flags combine:

| `ENABLED` | `ADMIN_IDS` | `SUPERADMINS_ONLY` | Who gets it |
|---|---|---|---|
| false | anything | anything | nobody |
| true | set | ignored | only those user IDs |
| true | empty | true | internal superadmins |
| true | empty | false | every admin the policy allows |

The flag decides **eligibility**, never permission.
`canManageCampaignCreators` still applies: a viewer on a campaign is refused
even when allowlisted.

## Deploy order

1. Apply migrations with the flag **off**.
   ```bash
   cd cc-backend && yarn migrate
   yarn backfill-guest-keys --dry-run   # review conflict groups
   yarn backfill-guest-keys
   ```
2. Deploy the API and the frontend. Nothing changes for admins yet.
3. Start the dedicated worker as its own process.
   ```bash
   yarn run-engagement-worker           # local
   docker compose up cc-engagement-worker
   pm2 start ecosystem.config.js --only engagement-extraction-worker
   ```
4. Confirm Redis durability. This is a release gate, not a warning.
   ```bash
   redis-cli CONFIG GET appendonly        # yes
   redis-cli CONFIG GET maxmemory-policy  # noeviction
   ```
5. Stage 1. Put one or two superadmin user IDs in
   `GUEST_PROFILE_METRICS_ADMIN_IDS`, set `GUEST_PROFILE_METRICS_ENABLED=true`,
   and run one certified Instagram profile and one certified TikTok profile.
6. Read the canary numbers below, and the spend in the Bright Data dashboard.
7. Stage 2. Add approved CSM and CSL user IDs to the same list.

## Canary numbers

`collectExtractionMetrics(prisma, { since })` returns every number below from a
stored value. Nothing is estimated.

| Number | Field | Watch for |
|---|---|---|
| Duration | `durationMs.p50`, `.p95`, `.max` | p95 climbing means the provider is slow |
| Success rate | `successRate` | a drop means the dataset output or the policy changed |
| Insufficient data | `insufficientDataRate` | high means the ten-post rule is too strict for your creators. Instagram photo accounts always land here |
| Schema failure | `schemaFailureRate`, `failuresByCode` | **any** value here means the Bright Data output moved (it has no version pinning). Stop, run `yarn certify-brightdata`, bump the contract version |
| Cache hits | `cacheHits`, `cacheHitRate` | higher is cheaper |
| Duplicate starts | `duplicateStartAttempts` | rising means the browser asks twice |
| Reconciliation | `reconciliationFailures`, `reconcileAttemptsTotal` | any failure needs a look; an ambiguous start never retries itself |
| Cost | `cost.*` | rows from the previous provider only. Bright Data spend is in its dashboard |

Worker alerts come from `getExtractionHealth`: stuck work, pending
reconciliation, and schema changes.

## Rollback

Set `GUEST_PROFILE_METRICS_ENABLED=false`.

That is the whole rollback. It:

- stops every new extraction start, at the gate, before any spend;
- returns admins to the existing manual form;
- **keeps** every extraction, pitch, audit, and idempotency record.

Cleanup cannot undo it either. `cleanupExpiredExtractions` only removes
terminal rows past their retention date. It never touches running work, work
awaiting reconciliation, or a `GuestCreatorMetricAudit`, because the audit's
extraction link is `ON DELETE SET NULL` and its dataset ID, contract version, job ID, formula
version, and both value sets are copied onto the audit row.

## Still open before production

1. Bright Data certification. Run `yarn certify-brightdata` (see
   `docs/brightdata-setup.md`), then move the adapter tests onto the saved
   fixtures in `test/guestProfileExtraction/fixtures/brightdata/`.
2. Billed record counts per job, from the Bright Data dashboard.
3. Canary thresholds for success, latency, cost, and reconciliation alerts.
4. Retention periods. Audit retention must exceed extraction retention.
5. Whether clients may see `manual_override` labels. Default: internal only.
