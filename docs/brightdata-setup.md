# Bright Data setup (guest profile extraction)

Replaces the Apify setup (2026-09). Runbook: `docs/engagement-rate-rollout.md`.

## 1. Token

1. Bright Data Control Panel → **Account settings** → **API keys** → create a key.
2. Put it in `cc-backend/.env` (backend only, never the frontend):
   ```dotenv
   BRIGHTDATA_API_TOKEN=<key>
   BRIGHTDATA_POLL_TIMEOUT_SECONDS=420
   BRIGHTDATA_MAX_POSTS_PER_PROFILE=20
   ```
3. Remove every `APIFY_*` line from `.env` and from deploy secrets.
4. Docker bakes `env_file` at container **creation**. Recreate, do not restart:
   ```bash
   docker compose up -d --force-recreate <api> <engagement-worker>
   ```

## 2. Datasets (code constants in `src/config/guestProfileExtractionConfig.ts`)

| Platform | Job | dataset_id | Query extras | Input |
|---|---|---|---|---|
| Instagram | posts (Reels) | `gd_lyclm20il4r5helnj` | `type=discover_new&discover_by=url_all_reels` | `[{ url, num_of_posts }]` |
| Instagram | profile | `gd_l1vikfch901nx3by4` | — | `[{ url }]` |
| TikTok | posts (Fast API) | `gd_m7n5v2gq296pex2f5m` | — | `[{ url, num_of_posts }]` |
| TikTok | profile | `gd_l1villgoiiidt09ci` | — | `[{ url }]` |

Every trigger adds `format=json&include_errors=true`. Never send
`start_date` / `end_date` to the Reels discovery: Bright Data answers
`bad_input` since August 2026.

**Contract version.** Bright Data has no version pinning. Each platform has a
`contractVersion` (`brightdata-ig-2026-09`, `brightdata-tt-2026-09`) stored in
`actorBuild`. It keys the cache and the work fingerprint. Bump it whenever an
adapter's field contract changes.

## 3. Field contract

**Instagram Reel → post:** `shortcode` (or from `url`) · `user_posted` ·
`date_posted` ?? grid `datetime` ?? null · `likes` · `num_comments` ·
`video_play_count ?? views` · `thumbnail` · `product_type` ·
ad + sponsored = true only when `partnership_details` is filled, else unverified.
`is_paid_partnership` is **not** used: it is true exactly when
`coauthor_producers` is non-empty (a collab). Grid `is_pinned` is read but the
live grid does not carry it, so pinned is always unverified.
**Instagram profile:** `account`, `full_name`, `followers`, `is_private`,
`posts[]` (`url` as `/p/<shortcode>`, `datetime`, `is_pinned`).

**TikTok post:** `post_id` · `profile_username` (or handle from `url`) ·
`create_time` · `digg_count` · `comment_count` · `share_count` (string or
number) · `collect_count` · `play_count` · `preview_image`. No pinned / ad /
sponsored flags in the Fast API or the standard Posts dataset
(`gd_lu702nij2f790tmv9h`; `commerce_info` is null even on ads). Profile
`pinned_posts` was empty for `@jisoo`.
**TikTok profile:** `account_id`, `nickname`, `followers`, `is_private`.

Error rows (`error`, `error_code`): private → `PRIVATE_PROFILE`; dead page /
not found → `PROFILE_NOT_FOUND`; else `PROVIDER_FAILURE`. A posts job that
fails with "No data found in discovery" or "Snapshot is empty" is decided from
the profile job. Items present but none parse → `PROVIDER_SCHEMA_CHANGED`.

## 4. Rules

- **429** = `RATE_LIMITED`, definite, never auto-retried. 25+ 429s in 5 min
  blacklist the server IP until Bright Data support clears it.
- Never rerun a job automatically. A rerun is a new paid job.
- A job past `BRIGHTDATA_POLL_TIMEOUT_SECONDS` is canceled (stops billing).
- Cost: no per-job cost from the API. `costUsd` stays null. Use the dashboard.
- Media URLs expire 24 h after collection. We store none.

## 5. Certification (spends credits)

```bash
cd cc-backend
BRIGHTDATA_API_TOKEN=<key> yarn certify-brightdata \
  https://www.instagram.com/<normal>=normal \
  https://www.instagram.com/claude0417=photo-heavy \
  https://www.instagram.com/<has-pinned-reel>=pinned \
  https://www.instagram.com/<private>=private \
  https://www.instagram.com/<does-not-exist>=missing \
  https://www.tiktok.com/@jisoo=normal \
  https://www.tiktok.com/@<private>=private \
  https://www.tiktok.com/@<does-not-exist>=missing \
  --posts=20 --compare-ig-modes
```

Output: sanitized fixtures in
`test/guestProfileExtraction/fixtures/brightdata/<platform>-<case>-<purpose>.json`
and a coverage report on stdout. Paste the report numbers below.

| Case | Records (posts / profile) | Duration | `date_posted` % | after grid % | newest-first | plays null % | pinned seen | `digg_count` % | `share_count` type | error row / message |
|---|---|---|---|---|---|---|---|---|---|---|
| IG normal | | | | | | | | — | — | |
| IG photo-heavy | | | | | | | | — | — | |
| IG pinned | | | | | | | | — | — | |
| IG private | | | | | | | | — | — | |
| IG missing | | | | | | | | — | — | |
| IG `discover_by=url` | | | | | | | | — | — | |
| TikTok normal | | | | | — | | — | | | |
| TikTok private | | | | | — | | — | | | |
| TikTok missing | | | | | — | | — | | | |

**Stop and re-plan if:** Instagram dates are always null **and** the list is
not newest-first; `digg_count` is missing on TikTok; `video_play_count` and
`views` are both null; or a field name differs from section 3.

## 6. Parity with the previous provider (measured 2026-09-30)

Same moment, same profiles, same policy and formula. Bright Data through the
real adapters; Apify (`apify/instagram-scraper@0.0.776`,
`clockworks/tiktok-profile-scraper@0.0.473`) mapped as the old adapters did.

| Profile | ER Bright Data | ER Apify | Same 10 posts | Counters |
|---|---|---|---|---|
| `instagram:sooyaaa__` | 7.54% | 7.54% | 10/10 | likes/comments/views ≤0.84% |
| `instagram:esportspubgmobile` | 0.57% | 0.57% | 10/10 | likes/views ≤0.11%; **comments median −20%** |
| `tiktok:jisoo` | 28.91% | 32.97% | 8/10 | all ≤0.91% (both providers round TikTok counts) |

- Every counter, date and follower count matches within 1%, except Instagram
  comments on some accounts (Bright Data lower; one comment field only). The
  rate still matched to 2 decimals because comments are small next to likes.
- Bright Data numbers + Apify flags reproduce Apify's rate exactly on all three.
  The rate differs **only** where a flag differs.
- TikTok: Apify flags ads (`isAd`); Bright Data has no ad signal, so ads stay in
  the sample and are recorded unverified. On `@jisoo` 3 ads moved the rate by
  4 points.
- **Collabs (product decision 2026-09-30):** an Instagram Reel with any
  co-author (`coauthor_producers` non-empty) is excluded as `COLLAB`, even when
  the creator posted it. Apify kept those, so this is an intended difference:
  `@sooyaaa__` drops 2 collabs (with `pokemon` and `zayn`) and moves from
  7.54% to 7.58%. TikTok has no co-author field; `isCollab` stays unverified.
- Instagram pinned: Apify reports it; Bright Data does not. The newest-first
  sort kept the pinned Reel out of the sample in this test.
