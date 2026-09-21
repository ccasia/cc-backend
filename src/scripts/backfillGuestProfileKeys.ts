/**
 * Backfill `Creator.guestProfileKey` for existing guest creators.
 *
 * Safe by design:
 *  - It writes a key only when exactly one guest creator maps to that key.
 *  - A group of two or more creators becomes a `GuestProfileIdentityConflict`
 *    row and keeps a null key. It is never silently merged, and a conflicting
 *    key is never left null so that a duplicate can be created later.
 *  - It skips a key another creator already owns.
 *  - It is idempotent. Running it again changes nothing.
 *
 * Usage:
 *   npx tsx src/scripts/backfillGuestProfileKeys.ts --dry-run
 *   npx tsx src/scripts/backfillGuestProfileKeys.ts
 */
import { PrismaClient, SocialPlatform } from '@prisma/client';

import { normalizeProfileUrl } from '../service/guestProfileExtraction/profileUrlNormalizer';

interface Group {
  canonicalKey: string;
  platform: SocialPlatform;
  creatorIds: string[];
  userIds: string[];
  profileLinks: string[];
}

export function groupGuestsByCanonicalKey(
  creators: readonly { id: string; userId: string; profileLink: string | null }[],
): { groups: Map<string, Group>; unnormalizable: string[] } {
  const groups = new Map<string, Group>();
  const unnormalizable: string[] = [];

  creators.forEach((creator) => {
    const link = creator.profileLink ?? '';
    const normalized = normalizeProfileUrl(link);
    if (!normalized.ok) {
      unnormalizable.push(creator.id);
      return;
    }

    const { canonicalKey, platform } = normalized.profile;
    const group = groups.get(canonicalKey) ?? {
      canonicalKey,
      platform: platform as SocialPlatform,
      creatorIds: [],
      userIds: [],
      profileLinks: [],
    };
    group.creatorIds.push(creator.id);
    group.userIds.push(creator.userId);
    if (!group.profileLinks.includes(link)) group.profileLinks.push(link);
    groups.set(canonicalKey, group);
  });

  return { groups, unnormalizable };
}

async function main(): Promise<void> {
  // Built here, not at module load, so importing the pure grouping helper in a
  // test never opens a database client.
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes('--dry-run');

  const creators = await prisma.creator.findMany({
    where: { isGuest: true, guestProfileKey: null },
    select: { id: true, userId: true, profileLink: true },
  });

  const { groups, unnormalizable } = groupGuestsByCanonicalKey(creators);

  const singles = [...groups.values()].filter((g) => g.creatorIds.length === 1);
  const conflicts = [...groups.values()].filter((g) => g.creatorIds.length > 1);

  console.log(`guest creators without a key: ${creators.length}`);
  console.log(`links this backend cannot canonicalize: ${unnormalizable.length}`);
  console.log(`keys to write: ${singles.length}`);
  console.log(`conflict groups: ${conflicts.length}`);

  if (dryRun) {
    conflicts.forEach((g) => console.log(`  CONFLICT ${g.canonicalKey} -> ${g.creatorIds.length} creators`));
    console.log('dry run, nothing written');
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const group of singles) {
    const taken = await prisma.creator.findFirst({
      where: { guestProfileKey: group.canonicalKey },
      select: { id: true },
    });
    if (taken) {
      // Another creator already owns this key. That is a conflict too.
      conflicts.push({ ...group, creatorIds: [...group.creatorIds, taken.id] });
      skipped += 1;
      continue;
    }
    await prisma.creator.update({
      where: { id: group.creatorIds[0] },
      data: { guestProfileKey: group.canonicalKey },
    });
    written += 1;
  }

  for (const group of conflicts) {
    await prisma.guestProfileIdentityConflict.upsert({
      where: { canonicalProfileKey: group.canonicalKey },
      update: {
        creatorIds: group.creatorIds,
        userIds: group.userIds,
        profileLinks: group.profileLinks,
      },
      create: {
        canonicalProfileKey: group.canonicalKey,
        platform: group.platform,
        creatorIds: group.creatorIds,
        userIds: group.userIds,
        profileLinks: group.profileLinks,
      },
    });
  }

  console.log(`keys written: ${written}`);
  console.log(`keys skipped because another creator owned them: ${skipped}`);
  console.log(`conflict records written: ${conflicts.length}`);

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
