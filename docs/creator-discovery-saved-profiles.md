# Saved Master List profiles in Discovery

Discovery combines connected accounts with saved Master List profiles. Each row is one user and one platform. Connected metrics take priority per field, including zero. Unknown values remain null. Saved scrape evidence stays separate from manual changes.

## Release order

1. Apply `20260928000000_add_creator_discovery_profiles` and `20260928010000_add_saved_profile_biography` through the normal migration process. Generate the Prisma client for the API and extraction worker, including each Docker container.
2. Deploy the save changes with `DISCOVERY_SAVED_PROFILES_ENABLED=false`. Saves write durable profiles in the existing transactions. This flag controls reads only.
3. Run `yarn backfill-discovery-profiles`. It reads saved audits and platform-specific manual fields. It does not contact Apify. Repeat runs keep newer values and do not create duplicate profiles. The legacy follower fields default to zero; a default alone does not establish a saved profile. Audited zero values are retained.
4. Run `yarn backfill-discovery-media` if older saved runs need bios or thumbnail URLs. This reads the datasets of already completed runs. It cannot start new runs. `APIFY_TOKEN` must be present. Expired or deleted provider datasets cannot be recovered by this script.
5. Set `DISCOVERY_SAVED_PROFILES_ENABLED=true` (or remove it), then restart the API. Check counts, rates, platform links, bookmarks and export.

The local database already had the old schema but no migration baseline. Only the two new additive SQL files were applied locally, then marked applied. Do not run all old migrations against that local database without checking its baseline.

## Checks

- `yarn test --runInBand --watchman=false discovery`
- `yarn typecheck`
- `yarn verify-discovery-profiles`: exercises saves, manual changes, preview isolation, failure, expiry and pending completion in one transaction, then rolls it back. Use a local test database with at least one campaign.
- `yarn check-discovery-samples`: checks the five named local samples. These names are local test data, not a release requirement for other databases.
- Frontend: `yarn test src/sections/discovery-tool/components/`

Do not run `yarn build` for this change.

## Images and bios

New results retain the Instagram `displayUrl` and TikTok `videoMeta.coverUrl`, plus Instagram `biography` and TikTok `authorMeta.signature`. The URLs can expire. Discovery falls back to the existing public post embed when an image fails. A preview still depends on the platform allowing that post to be embedded. A post without an image or supported link keeps the image placeholder.

Missing bios keep the current empty state. Connected bios take priority. The saved bio is used when the connected account has none. No extra provider runs or fields are requested from Apify.
