import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration
const BATCH_SIZE = 100;
const CURRENT_BATCH = parseInt(process.argv[2]) || 1;
const DRY_RUN = process.argv.includes('--dry-run');

// Helper function to identify test users by email pattern
const getTestUserIds = async (limit: number, offset: number) => {
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'testuser' } },
        { email: { contains: '@example.com' } },
        { email: { contains: 'test_' } },
      ],
      role: 'creator'
    },
    select: { id: true, email: true, name: true },
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'asc' }
  });
  
  return testUsers;
};

// Get total count of test users
const getTotalTestUsers = async () => {
  return await prisma.user.count({
    where: {
      OR: [
        { email: { contains: 'testuser' } },
        { email: { contains: '@example.com' } },
        { email: { contains: 'test_' } },
      ],
      role: 'creator'
    }
  });
};

async function cleanupTestUsers(batchNumber: number, dryRun: boolean = false) {
  const offset = (batchNumber - 1) * BATCH_SIZE;
  
  console.log(`${dryRun ? '🔍 DRY RUN -' : '🧹'} Starting cleanup batch ${batchNumber} (${BATCH_SIZE} users)...`);
  
  // Get test users for this batch
  const testUsers = await getTestUserIds(BATCH_SIZE, offset);
  
  if (testUsers.length === 0) {
    console.log('✅ No more test users found to clean up.');
    return { deleted: 0, remaining: 0 };
  }
  
  console.log(`Found ${testUsers.length} test users in this batch`);
  
  if (dryRun) {
    console.log('📋 Users that would be deleted:');
    testUsers.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.email} (${user.name}) - ID: ${user.id}`);
    });
    
    const totalRemaining = await getTotalTestUsers();
    return { deleted: 0, remaining: totalRemaining };
  }
  
  const userIds = testUsers.map(user => user.id);
  let deletedCount = 0;
  
  // Process users in smaller chunks to avoid transaction timeouts
  const CHUNK_SIZE = 10;
  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    
    try {
      await prisma.$transaction(async (tx) => {
        console.log(`🗑️  Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(userIds.length / CHUNK_SIZE)}...`);
        
        // Get creator IDs for this chunk
        const creators = await tx.creator.findMany({
          where: { userId: { in: chunk } },
          select: { id: true, userId: true }
        });
        
        const creatorIds = creators.map(c => c.id);
        
        if (creatorIds.length > 0) {
          // Delete Instagram videos first
          const instagramUsers = await tx.instagramUser.findMany({
            where: { creatorId: { in: creatorIds } },
            select: { id: true }
          });
          
          if (instagramUsers.length > 0) {
            const instagramUserIds = instagramUsers.map(u => u.id);
            await tx.instagramVideo.deleteMany({
              where: { instagramUserId: { in: instagramUserIds } }
            });
            console.log(`    ❌ Deleted Instagram videos for ${instagramUsers.length} Instagram users`);
          }
          
          // Delete TikTok videos first
          const tiktokUsers = await tx.tiktokUser.findMany({
            where: { creatorId: { in: creatorIds } },
            select: { id: true }
          });
          
          if (tiktokUsers.length > 0) {
            const tiktokUserIds = tiktokUsers.map(u => u.id);
            await tx.tiktokVideo.deleteMany({
              where: { tiktokUserId: { in: tiktokUserIds } }
            });
            console.log(`    ❌ Deleted TikTok videos for ${tiktokUsers.length} TikTok users`);
          }
          
          // Delete Instagram users
          await tx.instagramUser.deleteMany({
            where: { creatorId: { in: creatorIds } }
          });
          
          // Delete TikTok users
          await tx.tiktokUser.deleteMany({
            where: { creatorId: { in: creatorIds } }
          });
          
          // Delete media kits
          await tx.mediaKit.deleteMany({
            where: { creatorId: { in: creatorIds } }
          });
          
          // Delete interests
          await tx.interest.deleteMany({
            where: { userId: { in: chunk } }
          });
          
          console.log(`    ❌ Deleted social media data and interests for ${creatorIds.length} creators`);
        }
        
        // Delete payment forms
        await tx.paymentForm.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete reset password tokens
        await tx.resetPasswordToken.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete user notifications
        await tx.userNotification.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete seen messages
        await tx.seenMessage.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete unread messages
        await tx.unreadMessage.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete user threads
        await tx.userThread.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete task assignees
        await tx.taskAssignee.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete campaign task admin assignments
        await tx.campaignTaskAdmin.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete shortlisted creators
        await tx.shortListedCreator.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete pitches
        await tx.pitch.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete bookmark campaigns
        await tx.bookMarkCampaign.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete campaign logs
        await tx.campaignLog.deleteMany({
          where: { adminId: { in: chunk } }
        });
        
        // Delete feedback
        await tx.feedback.deleteMany({
          where: { adminId: { in: chunk } }
        });
        
        // Delete submissions and related data
        const submissions = await tx.submission.findMany({
          where: { userId: { in: chunk } },
          select: { id: true }
        });
        
        if (submissions.length > 0) {
          const submissionIds = submissions.map(s => s.id);
          
          // Delete public feedback
          await tx.publicFeedback.deleteMany({
            where: { submissionId: { in: submissionIds } }
          });
          
          // Delete submission dependencies
          await tx.submissionDependency.deleteMany({
            where: {
              OR: [
                { submissionId: { in: submissionIds } },
                { dependentSubmissionId: { in: submissionIds } }
              ]
            }
          });
          
          // Delete videos, raw footage, and photos
          await tx.video.deleteMany({
            where: { userId: { in: chunk } }
          });
          
          await tx.rawFootage.deleteMany({
            where: { userId: { in: chunk } }
          });
          
          await tx.photo.deleteMany({
            where: { userId: { in: chunk } }
          });
          
          console.log(`    ❌ Deleted submissions and related media for ${submissions.length} submissions`);
        }
        
        // Delete submissions
        await tx.submission.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete creator agreements
        await tx.creatorAgreement.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete invoices (as creator)
        await tx.invoice.deleteMany({
          where: { creatorId: { in: chunk } }
        });
        
        // Delete invoices (as admin who created)
        await tx.invoice.deleteMany({
          where: { adminId: { in: chunk } }
        });
        
        // Delete logistics
        await tx.logistic.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete bugs
        await tx.bugs.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete agreement templates
        await tx.agreementTemplate.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete messages sent by users
        await tx.message.deleteMany({
          where: { senderId: { in: chunk } }
        });
        
        // Delete boards and related data
        const boards = await tx.board.findMany({
          where: { userId: { in: chunk } },
          select: { id: true }
        });
        
        if (boards.length > 0) {
          const boardIds = boards.map(b => b.id);
          
          // Get columns
          const columns = await tx.columns.findMany({
            where: { boardId: { in: boardIds } },
            select: { id: true }
          });
          
          if (columns.length > 0) {
            const columnIds = columns.map(c => c.id);
            
            // Delete task assignees for tasks in these columns
            const tasks = await tx.task.findMany({
              where: { columnId: { in: columnIds } },
              select: { id: true }
            });
            
            if (tasks.length > 0) {
              const taskIds = tasks.map(t => t.id);
              await tx.taskAssignee.deleteMany({
                where: { taskId: { in: taskIds } }
              });
            }
            
            // Delete tasks
            await tx.task.deleteMany({
              where: { columnId: { in: columnIds } }
            });
            
            // Delete columns
            await tx.columns.deleteMany({
              where: { boardId: { in: boardIds } }
            });
          }
          
          // Delete boards
          await tx.board.deleteMany({
            where: { userId: { in: chunk } }
          });
        }
        
        // Delete creators (this will cascade to related data due to foreign key constraints)
        await tx.creator.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete clients
        await tx.client.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete admin records
        await tx.admin.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Delete finance records
        await tx.finance.deleteMany({
          where: { userId: { in: chunk } }
        });
        
        // Finally, delete the users
        const deletedUsers = await tx.user.deleteMany({
          where: { id: { in: chunk } }
        });
        
        deletedCount += deletedUsers.count;
        console.log(`    ✅ Deleted ${deletedUsers.count} users from this chunk`);
      });
      
    } catch (error) {
      console.error(`❌ Error processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}:`, error);
      throw error;
    }
  }
  
  console.log(`🎉 Batch ${batchNumber} completed! Deleted ${deletedCount} users.`);
  
  const totalRemaining = await getTotalTestUsers();
  return { deleted: deletedCount, remaining: totalRemaining };
}

async function main() {
  try {
    console.log(`🧹 Test User Cleanup Script - Batch ${CURRENT_BATCH}`);
    console.log(`📊 This will clean up ${BATCH_SIZE} test users per batch`);
    
    if (DRY_RUN) {
      console.log('🔍 DRY RUN MODE - No data will be deleted');
    }
    
    // Check if we're in development environment
    if (process.env.NODE_ENV === 'production' && !DRY_RUN) {
      throw new Error('🚫 This script should not be run in production without --dry-run flag!');
    }
    
    // Get initial count
    const totalTestUsers = await getTotalTestUsers();
    console.log(`📈 Found ${totalTestUsers} test users total`);
    
    if (totalTestUsers === 0) {
      console.log('✅ No test users found to clean up.');
      return;
    }
    
    const result = await cleanupTestUsers(CURRENT_BATCH, DRY_RUN);
    
    // Show statistics
    console.log('\n📊 Cleanup Results:');
    console.log(`Users deleted in this batch: ${result.deleted}`);
    console.log(`Total test users remaining: ${result.remaining}`);
    
    if (result.remaining > 0 && !DRY_RUN) {
      const nextBatch = CURRENT_BATCH + 1;
      console.log(`\n🔄 To clean up the next batch, run:`);
      console.log(`npx ts-node cleanup-test-users.ts ${nextBatch}`);
    } else if (result.remaining === 0 && !DRY_RUN) {
      console.log(`\n🏁 All test users have been cleaned up!`);
    }
    
    if (DRY_RUN) {
      console.log(`\n💡 To actually delete these users, run without --dry-run:`);
      console.log(`npx ts-node cleanup-test-users.ts ${CURRENT_BATCH}`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle script execution
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());