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

# Cost cap per run. Optional. Leave blank for no cap.
APIFY_MAX_COST_USD_PER_RUN=

# How many paid runs may be in flight at once.
#
# This is NOT a spending limit. It is the Apify account memory cap. An
# Instagram run reserves 1024MB and a TikTok run 4096MB, so 4 concurrent
# TikTok runs need 16GB of Apify memory. Past the plan limit, runs queue at
# Apify or fail, and the failures look like provider errors.
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

There is no per-admin limit and no batch limit. Caching is off, so every
fetch is a fresh paid run. That is a deliberate choice: fresh numbers are
worth more than the saving.

The one ceiling that stays is `ENGAGEMENT_WORKER_CONCURRENCY`, and it exists
for the Apify memory cap, not for cost.

If you ever want a limit back, set the variable. The code honours it.

## The formula

From v2 onwards both platforms share one shape:

```
ER = 100 × (Σ(likes + comments + saves + shares) / 10) / median(views)
```

- Ten most recent valid posts. Pinned, ad, sponsored and repost items never count.
- Views are the denominator, so the Instagram sample is Reels and video only.
  A photo carries no view count and is dropped as a missing counter.
  Views come from `videoPlayCount`, which is the number Instagram prints
  under the Reel. The actor also returns `videoViewCount`, an older metric
  worth about a third of it; reading that one understated every rate.
- Saves are optional. The Instagram actor reports none. The TikTok actor may
  report `collectCount`; an absent save count adds nothing and is never guessed.
- Formula IDs: `instagram_recent_10_median_view_v2`,
  `tiktok_recent_10_median_view_v2`.

### Instagram takes two runs

`apify/instagram-scraper` caps `details` mode at twelve posts whatever
`resultsLimit` says, and roughly half a typical feed is carousels, which carry
no view count. So one Instagram extraction starts two runs:

| Run | Input | Supplies | Measured cost |
|---|---|---|---|
| posts | `resultsType: 'reels'`, `resultsLimit: APIFY_MAX_DATASET_ITEMS` | the post metrics | ~$0.10 |
| profile | `resultsType: 'details'`, `resultsLimit: 1` | the follower count and the private flag | ~$0.003 |

The profile run is best effort. Its run ID and charge are stored
(`profileActorRunId`, `profileCostUsd`) before polling, so a paid run is never
untracked, but a failure only costs the follower count — v2 does not divide by
followers, so the rate still computes.

**The feed run asks for reels, not posts.** The rate divides by views, and only
a video carries one, so every carousel a `posts` run returns is a wasted slot.
Measured 2026-09-07 on `claude0417`: `posts` returned 39 items of which only 3
passed the policy, which failed the ten-post rule; `reels` returned 40 usable
videos, 10 of which passed. `reels` also returns a Reel on `cultcreativeasia`
that `posts` mode silently skipped from the middle of its own date range.

A date window (`onlyPostsNewerThan`) was measured and rejected. It works, but
neither test profile publishes ten reels in three months, so it turned two
working accounts into `INSUFFICIENT_DATA`. Sample size is a count, not a window.

**Pinned posts are excluded on Instagram.** `reels` mode reports `isPinned` on
every item, which `posts` mode never did. `isRepost` and `isPublic` are still
unreported, so both stay in `unverifiedFlags` on every Instagram run.

A row stores the ID that produced its number. Rows written by a v1 build keep
`..._v1` and their old rate, and the UI keeps explaining them with the old
formula. Nothing is recomputed in place.

## What is stored per fetch

Two typed records, both free of provider payload:

- `selectedPosts` — the ten posts the formula used, with likes, comments,
  saves, shares, views, and the publish time. `ratePercent` is null from v2
  onwards: the rate is one mean over one median, so no rate belongs to a
  single post.
- `candidatePosts` — **every** post the actor returned, up to
  `APIFY_MAX_DATASET_ITEMS`, each with the same counters plus `accepted`,
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
6. Read the canary numbers below. Set `APIFY_MAX_COST_USD_PER_RUN` from the
   measured charge and test the cost-limit path.
7. Stage 2. Add approved CSM and CSL user IDs to the same list.

## Canary numbers

`collectExtractionMetrics(prisma, { since })` returns every number below from a
stored value. Nothing is estimated.

| Number | Field | Watch for |
|---|---|---|
| Duration | `durationMs.p50`, `.p95`, `.max` | p95 climbing means the provider is slow |
| Success rate | `successRate` | a drop means the actor or the policy changed |
| Insufficient data | `insufficientDataRate` | high means the ten-post rule is too strict for your creators. Instagram photo accounts always land here |
| Schema failure | `schemaFailureRate`, `failuresByCode` | **any** value here means the actor output moved. Stop and re-certify |
| Cache hits | `cacheHits`, `cacheHitRate` | higher is cheaper |
| Duplicate starts | `duplicateStartAttempts` | rising means the browser asks twice |
| Reconciliation | `reconciliationFailures`, `reconcileAttemptsTotal` | any failure needs a look; an ambiguous start never retries itself |
| Cost | `cost.totalUsd`, `.meanUsdPerRun`, `.maxUsdPerRun`, `.byPlatform` | check against the actor pricing page and Apify pricing |

`checkCostAgainstBudget(metrics, budget)` fails while the cap is unset, while
a run went over it, or while no real charge has been recorded yet.

Worker alerts come from `getExtractionHealth`: stuck work, pending
reconciliation, schema changes, and cost-cap hits.

## Rollback

Set `GUEST_PROFILE_METRICS_ENABLED=false`.

That is the whole rollback. It:

- stops every new extraction start, at the gate, before any spend;
- returns admins to the existing manual form;
- **keeps** every extraction, pitch, audit, and idempotency record.

Cleanup cannot undo it either. `cleanupExpiredExtractions` only removes
terminal rows past their retention date. It never touches running work, work
awaiting reconciliation, or a `GuestCreatorMetricAudit`, because the audit's
extraction link is `ON DELETE SET NULL` and its actor build, run ID, formula
version, and both value sets are copied onto the audit row.

## Still open before production

1. Actor certification. Every fixture in
   `test/guestProfileExtraction/fixtures/` is synthetic. Prove it with:
   ```bash
   EXPECT_CERTIFIED_FIXTURES=1 yarn test
   ```
   It fails today, on purpose.
2. Measured cost, recorded in `fixtures/certification.md`.
3. Canary thresholds for success, latency, cost, and reconciliation alerts.
4. Retention periods. Audit retention must exceed extraction retention.
5. Whether clients may see `manual_override` labels. Default: internal only.
