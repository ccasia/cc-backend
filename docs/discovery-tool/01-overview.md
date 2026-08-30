# Creator Discovery Tool — Overview

## What It Does

The Creator Discovery Tool lets internal users (superadmins) search, filter, compare, and invite content creators for brand campaigns. It works across two social platforms — **Instagram** and **TikTok** — and supports two categories of creators:

| Category | Description |
|---|---|
| **Platform Creators** | Creators who connected their Instagram or TikTok account through the app. Full social data (followers, engagement, top videos) is available. |
| **Non-Platform Creators** | Guest/manually-added creators who provided a profile link and follower count but did not connect their social accounts. |

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                             │
│                                                                      │
│  DiscoveryToolView ──→ SWR Hook ──→ GET /api/discovery/creators      │
│  DiscoveryToolNpcView ──→ SWR Hook ──→ GET /api/discovery/npc        │
│  InviteCreatorsDialog ──→ axios ──→ POST /api/discovery/invite       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼───────────────────────────────────────────────┐
│                         BACKEND (Express)                            │
│                                                                      │
│  Route ──→ Controller ──→ Service ──→ Prisma (PostgreSQL)            │
│                              │                                       │
│                              ├──→ Helper: queryBuilders              │
│                              ├──→ Helper: queryHelpers               │
│                              ├──→ Helper: sortHelpers                │
│                              ├──→ Helper: hydration (Instagram API,  │
│                              │                       TikTok API)     │
│                              ├──→ Helper: platformContentResolver    │
│                              ├──→ Helper: mediaHelpers               │
│                              └──→ Helper: topVideosCache             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

All routes are mounted on `/api/discovery` and require authentication (`isLoggedIn` middleware).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/discovery/creators` | Search and filter platform-connected creators |
| `GET` | `/api/discovery/non-platform-creators` | Search and filter guest/manually-added creators |
| `POST` | `/api/discovery/invite-creators` | Invite one or more creators to a campaign |

---

## File Map

```
cc-backend/src/
├── routes/discoveryRoute.ts              # Route definitions
├── controller/discoveryController.ts     # HTTP request parsing
├── service/discoveryService.ts           # Business logic & orchestration
└── helper/discovery/
    ├── queryBuilders.ts                  # Prisma WHERE & SELECT builders
    ├── queryHelpers.ts                   # Normalization & content matching
    ├── sortHelpers.ts                    # Sorting logic (DB + in-memory)
    ├── hydration.ts                      # Refresh stale Instagram/TikTok data
    ├── platformContentResolver.ts        # Live API content fetching & matching
    ├── mediaHelpers.ts                   # Video data transformation
    └── topVideosCache.ts                 # In-memory cache with TTL & dedup
```

---

## Data Flow for a Typical Search Request

1. **User applies filters** in the frontend and clicks "Show Results"
2. Frontend SWR hook sends `GET /api/discovery/creators?platform=instagram&gender=Female&page=1&limit=20`
3. **Controller** parses and validates every query parameter
4. **Service** orchestrates the query:
   - Builds Prisma WHERE clause from all filter conditions
   - Runs parallel DB queries: total count + paginated rows + available locations
   - Optionally **hydrates** stale creator data from platform APIs (Instagram/TikTok)
   - Fetches **live top videos** from platform APIs for the current page of results
   - Enriches each creator row with the latest top videos
   - Returns paginated results + filter metadata + available locations
5. Frontend renders creator cards with stats and video thumbnails

---

## Key Concepts

### Platform vs. Non-Platform Creators
- **Platform creators** have `isFacebookConnected: true` (Instagram) or `isTiktokConnected: true` (TikTok) and linked `instagramUser` / `tiktokUser` records in the database.
- **Non-platform creators** are `guest` users or creators with `isGuest: true`. They have a `profileLink` and optional `manualFollowerCount` but no connected social data.

### Hydration
When `hydrateMissing=true`, the backend calls Instagram/TikTok APIs to refresh creator data that is missing or stale (up to 20 creators per request). This keeps engagement stats, profile pictures, and top videos current.

### Content Search (Keyword & Hashtag)
Keywords and hashtags enable searching through creator content. The system first filters at the database level (captions/titles containing the term), then verifies with live API data when available. The matching logic supports phrase matching, individual word matching, and boundary-aware hashtag matching.

### Invitations
The invite flow creates campaign participation records (pitches, agreements, submissions) in a single database transaction, then sends real-time notifications via Socket.io.

---

**Next:** [02 — Backend API Reference](./02-api-reference.md)
