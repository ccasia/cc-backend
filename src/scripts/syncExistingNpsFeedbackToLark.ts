/**
 * Script to sync existing NPS feedback data to Lark Bitable
 * 
 * Usage:
 *   npm run ts-node cc-backend/src/scripts/syncExistingNpsFeedbackToLark.ts
 * 
 * Or with tsx:
 *   npx tsx cc-backend/src/scripts/syncExistingNpsFeedbackToLark.ts
 */

import { PrismaClient } from '@prisma/client';
import { batchSyncNpsFeedbackToLark } from '../utils/larkBitableSync';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

async function syncExistingFeedback() {
  try {
    console.log('🔄 Starting sync of existing NPS feedback to Lark Bitable...');

    // Get all NPS feedback from database
    const feedbacks = await prisma.npsFeedback.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    console.log(`📊 Found ${feedbacks.length} feedback records to sync`);

    if (feedbacks.length === 0) {
      console.log('✅ No feedback to sync. Exiting.');
      process.exit(0);
    }

    // Prepare feedback data for sync
    const feedbackData = feedbacks.map((feedback) => ({
      userName: feedback.user?.name ?? undefined,
      userEmail: feedback.user?.email ?? undefined,
      userType: feedback.userType as 'CLIENT' | 'CREATOR',
      rating: feedback.rating,
      feedback: feedback.feedback ?? undefined,
      deviceType: feedback.deviceType ?? undefined,
      os: feedback.os ?? undefined,
      browser: feedback.browser ?? undefined,
      timestamp: dayjs(feedback.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    }));

    // Batch sync to Lark
    const result = await batchSyncNpsFeedbackToLark(feedbackData);

    console.log('\n📊 Sync Summary:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   ❌ Failed: ${result.failed}`);
    console.log(`   📈 Total: ${feedbacks.length}`);

    if (result.success === feedbacks.length) {
      console.log('\n🎉 All feedback synced successfully!');
    } else if (result.success > 0) {
      console.log('\n⚠️  Some feedback failed to sync. Check logs above for details.');
    } else {
      console.log('\n❌ All feedback failed to sync. Please check your Lark configuration.');
    }
  } catch (error) {
    console.error('❌ Error syncing feedback:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Run the sync
syncExistingFeedback();
