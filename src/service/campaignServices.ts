import { uploadAttachments, uploadImage } from '@configs/cloudStorage.config';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { createNewSpreadSheet } from './google_sheets/sheets';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { getEffectiveCampaignOrigin } from '@utils/campaignFlow';

const prisma = new PrismaClient();

/**
 * Fallback for when the last client is detached from a campaign mid-flight.
 *
 * Pitches, submissions, and content items sitting in SENT_TO_CLIENT / CLIENT_FEEDBACK
 * would be stranded — nobody is left to act on them. Return them to admin review so
 * the flow can continue without a client (admin approval is then final).
 *
 * Safe to call after any campaign-manager update: it re-checks client presence itself
 * and is a no-op when a client is still attached. See docs/v4-unification-plan.md (Phase 5).
 */
export const revertStrandedClientReviewItems = async (campaignId: string, adminId?: string) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      campaignAdmin: {
        include: {
          admin: {
            include: {
              user: { select: { role: true } },
              role: true,
            },
          },
        },
      },
    },
  });

  // No-op while the campaign's flow still routes to a client — including CLIENT-origin
  // campaigns, whose approvals go to client review even without client campaign admins.
  // Reverting those would ping-pong items between admin and client review.
  if (!campaign || getEffectiveCampaignOrigin(campaign) === 'CLIENT') {
    return { reverted: false, total: 0 };
  }

  const clientReviewStatuses = ['SENT_TO_CLIENT', 'CLIENT_FEEDBACK'] as const;

  const revertedPitches = await prisma.pitch.updateMany({
    where: { campaignId, status: 'SENT_TO_CLIENT' },
    data: { status: 'PENDING_REVIEW' },
  });

  const revertedSubmissions = await prisma.submission.updateMany({
    where: { campaignId, status: { in: [...clientReviewStatuses] } },
    data: { status: 'PENDING_REVIEW' },
  });

  // Individual content items reviewed at the video/photo/raw-footage level.
  // PENDING is the FeedbackStatus for "awaiting admin decision".
  const [revertedVideos, revertedPhotos, revertedRawFootages] = await Promise.all([
    prisma.video.updateMany({
      where: { campaignId, status: { in: [...clientReviewStatuses] } },
      data: { status: 'PENDING' },
    }),
    prisma.photo.updateMany({
      where: { campaignId, status: { in: [...clientReviewStatuses] } },
      data: { status: 'PENDING' },
    }),
    prisma.rawFootage.updateMany({
      where: { campaignId, status: { in: [...clientReviewStatuses] } },
      data: { status: 'PENDING' },
    }),
  ]);

  const total =
    revertedPitches.count +
    revertedSubmissions.count +
    revertedVideos.count +
    revertedPhotos.count +
    revertedRawFootages.count;

  if (total > 0) {
    await prisma.campaignLog.create({
      data: {
        message: `Client removed from campaign — ${revertedPitches.count} pitch(es) and ${revertedSubmissions.count} submission(s) awaiting client review were returned to admin review`,
        campaignId,
        ...(adminId && { adminId }),
      },
    });
    console.log(
      `Campaign ${campaignId}: client detached, reverted ${total} item(s) from client review to admin review`,
    );
  }

  return { reverted: total > 0, total };
};

// `req` is for the admin ID
export const logChange = async (
  message: string,
  campaignId: string,
  req: Request | undefined,
  id?: string,
  metadata?: Record<string, any>,
) => {
  const adminId = req?.session.userid || id;

  try {
    await prisma.campaignLog.create({
      data: {
        message: message,
        campaignId: campaignId,
        ...(adminId && { adminId }),
        ...(metadata && { metadata }),
      },
    });
  } catch (error) {
    return error;
  }
};

export const logAdminChange = async (message: string, adminId?: string, req?: Request) => {
  if (adminId === undefined) {
    throw new Error('Admin ID is undefined');
  }

  try {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });

    if (!admin) {
      throw new Error('Admin not found');
    }

    await prisma.adminLog.create({
      data: {
        message: `${message}`,
        adminId: adminId,
        performedBy: admin.name,
      },
    });
  } catch (error) {
    return error;
  }
};

export const deductCredits = async (campaignId: string, userId: string, prismaFunc?: PrismaClient) => {
  try {
    const tx = prismaFunc ?? prisma;
    // return await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        brand: {
          select: {
            company: {
              select: {
                subscriptions: {
                  where: {
                    status: 'ACTIVE',
                  },
                },
              },
            },
          },
        },
        company: {
          select: {
            id: true,
            subscriptions: {
              where: {
                status: 'ACTIVE',
              },
            },
          },
        },
        shortlisted: true,
      },
    });

    const user = await tx.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!campaign || !user) throw new Error('Data not found');
    if (campaign.campaignCredits == null) throw new Error('Campaign credits not found');

    // For v4 campaigns, credits are already deducted when agreement is sent
    // Skip credit deduction to avoid double-counting
    if (campaign.submissionVersion === 'v4') {
      console.log(`⏭️  Skipping credit deduction for v4 campaign ${campaignId}`);
      return;
    }

    if (!(campaign?.company?.subscriptions?.length || campaign?.brand?.company?.subscriptions?.length))
      throw new Error('Company not linked to a package');

    const subscription = campaign?.company?.subscriptions[0] || campaign.brand?.company.subscriptions[0];

    const submission = await tx.submission.findMany({
      where: {
        campaignId,
        userId,
        status: 'APPROVED',
      },
      include: {
        video: true,
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    // Get shortlisted creator data for credit calculation
    const shortlistedCreator = campaign.shortlisted.find((x) => x.userId === userId);
    const ugcVideos = shortlistedCreator?.ugcVideos ?? 0;

    // Calculate credits to deduct based on campaign type
    let creditsToDeduct: number;
    if (campaign.isCreditTier && shortlistedCreator?.creditPerVideo) {
      // Credit tier campaign: multiply videos by creditPerVideo from tier snapshot
      creditsToDeduct = ugcVideos * shortlistedCreator.creditPerVideo;
    } else {
      // Non-tier campaign: 1 credit per video (legacy behavior)
      creditsToDeduct = ugcVideos;
    }

    // Read-clamp-write so creditsPending floors at 0 instead of going negative.
    // Negative pending used to leak through when an agreement-time deduction had already
    // moved credits — clamping here keeps the invariant creditsUtilized + creditsPending ≥ 0.
    const currentCounters = await tx.campaign.findUnique({
      where: { id: campaign.id },
      select: { creditsUtilized: true, creditsPending: true },
    });
    const currentPending = currentCounters?.creditsPending ?? 0;
    const currentUtilized = currentCounters?.creditsUtilized ?? 0;
    const newPending = currentPending - creditsToDeduct;

    if (newPending < 0) {
      console.warn(
        `⚠️  Campaign ${campaignId} deduction of ${creditsToDeduct} exceeded pending ${currentPending}; clamping to 0`,
      );
    }

    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        creditsUtilized: currentUtilized + creditsToDeduct,
        creditsPending: Math.max(0, newPending),
      },
    });

    // NOTE: Do NOT update subscription.creditsUsed here.
    // Subscription credits are already deducted when the campaign is created.
    // We're only managing within-campaign allocation (creditsUtilized vs creditsPending).
    // Updating subscription here would double-count credits.
  } catch (error) {
    throw new Error(error);
  }
};

/**
 * Internal helper to reject a pending pitch and clean up all related records
 * Used by both changePitchStatus endpoint and closeCampaign function
 * Does NOT handle credit refunds - caller must manage credits separately
 *
 * @param userId Creator user ID
 * @param campaignId Campaign ID
 * @param pitchId Pitch ID
 * @param prismaFunc Optional Prisma transaction client
 * @returns Object with success status and refunded credits (ugcVideos count)
 */
export async function rejectPendingPitchInternal(
  userId: string,
  campaignId: string,
  pitchId: string,
  prismaFunc?: PrismaClient,
) {
  try {
    const tx = prismaFunc ?? prisma;

    // Step 1: Update pitch status to rejected
    const pitch = await tx.pitch.update({
      where: { id: pitchId },
      data: { status: 'rejected' },
      include: {
        campaign: { include: { campaignBrief: true } },
      },
    });

    // Step 2: Delete ShortListedCreator
    const shortList = await tx.shortListedCreator.findUnique({
      where: {
        userId_campaignId: { userId, campaignId },
      },
    });

    const refundedCredits = shortList?.ugcVideos ?? 0;

    if (shortList) {
      await tx.shortListedCreator.delete({
        where: {
          userId_campaignId: { userId, campaignId },
        },
      });
    }

    // Step 3: Delete all submissions for user in this campaign
    await tx.submission.deleteMany({
      where: {
        AND: [{ campaignId }, { userId }],
      },
    });

    // Step 4: Delete all tasks from user's board
    const board = await tx.board.findUnique({
      where: { userId },
      include: {
        columns: {
          include: { task: true },
        },
      },
    });

    if (board) {
      await tx.task.deleteMany({
        where: {
          column: { boardId: board.id },
        },
      });
    }

    // Step 5: Delete creator agreement
    const agreement = await tx.creatorAgreement.findFirst({
      where: {
        AND: [{ userId }, { campaignId }],
      },
    });

    if (agreement) {
      await tx.creatorAgreement.delete({
        where: { id: agreement.id },
      });
    }

    return {
      success: true,
      refundedCredits,
    };
  } catch (error) {
    throw new Error(`Failed to reject pitch: ${error}`);
  }
}

export async function uploadCampaignAssets(files: any) {
  const imageTasks: Promise<string>[] = [];
  const attachmentTasks: Promise<string>[] = [];

  if (files?.campaignImages) {
    const imgs = Array.isArray(files.campaignImages) ? files.campaignImages : [files.campaignImages];

    imgs.forEach((img: any) => imageTasks.push(uploadImage(img.tempFilePath, `${Date.now()}_${img.name}`, 'campaign')));
  }

  if (files?.otherAttachments) {
    const atts = Array.isArray(files.otherAttachments) ? files.otherAttachments : [files.otherAttachments];

    atts.forEach((file: any) =>
      attachmentTasks.push(
        uploadAttachments({
          tempFilePath: file.tempFilePath,
          fileName: file.name,
          folderName: 'otherAttachments',
        }),
      ),
    );
  }

  const [images, attachments] = await Promise.all([Promise.all(imageTasks), Promise.all(attachmentTasks)]);

  return { images, attachments };
}

export async function createNewSpreadSheetAsync({ title, campaignId }: { title: string; campaignId: string }) {
  setImmediate(async () => {
    try {
      const url = await createNewSpreadSheet({ title });

      /** Update campaign AFTER creation */
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { spreadSheetURL: url },
      });
    } catch (error) {
      console.error('Spreadsheet creation failed:', error);
    }
  });
}

export const generateCampaignMasterListSheet = async (campaignId: string): Promise<string> => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      shortlisted: {
        include: {
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!campaign) throw new Error('Campaign not found');

  const creators = campaign.shortlisted;
  const numCreators = creators.length;
  const totalCost = creators.reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const creditsUsed = campaign.creditsUtilized ?? 0;
  const creditsTotal = campaign.campaignCredits ?? 0;

  const client = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
  });

  const doc = await GoogleSpreadsheet.createNewSpreadsheetDocument(client, {
    title: `${campaign.name} - Master List`,
  });

  const sheet = doc.sheetsByIndex[0];
  await sheet.updateProperties({ title: 'Master List' });

  // Layout:
  //   Row 0  — Title bar (campaign name)
  //   Row 1  — blank
  //   Row 2  — Summary headers
  //   Row 3  — Summary values
  //   Row 4  — blank
  //   Row 5  — Creator table headers
  //   Row 6+ — Creator rows
  const COLS = 3;
  const CREATOR_START = 6;
  const totalRows = CREATOR_START + Math.max(numCreators, 1);

  await sheet.loadCells({ startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: COLS });

  interface RGB {
    red: number;
    green: number;
    blue: number;
  }

  const DARK_BLUE: RGB = { red: 0.122, green: 0.306, blue: 0.475 }; // #1F4E79
  const MID_BLUE: RGB = { red: 0.18, green: 0.459, blue: 0.714 }; // #2E75B6
  const LIGHT_BLUE: RGB = { red: 0.839, green: 0.894, blue: 0.941 }; // #D6E4F0
  const DARK_GREEN: RGB = { red: 0.216, green: 0.337, blue: 0.137 }; // #375623
  const LIGHT_GREEN: RGB = { red: 0.886, green: 0.937, blue: 0.855 }; // #E2EFDA
  const WHITE: RGB = { red: 1, green: 1, blue: 1 };
  const NEAR_BLACK: RGB = { red: 0.1, green: 0.1, blue: 0.1 };

  const paint = (
    row: number,
    col: number,
    value: string | number,
    bg: RGB,
    fg: RGB,
    opts: {
      bold?: boolean;
      align?: 'LEFT' | 'CENTER' | 'RIGHT';
      currency?: boolean;
    } = {},
  ) => {
    const cell = sheet.getCell(row, col);
    cell.value = value;
    cell.backgroundColor = bg;
    cell.textFormat = { bold: opts.bold ?? false, foregroundColor: fg };
    cell.horizontalAlignment = opts.align ?? 'CENTER';
    cell.verticalAlignment = 'MIDDLE';
    if (opts.currency) cell.numberFormat = { type: 'CURRENCY', pattern: '"RM "#,##0.00' };
  };

  // Row 0 — Title
  paint(0, 0, campaign.name, DARK_BLUE, WHITE, { bold: true, align: 'LEFT' });
  paint(0, 1, '', DARK_BLUE, WHITE);
  paint(0, 2, '', DARK_BLUE, WHITE);

  // Row 2 — Summary headers
  paint(2, 0, 'No. of Creators', MID_BLUE, WHITE, { bold: true });
  paint(2, 1, 'Credits Utilized', MID_BLUE, WHITE, { bold: true });
  paint(2, 2, 'Total Spend', MID_BLUE, WHITE, { bold: true });

  // Row 3 — Summary values
  paint(3, 0, numCreators, LIGHT_BLUE, NEAR_BLACK);
  paint(3, 1, `${creditsUsed} / ${creditsTotal}`, LIGHT_BLUE, NEAR_BLACK);
  paint(3, 2, totalCost, LIGHT_BLUE, NEAR_BLACK, { currency: true });

  // Row 5 — Creator table headers
  paint(5, 0, 'Creator Name', DARK_GREEN, WHITE, { bold: true, align: 'LEFT' });
  paint(5, 1, 'Email', DARK_GREEN, WHITE, { bold: true, align: 'LEFT' });
  paint(5, 2, 'Price (RM)', DARK_GREEN, WHITE, { bold: true, align: 'RIGHT' });

  // Rows 6+ — Creator rows (alternating white / light green)
  creators.forEach((c, i) => {
    const row = CREATOR_START + i;
    const rowBg = i % 2 === 0 ? WHITE : LIGHT_GREEN;
    paint(row, 0, c.user?.name ?? '', rowBg, NEAR_BLACK, { align: 'LEFT' });
    paint(row, 1, c.user?.email ?? '', rowBg, NEAR_BLACK, { align: 'LEFT' });
    paint(row, 2, c.amount ?? 0, rowBg, NEAR_BLACK, { align: 'RIGHT', currency: true });
  });

  await sheet.saveUpdatedCells();

  const sheetsApi = google.sheets({ version: 'v4', auth: client });
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: doc.spreadsheetId,
    requestBody: {
      requests: [
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: sheet.sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: COLS,
            },
          },
        },
      ],
    },
  });

  await doc.share('afiq@cultcreative.asia');
  await doc.share('atiq@cultcreative.asia');

  return `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/`;
};
