/**
 * Migration script to copy guestProfileLink values from User to Creator.profileLink
 * 
 * This ensures backwards compatibility when removing the guestProfileLink field from User model.
 * Run this script BEFORE applying the schema migration that removes guestProfileLink.
 * 
 * Usage: npx ts-node prisma/migrateGuestProfileLinks.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateGuestProfileLinks() {
  console.log('Starting migration of guestProfileLink values to Creator.profileLink...');

  try {
    // Find all users with guestProfileLink set
    const usersWithGuestProfileLink = await prisma.user.findMany({
      where: {
        guestProfileLink: {
          not: null,
        },
      },
      include: {
        creator: true,
      },
    });

    console.log(`Found ${usersWithGuestProfileLink.length} users with guestProfileLink`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const user of usersWithGuestProfileLink) {
      try {
        if (!user.creator) {
          console.log(`User ${user.id} has guestProfileLink but no Creator record. Creating Creator...`);
          await prisma.creator.create({
            data: {
              userId: user.id,
              isGuest: true,
              profileLink: user.guestProfileLink,
            },
          });
          migratedCount++;
          console.log(`  Created Creator with profileLink for user ${user.id}`);
        } else if (!user.creator.profileLink) {
          // Creator exists but profileLink is not set - copy from guestProfileLink
          await prisma.creator.update({
            where: { userId: user.id },
            data: {
              profileLink: user.guestProfileLink,
            },
          });
          migratedCount++;
          console.log(`  Migrated profileLink for user ${user.id}`);
        } else {
          // Creator already has profileLink - skip
          skippedCount++;
          console.log(`  Skipped user ${user.id} - Creator already has profileLink: ${user.creator.profileLink}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`  Error migrating user ${user.id}:`, error);
      }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Total users processed: ${usersWithGuestProfileLink.length}`);
    console.log(`Successfully migrated: ${migratedCount}`);
    console.log(`Skipped (already had profileLink): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);

    if (errorCount === 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('You can now safely apply the schema migration to remove guestProfileLink from User model.');
    } else {
      console.log('\n⚠️ Migration completed with errors. Please review the errors above.');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateGuestProfileLinks();
