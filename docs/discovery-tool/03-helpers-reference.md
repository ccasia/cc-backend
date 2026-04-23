# Creator Discovery Tool — Backend Helpers Reference

All helpers live under `cc-backend/src/helper/discovery/`. Each file has a focused responsibility.

---

## 1. `queryHelpers.ts` — Normalization & Content Matching

Low-level utility functions used across the discovery system.

### Types

```typescript
type PlatformFilter = 'all' | 'instagram' | 'tiktok';
```

### Functions

#### `normalizePagination(page?, limit?)`
Ensures page and limit are valid positive integers. Caps limit at 100.

| Parameter | Default | Output |
|---|---|---|
| `page` | `1` | Clamped to ≥ 1 |
| `limit` | `20` | Clamped to 1–100 |

Returns `{ page, limit, skip }` where `skip = (page - 1) * limit`.

---

#### `normalizePlatform(platform?)`
Validates the platform string. Returns `'instagram'`, `'tiktok'`, or `'all'` (default).

---

#### `genderToPronounce(gender?)`
The database stores gender as pronouns (e.g. `'He/Him'`). This maps the user-facing label to the stored value.

| Input | Output |
|---|---|
| `'Male'` | `'He/Him'` |
| `'Female'` | `'She/Her'` |
| `'Non-Binary'` | `'They/Them'` |
| anything else | `null` |

---

#### `ageRangeToBirthDateRange(ageRange?)`
Converts an age range string like `'18-24'` to a `{ gte, lte }` date range for filtering by `birthDate`.

**Logic:** A person aged 18 was born between `(today - 19 years + 1 day)` and `(today - 18 years)`. This computes the correct boundary dates so the Prisma `gte`/`lte` filter on `birthDate` matches birthdays within the range.

Returns `null` if the input is invalid.

---

#### `extractHashtags(raw?)`
Parses a comma/space-separated hashtag string into an array of normalized `#tag` strings.

```
Input:  '#fashion, ootd, #style'
Output: ['#fashion', '#ootd', '#style']
```

Leading `#` symbols are stripped and re-added uniformly. Duplicates are removed.

---

#### `normalizeKeywordTerm(value?)`
Cleans a keyword for matching: lowercase, trim, remove surrounding quotes, collapse whitespace.

---

#### `matchesContentTerms(texts, options)`
The core content matching function. Determines whether a set of text strings (typically video captions/titles) match the user's keyword and/or hashtag search.

**Parameters:**
- `texts` — Array of content strings (captions, titles)
- `options.keywordTerm` — The keyword to search for
- `options.hashtagTerms` — Array of hashtag strings to search for
- `options.keywordOnlyTexts` — Additional text to search for keywords only (e.g. creator name, handles). Hashtags are not searched in these.

**Matching rules:**
1. **Keyword matching** — Passes if ANY of these is true:
   - The full keyword phrase appears as a boundary match in any text
   - ALL individual words from the keyword appear (each as a boundary match) across the texts
2. **Hashtag matching** — Passes if ALL hashtags appear in at least one text
3. Final result = keyword match **AND** hashtag match

**Boundary matching** means the term appears as a whole word — not inside another word. For example, `cat` matches `"my cat is cute"` but not `"catalog"`.

---

## 2. `queryBuilders.ts` — Prisma WHERE & SELECT Construction

Translates user-facing filter parameters into Prisma query objects.

### `buildConnectedWhere(search, platform, filters?, options?)`

Builds the full Prisma `where` clause for the main creators query.

**Base conditions (always applied):**
- `role: 'creator'`
- `creator` relation exists

**Platform condition:**
- `'instagram'` → Creator has `isFacebookConnected: true` AND `instagramUser` exists
- `'tiktok'` → Creator has `isTiktokConnected: true` AND `tiktokUser` exists
- `'all'` → Either of the above (OR)

**Search condition** (when `search` is provided):
Matches against name, Instagram handle, TikTok handle, or mediaKit `about` (all case-insensitive `contains`).

**Filter conditions** (combined with AND):

| Filter | DB Path | Matching |
|---|---|---|
| `gender` | `creator.pronounce` | Exact match via `genderToPronounce()` |
| `ageRange` | `creator.birthDate` | Date range via `ageRangeToBirthDateRange()` |
| `country` | `user.country` | Case-insensitive exact match |
| `city` | `user.city` | Case-insensitive exact match |
| `creditTier` | `creator.creditTier.name` | Case-insensitive exact match via relation |
| `languages` | `creator.languages` (JSON array) | `array_contains` — any matching language |
| `interests` | `creator.interests` (relation) | `some` interest name matches (case-insensitive) |
| `keyword` | name, handles, video captions/titles | Case-insensitive `contains` (OR across fields) |
| `hashtag` | Instagram captions, TikTok titles | Each hashtag tag must appear in at least one video |

**`options.includeContentFilters`** (default: `true`) — When `false`, keyword and hashtag conditions are excluded. Used for the base location query.

---

### `buildConnectedSelect(includeAccessToken?)`

Returns the Prisma `select` shape for the creator query. This determines which fields are fetched from the database.

**Always selected:**
- **User:** `id`, `name`, `city`, `country`
- **Creator:** `id`, `pronounce`, `birthDate`, `instagram`, `tiktok`, `industries`, `interests` (with name and rank), `creditTier`, connection flags, `mediaKit.about`
- **InstagramUser:** followers, engagement rate, profile picture, biography, totals (likes/saves/shares), averages, insight data, top 5 videos (by recency)
- **TikTokUser:** username, display name, avatar, biography, follower count, engagement rate, totals, averages, top 5 videos (by recency)

**When `includeAccessToken` is true:**
- `instagramUser.accessToken` — Needed for API calls
- `creator.tiktokData` — Contains encrypted TikTok tokens

---

## 3. `sortHelpers.ts` — Sorting Logic

### Types

```typescript
type DiscoverySortBy = 'name' | 'followers';
type DiscoverySortDirection = 'asc' | 'desc';
```

### `normalizeDiscoverySort(sortBy?, sortDirection?)`

Applies sensible defaults:
- `followers` → defaults to `desc` (highest first)
- `name` → defaults to `asc` (alphabetical A–Z)

---

### `buildDiscoveryUserOrderBy(platform, sortBy, sortDirection)`

Returns the Prisma `orderBy` array for the main DB query.

**For `followers`:**
- `instagram` → Order by `instagramUser.followers_count`
- `tiktok` → Order by `tiktokUser.follower_count`
- `all` → Order by Instagram followers first, then TikTok, then name

**For `name`:**
- Order by `name` in the requested direction, secondary by `updatedAt desc`

---

### `sortDiscoveryRows(rows, sortBy, sortDirection)`

In-memory sort used after the database fetch — necessary for the `'all'` platform mode where a single creator may produce two rows (one per platform) and follower-based sorting needs to consider the platform-specific follower count.

**Follower sort logic for `'all'`:** Uses `Math.max(instagramFollowers, tiktokFollowers)` as the sort value.

**Tie-breaker:** Always falls back to alphabetical name comparison.

---

## 4. `hydration.ts` — Platform Data Refresh

Refreshes stale or missing social media data by calling Instagram and TikTok APIs directly.

### `hydrateMissingInstagramData(rows, deps)`

**When triggered:** `hydrateMissing=true` is set in the request.

**Candidates:** Creators where any of these are missing:
- `insightData`
- `profile_picture_url`
- `totalShares`
- `instagramVideo` (empty array)

**Limit:** Processes up to 20 candidates per request.

**What it does for each candidate:**
1. Decrypt the stored Instagram access token
2. Fetch `overview` (profile data), `insights` (engagement data), and `media` (recent posts)
3. Update `instagramUser` record with fresh stats (followers, engagement rate, averages)
4. Delete old cached videos and upsert the latest top videos into `instagramVideo`
5. Return the top videos in a Map keyed by `creatorId`

**Error handling:** Errors are swallowed per-creator so one failure doesn't block the entire discovery response.

---

### `hydrateMissingTikTokData(rows, deps)`

Same pattern as Instagram hydration but for TikTok.

**All candidates are considered** (no specific missing-data check beyond connection status).

**Additional step:** Refreshes expired TikTok access tokens via `ensureValidTikTokAccessTokenForCreator()` before making API calls.

**What it updates:**
- `tiktokUser` record (upsert — creates if missing)
- `tiktokVideo` records for top videos
- `creator.tiktok` handle (updates to latest username from API)

---

## 5. `platformContentResolver.ts` — Live Content Fetching & Matching

Fetches live top videos from Instagram/TikTok APIs for the current page of results. Used both for content search matching and for ensuring fresh video thumbnails.

### Types

```typescript
type TopVideosByCreator = Map<string, any[]>;

type PlatformApiStats = {
  success: number;
  failed: number;
  rateLimitedSkips: number;
  dbFallback: number;
  cacheHits: number;
};

type DiscoveryApiSummary = {
  context: 'content-search' | 'default';
  processedCreators: number;
  instagram: PlatformApiStats;
  tiktok: PlatformApiStats;
};
```

### `resolvePlatformContentMatchesFromApi(rows, options, deps, config?)`

Processes all rows in the current page concurrently using `Promise.allSettled`.

**For each creator:**
1. Check if the platform API is rate-limited → use DB videos as fallback
2. If not rate-limited, fetch live videos via the cache layer
3. Map and store top videos per creator
4. If doing a content search, run `matchesContentTerms()` against live captions
5. Track success/failure/fallback stats per platform

**Rate limit handling:** When a `429` or `rate_limit_exceeded` error is detected, a shared `rateLimitState` flag is set. All subsequent creators skip that platform's API for the remainder of the request.

**Fallback chain:**
1. Try cache → return if fresh
2. Try in-flight dedup → return if another request is already fetching
3. Fetch from API → cache and return
4. On error → fall back to database-stored videos

---

## 6. `mediaHelpers.ts` — Video Data Transformation

Transforms raw API responses into the standardized top video format.

### `mapInstagramApiTopVideos(videos)`
Sorts by `like_count` (desc) then `timestamp` (desc), takes top 3, maps to:
```typescript
{ id, media_url, media_type, thumbnail_url, caption, permalink, like_count, comments_count, datePosted }
```

### `mapTikTokApiTopVideos(videos)`
Sorts by `like_count` (desc) then `create_time` (desc), takes top 3, maps to:
```typescript
{ video_id, cover_image_url, title, embed_link, like_count, comment_count, share_count, createdAt }
```

### `getLatestInstagramCaptionsForMatch(videos, limit=5)`
Returns the captions of the 5 most recent Instagram videos (for content matching).

### `getLatestTikTokTitlesForMatch(videos, limit=5)`
Returns the titles of the 5 most recent TikTok videos (for content matching).

---

## 7. `topVideosCache.ts` — In-Memory Cache with Deduplication

Prevents redundant API calls across concurrent discovery requests.

### Configuration (via environment variables)

| Variable | Default | Description |
|---|---|---|
| `DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_TTL_MS` | `180000` (3 min) | How long cached videos stay fresh |
| `DISCOVERY_CREATOR_TOP_VIDEOS_CACHE_MAX_ENTRIES` | `6000` | Max cache size before pruning |

### `getCreatorTopVideosFromCacheOrFetch(platform, creatorId, fetcher)`

The main cache function. Returns `{ videos, source }` where source is:

| Source | Meaning |
|---|---|
| `'cache'` | Returned from cache (no API call made) |
| `'inflight'` | Another request was already fetching this creator; waited for it |
| `'live'` | Fresh API call was made |

**In-flight deduplication:** If two requests try to fetch the same creator's videos simultaneously, the second request awaits the first request's promise instead of making a duplicate API call.

**Cache pruning:** When the cache exceeds `MAX_ENTRIES`:
1. First pass: delete expired entries
2. Second pass (if still too large): delete oldest entries by expiry time

---

**Next:** [04 — Frontend Documentation](./04-frontend.md)
