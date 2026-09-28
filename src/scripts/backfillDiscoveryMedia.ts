import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/prisma';
import { parseInstagramActorOutput } from '../service/guestProfileExtraction/actorAdapters/instagramActorAdapter';
import { parseTiktokActorOutput } from '../service/guestProfileExtraction/actorAdapters/tiktokActorAdapter';

/** Read existing datasets only. This script cannot start a provider run. */
async function main() {
  if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is required to read existing datasets');
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  const profiles = await prisma.creatorDiscoveryProfile.findMany({ where: { scrapedAt: { not: null } } });
  let updated = 0;
  let thumbnails = 0;
  let biographies = 0;
  for (const profile of profiles) {
    const details = profile.scrapeDetails as any;
    if (!details?.actorRunId || !profile.handle) continue;
    const extraction = await prisma.guestProfileExtraction.findFirst({
      where: { actorRunId: details.actorRunId },
      select: { actorDatasetId: true, profileActorRunId: true, profileActorDatasetId: true },
    });
    const datasetId =
      details.actorDatasetId ??
      extraction?.actorDatasetId ??
      (await client.run(details.actorRunId).get())?.defaultDatasetId;
    if (!datasetId) continue;
    const { items } = await client.dataset(datasetId).listItems({ limit: 1000, clean: true });
    const parse = profile.platform === 'instagram' ? parseInstagramActorOutput : parseTiktokActorOutput;
    const profileRunId = details.profileActorRunId ?? extraction?.profileActorRunId;
    const profileDatasetId =
      details.profileActorDatasetId ??
      extraction?.profileActorDatasetId ??
      (profileRunId ? (await client.run(profileRunId).get())?.defaultDatasetId : null);
    const profileItems = profileDatasetId
      ? (await client.dataset(profileDatasetId).listItems({ limit: 5, clean: true })).items
      : undefined;
    const result = parse({ items, profileItems, expectedUsername: profile.handle });
    if (!result.ok) continue;
    const images = new Map(
      result.candidates.filter((post) => post.thumbnailUrl).map((post) => [post.postId, post.thumbnailUrl]),
    );
    const addImages = (posts: any[]) =>
      (posts ?? []).map((post) => ({
        ...post,
        ...(images.has(post.postId) && !post.thumbnailUrl ? { thumbnailUrl: images.get(post.postId) } : {}),
      }));
    const biography = result.profile.biography;
    const patched = {
      ...details,
      ...(biography != null ? { biography } : {}),
      profileActorRunId: profileRunId ?? null,
      profileActorDatasetId: profileDatasetId ?? null,
      selectedPosts: addImages(details.selectedPosts),
      candidatePosts: addImages(details.candidatePosts),
    };
    if (biography) biographies += 1;
    thumbnails += patched.selectedPosts.filter((post: any) => post.thumbnailUrl).length;
    if (JSON.stringify(details) === JSON.stringify(patched)) continue;
    // Do not replace an intervening scrape or manual save.
    const changed = await prisma.creatorDiscoveryProfile.updateMany({
      where: { id: profile.id, scrapeDetails: { equals: details as Prisma.InputJsonValue } },
      data: { scrapeDetails: patched as Prisma.InputJsonValue, ...(biography != null ? { biography } : {}) },
    });
    updated += changed.count;
  }
  console.log(
    JSON.stringify({ profilesUpdated: updated, selectedThumbnails: thumbnails, biographies, providerRunsStarted: 0 }),
  );
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
