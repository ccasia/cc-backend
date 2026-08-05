# Gamification API Contract — v1

**Base path:** `/gamification` (mounted in `src/routes/index.ts`)
**Consumers:** cc-frontend (web) and cult-app (mobile)
**Auth:** `authenticate` + `isCreator` on all routes
**Terminology:** XP everywhere — in schema, API, and UI
**Dates:** ISO 8601 · **Period IDs:** `"YYYY-MM"` (Asia/Kuala_Lumpur month boundaries)

All shapes are derived from what the mobile screens already consume from
`cult-app/constants/mock-gamification.ts`, so the client migration is a
data-source swap, not a refactor.

Reference: GAMIFICATION SYSTEM spec (Creator Ranks, XP-per-action table,
rank thresholds 0 / 1,000 / 5,000 / 14,000 / 40,000 total XP).
Rank names use Option 1: Riser → Breakout → Trendsetter → Headliner → Cultural.

## Storage

XP lives in the ledger the treasure hunt feature introduced, extended rather
than duplicated:

- **`XpTransaction`** — append-only ledger (a DB trigger rejects UPDATE/DELETE;
  corrections use compensating rows). Idempotency is
  `@@unique([userId, sourceType, sourceId])`.
- **`UserXpBalance`** — denormalized `total` + current `rank`.
- **`XpSourceType`** — every earning action, including `HUNT_LOCATION_CLAIM`.

Everything awards through `awardXp()` in `src/service/gamificationService.ts`.
Treasure hunt claims pass their own transaction so a claim and its XP commit
together; campaign actions call it standalone, where it never throws.

---

## 1. `GET /me` — rank + XP summary

Feeds the settings progress card and rank-up UI.

```jsonc
{
  "totalXp": 3420,
  "rank":     { "id": "breakout",    "name": "Breakout",    "minXp": 1000 },
  "nextRank": { "id": "trendsetter", "name": "Trendsetter", "minXp": 5000 },  // null at Cultural
  "ranks": [                       // full ladder — client drops its hardcoded thresholds
    { "id": "riser",       "name": "Riser",       "minXp": 0 },
    { "id": "breakout",    "name": "Breakout",    "minXp": 1000 },
    { "id": "trendsetter", "name": "Trendsetter", "minXp": 5000 },
    { "id": "headliner",   "name": "Headliner",   "minXp": 14000 },
    { "id": "cultural",    "name": "Cultural",    "minXp": 40000 }
  ],
  "currentMonth": { "periodId": "2026-08", "xp": 640, "rank": 12 }  // rank null if no XP this month
}
```

Notes:

- `rank.id` values are stable slugs — the client keys orb assets and gradients
  off them. Visual fields (colors, gradients, orb images) stay client-side;
  only `minXp` + names come from the server.
- Progress math (`earnedInTier`, `ratio`) stays client-side — the server
  supplies `totalXp` + the ladder, never derived ratios.

## 1a. `GET /me/history` — XP ledger

Backs the activity list and the monthly XP chart. Newest first.

Query: `?limit=20` (max 50) · `?cursor=<transactionId>` · `?period=YYYY-MM`

```jsonc
{
  "events": [
    {
      "id": "clx…",
      "sourceType": "SUBMISSION_APPROVED",   // XpSourceType enum
      "amount": 150,
      "periodId": "2026-08",
      "metadata": { "campaignName": "Nike SS26" },  // nullable, shape varies by source
      "createdAt": "2026-08-04T09:12:00Z"
    }
  ],
  "nextCursor": "clx…"    // null on last page
}
```

Notes:

- Display copy per `sourceType` lives client-side — the server sends the enum,
  not a sentence.
- `periodId` is stamped at write time. Treasure hunt rows predating gamification
  carry NULL in the column (the append-only trigger blocks backfilling them);
  the server derives their period from `createdAt` so responses are uniform.
  Those rows are excluded from monthly leaderboards by design — Find Cipta
  shipped a month ahead of gamification.

## 2. `GET /leaderboard?period=YYYY-MM` — podium + rankings

`period` optional; omitted = current month.

```jsonc
{
  "periods": [                                    // oldest → newest; last entry is always current
    { "id": "2026-06", "label": "Jun 2026" },
    { "id": "2026-07", "label": "Jul 2026" },
    { "id": "2026-08", "label": "Aug 2026" }
  ],
  "period": {
    "id": "2026-08",
    "label": "Aug 2026",
    "isCurrent": true,                            // client disables the forward arrow on this
    "headline": "Keep going — 70 XP gets you into the Top 10!",
    "entries": [                                  // rank asc, capped at 20
      {
        "userId": "clx…",
        "rank": 1,
        "name": "Kimi",
        "avatarUrl": "https://…",                 // null → client renders initial fallback
        "xp": 1988,
        "rankDelta": 11,                          // + climbed, − dropped, 0 unchanged
        "isCurrentUser": false
      }
    ],
    "me": {                                       // same entry shape, or null if creator has no
      "userId": "…", "rank": 87                   //   XP this period; present even when rank > 20
    }
  }
}
```

Notes:

- `me` is separate from `entries` so the pinned "You" row works when the
  creator is outside the top 20.
- `rankDelta`: current period → vs. yesterday's standings; closed periods →
  vs. that period's previous month final. Frozen once snapshotted.
- `headline` is server-composed (templated from the creator's standing).
  Client renders it verbatim — no copy logic in the app.
- Unknown period → `404 { "message": "Unknown period" }`.
- `periods` starts at the first month gamification was live. Treasure hunt XP
  earned before that has no `periodId` and never appears in a leaderboard,
  though it does count toward `totalXp` and rank.

## 3. `GET /codex` — badge grid + detail

Feeds the codex grid, category counts, and badge detail. The client derives
prev/next navigation from array order, so **server ordering is contractual**:
categories beginner → intermediate → advanced → secret, `sortOrder` within.

```jsonc
{
  "categories": [
    { "id": "beginner", "label": "BEGINNER", "unlockedCount": 3, "totalCount": 6 }
  ],
  "badges": [
    {
      "id": "first-light",
      "name": "First Light",
      "category": "beginner",
      "rarity": "common",                  // common | uncommon | rare | legendary | secret
      "icon": "lightbulb-outline",         // MaterialDesignIcons name — client renders directly
      "description": "Register and log in for the first time on Cult Creative.",
      "xp": 25,                            // rarity-fixed: 25 / 75 / 100 / 200, secret 50
      "unlocked": true,
      "unlockedAt": "2026-05-11T03:12:00Z", // null when locked
      "progressCurrent": 1,
      "progressTarget": 1,
      "earnedPercent": 99                  // % of active creators who unlocked it
    }
  ]
}
```

**Secret masking is a server guarantee:** locked `secret` badges return
`"description": null` (name stays visible). The client renders `null` as
`"???"`. Unlocked secrets return the real description.

## 4. `POST /codex-visit` — Lurker counter

Empty body. Deduped server-side to one counted visit per creator per day.

```jsonc
// 200
{
  "progressCurrent": 7,
  "progressTarget": 10,
  "unlocked": false        // true on the visit that unlocks — client toasts immediately
}
```

---

## Socket events (award engine)

Emitted to the creator's room on the existing Socket.IO/Redis setup:

```jsonc
"gamification:xp"            { "xp": 150, "sourceType": "SUBMISSION_APPROVED", "totalXp": 3570 }
"gamification:rankUp"        { "rank": { "id": "trendsetter", "name": "Trendsetter", "minXp": 5000 } }
"gamification:badgeUnlocked" { "badgeId": "first-drop", "name": "First Drop", "rarity": "rare", "xp": 100 }
```

Clients treat sockets as cache-patch hints and refetch `/me` on reconnect —
sockets are never the source of truth.

Awards made inside a caller's transaction (treasure hunt claims) do not emit —
the socket fires only on the standalone path, so the caller owns any
notification once its transaction commits.

## Conventions

- **Errors:** standard backend shape `{ "message": string }` — 401
  unauthenticated, 403 not a creator, 404 unknown period.
- **Caching:** `/leaderboard` current period may be up to ~60s stale (Redis).
  Closed periods and `earnedPercent` cache aggressively.
- **Versioning:** additive changes only (new optional fields are fine);
  anything breaking gets a new route.

## Open items for review

1. The full rank ladder rides along on `/me` rather than a separate `/ranks`
   route — 5 rows, not worth a round trip.
2. Prev/next badge navigation depends on server array order rather than
   explicit `prevId`/`nextId` — simpler, but reordering badges changes
   navigation (probably desired anyway).
3. **Do ranks ever go down?** Thresholds are only checked upward, so a
   compensating row (revoked submission) lowers `total` without demoting.
   Reads as intentional; worth confirming it is.
4. **Pre-gamification hunt XP counts toward rank but no leaderboard.** A
   creator who scanned heavily during Find Cipta may open the first leaderboard
   ranked higher than their visible month's XP explains. Product call.
