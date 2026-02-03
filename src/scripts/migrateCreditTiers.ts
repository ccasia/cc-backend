/**
 * Credit Tier Migration Script
 *
 * One-time migration script to:
 * 1. Ensure credit tier configuration exists (seed if missing)
 * 2. Assign credit tiers to existing creators with media kit data
 *
 * Run with: yarn ts-node src/scripts/migrateCreditTiers.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  getHighestFollowerCount,
  getTierByFollowerCount,
} from '../service/creditTierService';

const prisma = new PrismaClient();

// Credit Tier configuration (same as seed.ts)
const creditTiers = [
  { name: 'Nano A', minFollowers: 1000, maxFollowers: 5000, creditsPerVideo: 1 },
  { name: 'Nano B', minFollowers: 5001, maxFollowers: 15000, creditsPerVideo: 2 },
  { name: 'Micro A', minFollowers: 15001, maxFollowers: 30000, creditsPerVideo: 3 },
  { name: 'Micro B', minFollowers: 30001, maxFollowers: 50000, creditsPerVideo: 4 },
  { name: 'Micro C', minFollowers: 50001, maxFollowers: 100000, creditsPerVideo: 5 },
  { name: 'Macro', minFollowers: 100001, maxFollowers: null, creditsPerVideo: 8 }, // 100K+ followers - Unlimited
];

async function seedCreditTiers() {
  console.log('Step 1: Seeding Credit Tier configuration...\n');

  for (const tier of creditTiers) {
    const existing = await prisma.creditTier.findUnique({
      where: { name: tier.name },
    });

    if (existing) {
      console.log(`  Tier "${tier.name}" already exists, updating...`);
      await prisma.creditTier.update({
        where: { name: tier.name },
        data: {
          minFollowers: tier.minFollowers,
          maxFollowers: tier.maxFollowers,
          creditsPerVideo: tier.creditsPerVideo,
        },
      });
    } else {
      await prisma.creditTier.create({
        data: {
          name: tier.name,
          minFollowers: tier.minFollowers,
          maxFollowers: tier.maxFollowers,
          creditsPerVideo: tier.creditsPerVideo,
        },
      });
      console.log(`  Created tier: ${tier.name}`);
    }
  }

  console.log('\nCredit Tiers seeded successfully.\n');
}

async function assignTiersToCreators() {
  console.log('Step 2: Assigning tiers to creators with follower data...\n');

  // Find creators with Instagram or TikTok connected, or manual follower count
  const creatorsWithFollowerData = await prisma.creator.findMany({
    where: {
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

  console.log(`  Found ${creatorsWithFollowerData.length} creators with follower data\n`);

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const tierCounts: Record<string, number> = {};

  for (const creator of creatorsWithFollowerData) {
    try {
      const followerCount = getHighestFollowerCount({
        instagramFollowers: creator.instagramUser?.followers_count,
        tiktokFollowers: creator.tiktokUser?.follower_count,
        manualFollowers: creator.manualFollowerCount,
      });

      if (followerCount === 0) {
        skippedCount++;
        continue;
      }

      const tier = await getTierByFollowerCount(followerCount);

      if (!tier) {
        // Follower count below minimum tier (< 1000)
        skippedCount++;
        continue;
      }

      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          creditTierId: tier.id,
          tierUpdatedAt: new Date(),
        },
      });

      tierCounts[tier.name] = (tierCounts[tier.name] || 0) + 1;
      successCount++;

      // Progress indicator every 50 creators
      if (successCount % 50 === 0) {
        console.log(`  Processed ${successCount} creators...`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`  Error processing creator ${creator.id}: ${error.message}`);
    }
  }

  console.log('\n--- Migration Summary ---');
  console.log(`  Successfully assigned: ${successCount}`);
  console.log(`  Skipped (no valid tier): ${skippedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log('\n--- Tier Distribution ---');
  for (const [tierName, count] of Object.entries(tierCounts).sort()) {
    console.log(`  ${tierName}: ${count} creators`);
  }
}

async function main() {
  console.log('=============================================');
  console.log('Credit Tier Migration Script');
  console.log('=============================================\n');

  try {
    await seedCreditTiers();
    await assignTiersToCreators();

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
