import { Prisma } from '@prisma/client';
import { csShortlistCreators, CreatorProfile } from '@configs/nodemailer.config';

type PrismaTransactionClient = Prisma.TransactionClient;

export interface ShortlistedCreatorInput {
  id: string;
  name: string | null;
  photoURL: string | null;
  username?: string | null;
  followerCount?: number;
  engagementRate?: number;
}

const formatFollowers = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

export const sendShortlistEmailToClients = async (
  campaignId: string,
  shortlistedCreators: ShortlistedCreatorInput[],
  tx: PrismaTransactionClient,
) => {
  try {
    console.log(`Starting notification process for campaign ${campaignId}`);

    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: {
        campaignAdmin: {
          where: {
            admin: {
              user: {
                role: 'client',
              },
            },
          },
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!campaign || campaign.campaignAdmin.length === 0) {
      console.log('No client admins found for this campaign. Skipping email notification.');
      return;
    }

    const creatorProfilesForEmail: CreatorProfile[] = shortlistedCreators.map((creator) => ({
      profilePicUrl: creator.photoURL || '/default-avatar.png',
      name: creator.name || 'N/A',
      instagramHandle: creator.username || 'N/A',
      followers: formatFollowers(creator.followerCount || 0),
      engagement: `${(creator.engagementRate || 0).toFixed(2)}%`,
    }));

    for (const campaignAdmin of campaign.campaignAdmin) {
      const clientUser = campaignAdmin.admin.user;
      if (clientUser?.email) {
        console.log(`Sending new shortlist email to client: ${clientUser.email}`);

        await csShortlistCreators(
          clientUser.email,
          clientUser.name || 'Valued Client',
          creatorProfilesForEmail.length,
          creatorProfilesForEmail,
          campaign.id,
        );
      }
    }
  } catch (error) {
    console.error('Error in sendShorlistEmailToClients', error);
    throw new Error('Failed to send email notifications.');
  }
};
