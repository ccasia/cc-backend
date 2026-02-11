import { uploadAttachments, uploadImage } from '@configs/cloudStorage.config';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { createNewSpreadSheet } from './google_sheets/sheets';

const prisma = new PrismaClient();

// `req` is for the admin ID
export const logChange = async (message: string, campaignId: string, req: Request | undefined, id?: string, metadata?: Record<string, any>) => {
  const adminId = req?.session.userid || id;

  if (adminId === undefined) {
    throw new Error('Admin ID is undefined');
  }

  try {
    await prisma.campaignLog.create({
      data: {
        message: message,
        campaignId: campaignId,
        adminId: adminId,
        ...(metadata && { metadata }),
      },
    });
  } catch (error) {
    return error;
  }
};

export const logAdminChange = async (message: string, adminId: string, req: Request) => {
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
    if (!campaign.campaignCredits) throw new Error('Campaign credits not found');

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

    const data = await tx.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        creditsUtilized: {
          increment: creditsToDeduct,
        },
        creditsPending: {
          decrement: creditsToDeduct,
        },
      },
    });

    // Allow negative creditsPending for backwards compatibility with campaigns
    // that already had credits deducted when agreements were sent
    if (data.creditsPending && data.creditsPending < 0) {
      console.warn(
        `⚠️  Campaign ${campaignId} has negative creditsPending: ${data.creditsPending} (backwards compatibility)`,
      );
    }

    // NOTE: Do NOT update subscription.creditsUsed here.
    // Subscription credits are already deducted when the campaign is created.
    // We're only managing within-campaign allocation (creditsUtilized vs creditsPending).
    // Updating subscription here would double-count credits.
  } catch (error) {
    throw new Error(error);
  }
};

export async function uploadCampaignAssets(files: any) {
  const imageTasks: Promise<string>[] = [];
  const attachmentTasks: Promise<string>[] = [];

  if (files?.campaignImages) {
    const imgs = Array.isArray(files.campaignImages) ? files.campaignImages : [files.campaignImages];

    imgs.forEach((img: any) => imageTasks.push(uploadImage(img.tempFilePath, img.name, 'campaign')));
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