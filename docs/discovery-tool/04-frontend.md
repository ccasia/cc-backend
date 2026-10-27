# Creator Discovery Tool — Frontend Documentation

## Access & Permissions

The discovery tool is restricted to users with the `superadmin` or `god` role, enforced by `RoleBasedGuard`.

### Navigation

In the sidebar (`config-navigation.jsx`), the tool appears as **"Creator Discovery Tool"** with two sub-items:
- **Platform Creators** → `/dashboard/discovery-tool`
- **Non-Platform Creators** → `/dashboard/discovery-tool/npc`

---

## Component Tree

```
Pages
├── discovery-tool.jsx                    (page wrapper)
│   └── DiscoveryToolView                 (main orchestrator)
│       ├── DiscoveryFilterBar            (all filter controls)
│       │   └── FilterPills               (active filter chips)
│       ├── CreatorList                   (results grid + pagination)
│       │   ├── CreatorCard               (individual creator with stats & videos)
│       │   └── CreatorCardSkeleton       (loading placeholder)
│       ├── CompareCreatorsDialog         (side-by-side comparison)
│       └── InviteCreatorsDialog          (invite to campaign)
│
└── discovery-tool-npc.jsx                (page wrapper)
    └── DiscoveryToolNpcView              (simplified non-platform view)
```

---

## File Locations

| File | Purpose |
|---|---|
| `cc-frontend/src/pages/dashboard/discovery-tool/discovery-tool.jsx` | Route page wrapper for platform creators |
| `cc-frontend/src/pages/dashboard/discovery-tool/discovery-tool-npc.jsx` | Route page wrapper for non-platform creators |
| `cc-frontend/src/sections/discovery-tool/view/discovery-tool-view.jsx` | Main view: filter state, pagination, selection |
| `cc-frontend/src/sections/discovery-tool/view/discovery-tool-npc-view.jsx` | Non-platform view: simplified filter & grid |
| `cc-frontend/src/sections/discovery-tool/view/compare-creators-dialog.jsx` | Side-by-side creator comparison |
| `cc-frontend/src/sections/discovery-tool/view/invite-creators-dialog.jsx` | Campaign invitation dialog |
| `cc-frontend/src/sections/discovery-tool/components/DiscoveryFilterBar.jsx` | Filter controls + debounced inputs |
| `cc-frontend/src/sections/discovery-tool/components/FilterPills.jsx` | Active filter chips with remove action |
| `cc-frontend/src/sections/discovery-tool/components/CreatorList.jsx` | Creator grid, pagination, selection checkboxes |
| `cc-frontend/src/sections/discovery-tool/components/CreatorCard.jsx` | Individual creator card display |
| `cc-frontend/src/sections/discovery-tool/constants.js` | Filter options, reducer, initial state |
| `cc-frontend/src/hooks/use-get-discovery-creators.js` | SWR hook for platform creators API |
| `cc-frontend/src/hooks/use-get-discovery-npc-creators.js` | SWR hook for non-platform creators API |

---

## Data Fetching

The frontend uses **SWR** (not React Query). Two dedicated hooks handle API communication.

### `useGetDiscoveryCreators(filters)`

**File:** `cc-frontend/src/hooks/use-get-discovery-creators.js`

**Calls:** `GET /api/discovery/creators`

Converts the `filters` object into URL query parameters and uses SWR to fetch and cache the response.

| Input Property | Sent As | Notes |
|---|---|---|
| `platform` | `?platform=instagram` | Default: `'all'` |
| `page` | `?page=1` | Default: `1` |
| `limit` | `?limit=20` | Default: `20` |
| `hydrateMissing` | `?hydrateMissing=true` | Default: `true` |
| `sortBy` | `?sortBy=name` | `'name'` or `'followers'` |
| `sortDirection` | `?sortDirection=asc` | `'asc'` or `'desc'` |
| `gender` | `?gender=Female` | Only sent when set |
| `ageRange` | `?ageRange=18-24` | Only sent when set |
| `country` | `?country=Malaysia` | Only sent when set |
| `city` | `?city=Kuala+Lumpur` | Only sent when set |
| `creditTier` | `?creditTier=Micro+A` | Only sent when set |
| `keyword` | `?keyword=fashion` | Only sent when set |
| `hashtag` | `?hashtag=%23ootd` | Only sent when set |
| `languages` | `?languages=["English","Malay"]` | JSON stringified array |
| `interests` | `?interests=["Art","Lifestyle"]` | JSON stringified array |

**Returns:**

```javascript
{
  creators: [],            // Array of creator objects (see API response in 02-api-reference.md)
  pagination: {            // { page, limit, total }
    page: 1, limit: 20, total: 143
  },
  availableLocations: {},  // { "Malaysia": ["KL", "Penang"], ... }
  isLoading: false,
  pageSize: 20,
  mutate: Function,        // SWR mutate for manual revalidation
  isError: null
}
```

**SWR options:**
- `revalidateOnFocus: false` — Does not re-fetch when user switches tabs
- `keepPreviousData: true` — Keeps showing previous results while new data loads

---

### `useGetDiscoveryNpcCreators(filters)`

**File:** `cc-frontend/src/hooks/use-get-discovery-npc-creators.js`

**Calls:** `GET /api/discovery/non-platform-creators`

Simpler version for non-platform creators. Sends `platform`, `keyword`, `followers`, `page`, `limit`.

**Returns:**

```javascript
{
  creators: [],
  pagination: { page, limit, total },
  isLoading: false,
  mutate: Function,
  isError: null
}
```

---

### Invite API Call

Invitations are made directly via axios (not SWR), since it's a POST mutation:

```javascript
import axiosInstance, { endpoints } from 'src/utils/axios';

await axiosInstance.post(endpoints.discovery.inviteCreators, {
  campaignId: 'clx1234...',
  creatorIds: ['userId1', 'userId2'],
});
```

**Endpoint constant:** `endpoints.discovery.inviteCreators` → `'/api/discovery/invite-creators'`

---

## Axios Endpoints

Defined in `cc-frontend/src/utils/axios.js`:

```javascript
discovery: {
  creators: '/api/discovery/creators',
  nonPlatformCreators: '/api/discovery/non-platform-creators',
  inviteCreators: '/api/discovery/invite-creators',
}
```

---

## Filter State Management

### Constants (`constants.js`)

Predefined filter options:

| Constant | Values |
|---|---|
| `AGE_RANGES` | `['18-24', '25-34', '35-44', '45-54']` |
| `GENDERS` | `['Male', 'Female', 'Non-Binary']` |
| `CREDIT_TIERS` | `['Nano A', 'Nano B', 'Micro A', 'Micro B', 'Micro C', 'Macro']` |
| `PLATFORMS` | `['All', 'Instagram', 'TikTok']` |
| `LANGUAGES` | 120+ languages sorted alphabetically |

### Filter Reducer

The `DiscoveryFilterBar` component uses `useReducer` to manage filter state. This centralizes all filter changes and enables debouncing.

**Initial State (`FILTER_INITIAL_STATE`):**
All filters start empty/unset. Platform defaults to `'all'`.

**Key reducer actions:**

| Action | What It Does |
|---|---|
| `SET_KEYWORD` | Updates the raw keyword (for UI display) |
| `SET_DEBOUNCED_KEYWORD` | Updates the debounced keyword (triggers API call) |
| `SET_HASHTAG` | Updates the raw hashtag |
| `SET_DEBOUNCED_HASHTAG` | Updates the debounced hashtag |
| `SET_PLATFORM` | Changes platform filter |
| `SET_GENDER` | Changes gender filter |
| `SET_AGE_RANGE` | Changes age range filter |
| `SET_COUNTRY` | Changes country, **clears city** |
| `SET_CITY` | Changes city |
| `SET_CREDIT_TIER` | Changes credit tier |
| `SET_LANGUAGES` | Changes languages (multi-select) |
| `SET_INTERESTS` | Changes interests (multi-select) |
| `CLEAR_ALL` | Resets everything to initial state |

**Debouncing:** Keyword and hashtag inputs are debounced by **300ms** so the API is not called on every keystroke.

---

## User Interaction Flows

### 1. Searching and Filtering

1. User opens the discovery tool page
2. `DiscoveryFilterBar` renders with all filter controls at their default values
3. User adjusts filters (platform, gender, keyword, etc.)
4. Filter changes are tracked locally in the reducer
5. User clicks **"Show Results"** (apply button)
6. The applied filters are passed to `useGetDiscoveryCreators`
7. SWR sends the GET request and renders results
8. Active filters are shown as `FilterPills` chips that can be removed individually

### 2. Pagination

1. `CreatorList` renders a MUI `Pagination` component at the bottom
2. Changing the page updates the `page` filter
3. SWR sends a new request with the updated page
4. `keepPreviousData` ensures the previous page's results stay visible during loading

### 3. Sorting

1. A sort toggle allows switching between `name` (alphabetical) and `followers` (by count)
2. Changing the sort sends new `sortBy` and `sortDirection` params to the API
3. The backend handles sorting at the database level for single-platform views
4. For `'all'` platform, sorting happens in-memory after the database fetch

### 4. Selecting and Comparing Creators

1. Each `CreatorCard` has a checkbox for selection
2. When exactly **2 creators** are selected, a "Compare" button appears
3. Clicking it opens `CompareCreatorsDialog` which displays both creators side-by-side
4. Comparison includes: name, platform stats, engagement rates, top videos

### 5. Inviting Creators to a Campaign

1. When **1 or more** creators are selected, an "Invite" button appears
2. Clicking it opens `InviteCreatorsDialog`
3. The dialog shows a list of available campaigns (requires user to select one)
4. User picks a campaign and confirms
5. Frontend POSTs to `/api/discovery/invite-creators` with `{ campaignId, creatorIds }`
6. On success, a snackbar confirmation is shown
7. The backend creates all necessary campaign records (see [02-api-reference.md](./02-api-reference.md#3-post-apidiscoveryinvite-creators))

---

## Creator Card Display

Each `CreatorCard` shows:

| Section | Data Shown |
|---|---|
| **Header** | Profile picture, name, platform badge, location |
| **Stats** | Followers, engagement rate, average likes/saves/shares |
| **Bio** | MediaKit "about" or platform biography |
| **Interests** | List of interest tags |
| **Top Videos** | Up to 3 video thumbnails with like/comment counts as overlay |

For Instagram videos, thumbnails link to the post `permalink`. For TikTok videos, the `video_url` is constructed as `https://www.tiktok.com/@{handle}/video/{video_id}`.

---

## Non-Platform Creators View

The NPC view (`DiscoveryToolNpcView`) is a simplified version:

- **Filters:** Platform (dropdown), keyword (text input), minimum followers (number input)
- **No debouncing** on filters — uses a "Search" button
- **Grid layout:** 5-column card grid with basic creator info
- **Card shows:** Name, platform icon, follower count, profile link
- **No comparison or invitation features** (simpler data set)

---

## Frontend → Backend Route Mapping

| Frontend Action | Component | HTTP Call | Backend Handler |
|---|---|---|---|
| Load/filter platform creators | `DiscoveryToolView` via SWR | `GET /api/discovery/creators?...` | `getDiscoveryCreatorsList` → `getDiscoveryCreators()` |
| Load/filter NPC creators | `DiscoveryToolNpcView` via SWR | `GET /api/discovery/non-platform-creators?...` | `getNonPlatformDiscoveryCreatorsList` → `getNonPlatformDiscoveryCreators()` |
| Invite creators to campaign | `InviteCreatorsDialog` via axios | `POST /api/discovery/invite-creators` | `inviteDiscoveryCreatorsController` → `inviteDiscoveryCreators()` |

---

## Performance Considerations

| Technique | Where | Why |
|---|---|---|
| **SWR `keepPreviousData`** | Both hooks | Prevents blank screen during page changes |
| **Debounced keyword/hashtag** | DiscoveryFilterBar | Avoids API spam during typing |
| **`React.memo`** | Filter bar, cards | Prevents unnecessary re-renders |
| **`useCallback`** | All event handlers in filter bar | Stable references for memoized children |
| **Gated apply flow** | DiscoveryToolView | API only called when user explicitly clicks "Show Results" |
| **`useMemo`** on SWR return | Both hooks | Prevents downstream re-renders when data hasn't changed |
