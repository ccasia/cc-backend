import { PrismaClient } from '@prisma/client';
import { extractWithRetry, ExtractedUrlData } from '@utils/urlExtractor';
import { resolveTikTokShortCode } from '@services/socialMediaService';

const prisma = new PrismaClient();

/**
 * Extract and store posting URLs from Submission.content field
 * Handles Instagram and TikTok URLs, stores in SubmissionPostingUrl table
 */
export async function extractAndStoreSubmissionUrls(
  submissionId: string,
  content: string
): Promise<{ success: number; failed: number; invalid: number }> {
  console.log(`📝 Extracting URLs from submission ${submissionId}...`);

  // 1. Find all URLs in content (basic regex for http/https URLs)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const rawUrls = content.match(urlRegex) || [];

  if (rawUrls.length === 0) {
    console.log(`ℹ️  No URLs found in submission ${submissionId}`);
    return { success: 0, failed: 0, invalid: 0 };
  }

  console.log(`🔍 Found ${rawUrls.length} URL(s) in content`);

  const validUrls: ExtractedUrlData[] = [];
  const invalidUrls: { url: string; reason: string }[] = [];
  let failedCount = 0;

  // 2. Validate each URL
  for (const rawUrl of rawUrls) {
    const extracted = await extractWithRetry(rawUrl);

    if (extracted.isValid && extracted.platform) {
      validUrls.push(extracted);
      console.log(`✅ Valid ${extracted.platform} ${extracted.type}: ${rawUrl}`);
    } else {
      invalidUrls.push({ url: rawUrl, reason: extracted.reason || 'Unknown' });
      console.warn(`⚠️  Invalid URL: ${rawUrl} - ${extracted.reason}`);
    }
  }

  // 3. Get campaign ID for this submission
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { campaignId: true },
  });

  if (!submission) {
    console.error(`❌ Submission ${submissionId} not found`);
    return { success: 0, failed: rawUrls.length, invalid: 0 };
  }

  // 4. Store valid URLs (with TikTok short code resolution)
  for (const extracted of validUrls) {
    try {
      let finalMediaId = extracted.mediaId;

      // Resolve TikTok short codes to full video IDs immediately
      if (extracted.platform === 'TikTok' && extracted.shortCode && !extracted.mediaId) {
        console.log(`🔗 Attempting to resolve TikTok short code: ${extracted.shortCode}`);
        try {
          finalMediaId = await resolveTikTokShortCode(extracted.shortCode);
          console.log(`✅ Resolved TikTok short code to video ID: ${finalMediaId}`);
        } catch (error: any) {
          console.warn(
            `⚠️  Failed to resolve TikTok short code ${extracted.shortCode}, will use short code as fallback:`,
            error.message
          );
          // Keep using short code if resolution fails - the API will handle it
          finalMediaId = extracted.shortCode;
        }
      }

      await prisma.submissionPostingUrl.upsert({
        where: {
          submissionId_platform_postUrl: {
            submissionId,
            platform: extracted.platform!,
            postUrl: extracted.postUrl,
          },
        },
        create: {
          submissionId,
          campaignId: submission.campaignId,
          platform: extracted.platform!,
          postUrl: extracted.postUrl,
          shortCode: extracted.shortCode,
          mediaId: finalMediaId,
          postingDate: new Date(), // Assume posted if URL exists
        },
        update: {
          shortCode: extracted.shortCode,
          mediaId: finalMediaId,
          postingDate: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(
        `💾 Stored ${extracted.platform} URL for submission ${submissionId} (mediaId: ${finalMediaId})`
      );
    } catch (error: any) {
      console.error(`❌ Failed to store URL ${extracted.postUrl}:`, error.message);
      failedCount++;
    }
  }

  console.log(
    `✨ Summary: ${validUrls.length} stored, ${invalidUrls.length} invalid, ${failedCount} failed`
  );

  return {
    success: validUrls.length - failedCount,
    failed: failedCount,
    invalid: invalidUrls.length,
  };
}

/**
 * Get all posting URLs for a specific submission
 */
export async function getSubmissionUrls(submissionId: string) {
  return prisma.submissionPostingUrl.findMany({
    where: { submissionId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get all posting URLs for a campaign (optionally filtered by platform)
 * Only returns URLs that have been posted (postingDate is not null)
 */
export async function getCampaignSubmissionUrls(
  campaignId: string,
  platform?: 'Instagram' | 'TikTok'
) {
  return prisma.submissionPostingUrl.findMany({
    where: {
      campaignId,
      platform: platform || undefined,
      postingDate: { not: null }, // Only posted URLs
    },
    include: {
      submission: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { postingDate: 'desc' },
  });
}

/**
 * Mark a URL as posted (update postingDate)
 */
export async function markUrlAsPosted(urlId: string, postingDate?: Date) {
  return prisma.submissionPostingUrl.update({
    where: { id: urlId },
    data: {
      postingDate: postingDate || new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Backfill URLs from all existing submissions with content
 * Returns stats on how many submissions were processed
 */
export async function backfillAllSubmissionUrls(campaignId?: string) {
  console.log('🚀 Starting backfill of submission URLs...');

  const whereClause: any = {
    content: { not: null },
    status: { in: ['POSTED', 'APPROVED', 'COMPLETED'] },
  };

  if (campaignId) {
    whereClause.campaignId = campaignId;
  }

  const submissions = await prisma.submission.findMany({
    where: whereClause,
    select: {
      id: true,
      content: true,
      campaignId: true,
      userId: true,
      status: true,
    },
  });

  console.log(`📊 Found ${submissions.length} submissions with content`);

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalInvalid = 0;
  let processedCount = 0;

  for (const submission of submissions) {
    try {
      const result = await extractAndStoreSubmissionUrls(submission.id, submission.content!);
      totalSuccess += result.success;
      totalFailed += result.failed;
      totalInvalid += result.invalid;
      processedCount++;

      // Small delay to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error: any) {
      console.error(`❌ Error processing submission ${submission.id}:`, error.message);
      totalFailed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`📝 Processed: ${processedCount}/${submissions.length} submissions`);
  console.log(`✅ Successfully stored: ${totalSuccess} URLs`);
  console.log(`⚠️  Invalid URLs: ${totalInvalid}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log('='.repeat(60) + '\n');

  return {
    processed: processedCount,
    total: submissions.length,
    success: totalSuccess,
    invalid: totalInvalid,
    failed: totalFailed,
  };
}
