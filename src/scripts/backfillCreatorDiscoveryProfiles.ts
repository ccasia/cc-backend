import 'dotenv/config';
import { Creator } from '@prisma/client';
import { prisma } from '../prisma/prisma';
import { saveDiscoveryProfile } from '../service/creatorDiscoveryProfileService';

/** Repeatable. Reads saved audits and platform-specific manual fields; never calls Apify. */
export async function backfillCreatorDiscoveryProfiles() {
  let cursor: string | undefined;
  let auditCount = 0;
  let fallbackCount = 0;
  for (;;) {
    const audits = await prisma.guestCreatorMetricAudit.findMany({
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { extraction: true, pitch: { select: { userId: true } } },
    });
    if (!audits.length) break;
    for (const audit of audits) {
      await prisma.$transaction((tx) =>
        saveDiscoveryProfile(tx, { ...audit, guestUserId: audit.guestUserId ?? audit.pitch.userId }, audit.extraction),
      );
      auditCount += 1;
    }
    cursor = audits[audits.length - 1].id;
  }
  cursor = undefined;
  for (;;) {
    const creators: (Creator & { user: { createdAt: Date } })[] = await prisma.creator.findMany({
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      include: { user: { select: { createdAt: true } } },
    });
    if (!creators.length) break;
    for (const creator of creators) {
      for (const platform of ['instagram', 'tiktok'] as const) {
        const followers =
          platform === 'instagram' ? creator.manualInstagramFollowerCount : creator.manualTiktokFollowerCount;
        const rate =
          platform === 'instagram' ? creator.manualInstagramEngagementRate : creator.manualTiktokEngagementRate;
        // Legacy follower columns default to zero: without an audit or measured rate,
        // that default is not evidence of a saved platform profile.
        if (!(followers != null && followers > 0) && rate == null) continue;
        await prisma.$transaction((tx) =>
          saveDiscoveryProfile(
            tx,
            {
              guestUserId: creator.userId,
              platform,
              source: 'manual_override',
              finalFollowerCount: followers != null && followers > 0 ? followers : null,
              finalEngagementRate: rate,
              createdAt: creator.tierUpdatedAt ?? creator.user.createdAt,
            },
            undefined,
            true,
          ),
        );
        fallbackCount += 1;
      }
    }
    cursor = creators[creators.length - 1].id;
  }
  const counts = await prisma.creatorDiscoveryProfile.groupBy({ by: ['platform'], _count: true });
  return { auditsRead: auditCount, fallbacksRead: fallbackCount, profiles: counts };
}

if (require.main === module) {
  backfillCreatorDiscoveryProfiles()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .finally(() => prisma.$disconnect())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
