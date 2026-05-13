/**
 * Credit Tier Migration Script
 *
 * Assigns credit tiers to creators who do NOT yet have a tier (creditTierId IS NULL)
 * and have follower data from Instagram, TikTok, or manualFollowerCount.
 *
 * Does NOT seed or modify the CreditTier configuration rows. Production tiers are
 * managed manually via the admin UI; this script only reads them.
 *
 * Already-tiered creators are skipped entirely (their creditTierId is left untouched).
 *
 * Run with: yarn ts-node src/scripts/migrateCreditTiers.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  getHighestFollowerCount,
  getTierByFollowerCount,
  getAllActiveTiers,
} from '../service/creditTierService';

const prisma = new PrismaClient();

async function printActiveTiers() {
  const tiers = await getAllActiveTiers();

  if (tiers.length === 0) {
    throw new Error(
      'No active credit tiers found in the database. Aborting to avoid a no-op run.',
    );
  }

  console.log('Active Credit Tiers in database:');
  console.log('  Name        Min        Max          Credits/Video');
  console.log('  ---------   --------   ----------   -------------');
  for (const tier of tiers) {
    const min = tier.minFollowers.toLocaleString().padEnd(8);
    const max = (tier.maxFollowers === null ? 'unlimited' : tier.maxFollowers.toLocaleString()).padEnd(10);
    const name = tier.name.padEnd(9);
    console.log(`  ${name}   ${min}   ${max}   ${tier.creditsPerVideo}`);
  }
  console.log('');
}

async function assignTiersToUntierredCreators() {
  console.log('Assigning tiers to untierred creators with follower data...\n');

  const creatorsToProcess = await prisma.creator.findMany({
    where: {
      creditTierId: null,
      OR: [
        { instagramUser: { followers_count: { gt: 0 } } },
        { tiktokUser: { follower_count: { gt: 0 } } },
        { manualFollowerCount: { gt: 0 } },
      ],
    },
    include: {
      instagramUser: {
        select: { followers_count: true },
      },
      tiktokUser: {
        select: { follower_count: true },
      },
    },
  });

  console.log(`  Found ${creatorsToProcess.length} untierred creators with follower data\n`);

  let successCount = 0;
  let skippedBelowMinTier = 0;
  let skippedAboveMaxTier = 0;
  let errorCount = 0;
  const tierCounts: Record<string, { count: number; minFollowers: number }> = {};

  for (const creator of creatorsToProcess) {
    try {
      const followerCount = getHighestFollowerCount({
        instagramFollowers: creator.instagramUser?.followers_count,
        tiktokFollowers: creator.tiktokUser?.follower_count,
        manualFollowers: creator.manualFollowerCount,
      });

      if (followerCount === 0) {
        skippedBelowMinTier++;
        continue;
      }

      const tier = await getTierByFollowerCount(followerCount);

      if (!tier) {
        skippedAboveMaxTier++;
        console.log(`  Skipped creator ${creator.id}: ${followerCount.toLocaleString()} followers does not match any active tier`);
        continue;
      }

      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          creditTierId: tier.id,
          tierUpdatedAt: new Date(),
        },
      });

      if (!tierCounts[tier.name]) {
        tierCounts[tier.name] = { count: 0, minFollowers: tier.minFollowers };
      }
      tierCounts[tier.name].count++;
      successCount++;

      if (successCount % 50 === 0) {
        console.log(`  Processed ${successCount} creators...`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`  Error processing creator ${creator.id}: ${error.message}`);
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`  Successfully assigned:        ${successCount}`);
  console.log(`  Skipped (no/low follower data): ${skippedBelowMinTier}`);
  console.log(`  Skipped (above top tier max):   ${skippedAboveMaxTier}`);
  console.log(`  Errors:                       ${errorCount}`);
  console.log('\n--- Tier Distribution (newly assigned) ---');
  const sortedTiers = Object.entries(tierCounts).sort(
    ([, a], [, b]) => a.minFollowers - b.minFollowers,
  );
  for (const [tierName, { count }] of sortedTiers) {
    console.log(`  ${tierName}: ${count} creators`);
  }
}

async function main() {
  console.log('=============================================');
  console.log('Credit Tier Migration Script');
  console.log('=============================================\n');

  try {
    await printActiveTiers();
    await assignTiersToUntierredCreators();

    console.log('\n=============================================');
    console.log('Migration completed successfully!');
    console.log('=============================================');
  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
