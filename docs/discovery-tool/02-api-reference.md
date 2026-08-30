# Creator Discovery Tool — Backend API Reference

## Routes

Defined in `cc-backend/src/routes/discoveryRoute.ts`. All require the `isLoggedIn` session middleware.

```typescript
router.get('/creators', isLoggedIn, getDiscoveryCreatorsList);
router.get('/non-platform-creators', isLoggedIn, getNonPlatformDiscoveryCreatorsList);
router.post('/invite-creators', isLoggedIn, inviteDiscoveryCreatorsController);
```

---

## 1. GET `/api/discovery/creators`

Search and filter platform-connected creators (Instagram/TikTok).

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `search` | `string` | — | Free-text search across name, Instagram handle, TikTok handle, and bio |
| `platform` | `'all' \| 'instagram' \| 'tiktok'` | `'all'` | Filter by connected platform |
| `page` | `number` | `1` | Page number (1-indexed) |
| `limit` | `number` | `20` | Results per page (max 100) |
| `hydrateMissing` | `'true' \| 'false'` | `'false'` | Refresh stale data from platform APIs |
| `gender` | `'Male' \| 'Female' \| 'Non-Binary'` | — | Filter by gender |
| `ageRange` | `string` | — | Age range e.g. `'18-24'`, `'25-34'`, `'35-44'`, `'45-54'` |
| `country` | `string` | — | Filter by country (case-insensitive exact match) |
| `city` | `string` | — | Filter by city (case-insensitive exact match) |
| `creditTier` | `string` | — | Filter by credit tier name e.g. `'Nano A'`, `'Micro B'`, `'Macro'` |
| `languages` | `string` | — | JSON array or comma-separated list e.g. `'["English","Malay"]'` |
| `interests` | `string` | — | JSON array or comma-separated list e.g. `'["Art","Lifestyle"]'` |
| `keyword` | `string` | — | Search in content captions/titles plus creator name and handles |
| `hashtag` | `string` | — | Search for hashtags in content e.g. `'#fashion, #ootd'` |
| `sortBy` | `'name' \| 'followers'` | `'name'` | Sort field |
| `sortDirection` | `'asc' \| 'desc'` | Depends on `sortBy` | `name` defaults to `asc`, `followers` defaults to `desc` |

### Response Shape

```json
{
  "filters": {
    "search": "",
    "platform": "all",
    "sortBy": "name",
    "sortDirection": "asc"
  },
  "data": [
    {
      "type": "connected",
      "rowId": "userId-instagram",
      "userId": "clu1234...",
      "creatorId": "clu5678...",
      "name": "Alice Tan",
      "platform": "instagram",
      "gender": "Female",
      "age": 27,
      "location": "Kuala Lumpur, Malaysia",
      "creditTier": "Micro A",
      "handles": {
        "instagram": "alicetan",
        "tiktok": "@alicetok"
      },
      "interests": ["Fashion", "Lifestyle"],
      "about": "Fashion creator based in KL",
      "instagram": {
        "connected": true,
        "profilePictureUrl": "https://...",
        "biography": "Fashion enthusiast",
        "followers": 15000,
        "engagementRate": 3.5,
        "totalLikes": 45000,
        "totalSaves": 2000,
        "totalShares": 500,
        "averageLikes": 900,
        "averageSaves": 40,
        "averageShares": 10,
        "insightData": { "..demographic and reach data..." },
        "topVideos": [
          {
            "id": "17854...",
            "media_url": "https://...",
            "media_type": "VIDEO",
            "thumbnail_url": "https://...",
            "caption": "New outfit reveal #ootd",
            "permalink": "https://instagram.com/p/...",
            "like_count": 1200,
            "comments_count": 35,
            "datePosted": "2025-11-15T10:00:00.000Z"
          }
        ]
      },
      "tiktok": {
        "connected": false,
        "profilePictureUrl": null,
        "biography": null,
        "followers": 0,
        "engagementRate": 0,
        "averageLikes": 0,
        "averageSaves": 0,
        "averageShares": 0,
        "topVideos": []
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 143
  },
  "availableLocations": {
    "Malaysia": ["Kuala Lumpur", "Penang", "Johor Bahru"],
    "Singapore": ["Singapore"]
  }
}
```

### Notes

- When `platform` is `'all'`, a creator connected to **both** platforms produces **two rows** — one per platform. The total count accounts for this duplication.
- `availableLocations` is computed from all connected creators (ignoring your current filters) to populate location dropdowns.
- `topVideos` are sorted by like count (highest first), then recency, limited to 3 per platform.

---

## 2. GET `/api/discovery/non-platform-creators`

Search guest/manually-added creators.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `platform` | `'all' \| 'instagram' \| 'tiktok'` | `'all'` | Filter by profile link or handle platform |
| `keyword` | `string` | — | Search name, handles, and profile link |
| `followers` | `number` | — | Minimum manual follower count |
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `20` | Results per page |

### Response Shape

```json
{
  "filters": {
    "platform": "all",
    "keyword": "",
    "followers": null
  },
  "data": [
    {
      "rowId": "clu1234...",
      "userId": "clu1234...",
      "creatorId": "clu5678...",
      "name": "Guest Creator",
      "platform": "instagram",
      "followers": 5000,
      "profileLink": "https://instagram.com/guestcreator",
      "handles": {
        "instagram": "guestcreator",
        "tiktok": null
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50
  }
}
```

### Notes

- Platform is inferred from the `profileLink` URL (contains "instagram" or "tiktok"). Falls back to checking saved handles.
- Ordered by `manualFollowerCount` descending, then `name` ascending.

---

## 3. POST `/api/discovery/invite-creators`

Invite one or more creators to a campaign.

### Request Body

```json
{
  "campaignId": "clx1234...",
  "creatorIds": ["userId1", "userId2"],
  "creators": [{ "id": "userId3" }]
}
```

Both `creatorIds` and `creators[].id` are merged and deduplicated.

### Response Shape

```json
{
  "message": "Creators invited successfully",
  "campaignId": "clx1234...",
  "isV4Campaign": true,
  "invitedCount": 2,
  "skippedExistingCount": 1,
  "skippedNotFoundCount": 0
}
```

### Authorization

- Requires active session (`req.session.userid`)
- User must be a **campaign admin** for the specified campaign, or a **superadmin**

### What the Invite Creates

All operations happen inside a single database transaction:

| Record | V3 Campaign | V4 Campaign |
|---|---|---|
| **Pitch** | Status: `APPROVED`, type: `shortlisted`, `isInvited: true` | Status: `SENT_TO_CLIENT` |
| **ShortListedCreator** | Created/updated | Not created |
| **CreatorAgreement** | Created if missing | Not created |
| **Submissions** | Created from campaign timelines with task dependencies | Not created |
| **UserThread** | Added to campaign chat thread | Added to campaign chat thread |
| **Notifications** (clients) | Created for all client admins | Created for all client admins |
| **Campaign Log** | Logged | Logged |

After the transaction commits (V3 only):
- A notification is saved and emitted via **Socket.io** to each invited creator (`notification` and `pitchUpdate` events).

### Error Handling

- Returns `400` with the error message for validation failures or authorization errors.
- Creators that already have a pitch for the campaign are **skipped** (not counted as errors).

---

**Next:** [03 — Backend Helpers Reference](./03-helpers-reference.md)
