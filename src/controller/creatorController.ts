import { Request, Response } from 'express';
import https from 'https';
import { Entity, PrismaClient } from '@prisma/client';
import { uploadAgreementForm, uploadProfileImage } from '@configs/cloudStorage.config';
import { Title, saveNotification } from './notificationController';
import { clients, io } from '../server';
import { updateInvoices } from '@services/invoiceService';
import { exportCreatorsToSpreadsheet } from '@services/creatorsSpreadsheetService';
import { createKanbanBoard } from './kanbanController';
import { createCampaignCreatorSpreadSheet } from '@services/google_sheets/sheets';
import {
  getInstagramEngagementRateOverTime,
  getInstagramMonthlyInteractions,
  getTikTokEngagementRateOverTime,
  getTikTokMonthlyInteractions,
} from '@services/socialMediaService';
import { decryptToken } from '@helper/encrypt';

const prisma = new PrismaClient();

type SocialMediaData = Record<
  string,
  {
    data?: {
      followers?: number;
      engagement_rate?: number;
      user_performance?: {
        avg_likes_per_post?: number;
      };
      top_contents?: any[];
    };
  }
>;

export const getCreators = async (_req: Request, res: Response) => {
  try {
    const creators = await prisma.user.findMany({
      where: {
        role: 'creator',
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        photoURL: true,
        photoBackgroundURL: true,
        country: true,
        status: true,
        email: true,
        role: true,
        creator: {
          include: {
            instagramUser: {
              include: {
                instagramVideo: true,
              },
            },
            tiktokUser: {
              include: {
                tiktokVideo: true,
              },
            },
          },
        },
        shortlisted: true,
      },
    });

    return res.status(200).json(creators);
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: error });
  }
};

export const getCreatorByID = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const creator = await prisma.user.findFirst({
      where: {
        creator: {
          id: id,
        },
      },
      include: {
        creator: {
          include: {
            interests: true,
            mediaKit: true,
            instagramUser: {
              include: { instagramVideo: true },
            },
            tiktokUser: {
              include: {
                tiktokVideo: true,
              },
            },
          },
        },
      },
    });

    if (!creator) return res.status(404).json({ message: 'Creator not found' });

    return res.status(200).json(creator);
  } catch (error) {
    return res.status(400).json({ error });
  }
};

export const deleteCreator = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const deleteCreator = await prisma.$transaction([
      prisma.interest.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.invoice.deleteMany({
        where: {
          creatorId: id,
        },
      }),

      prisma.pitch.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.userNotification.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.notification.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.unreadMessage.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.seenMessage.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.bookMarkCampaign.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.paymentForm.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.userThread.deleteMany({
        where: { userId: id },
      }),

      prisma.creatorAgreement.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.submission.deleteMany({
        where: { userId: id },
      }),

      prisma.logistic.deleteMany({
        where: {
          userId: id,
        },
      }),

      prisma.creator.delete({
        where: {
          userId: id,
        },
        include: {
          mediaKit: true,
        },
      }),

      prisma.user.delete({
        where: {
          id: id,
        },
      }),
    ]);

    res.status(200).json('Creator deleted successfully');
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: error });
  }
};

export const updateCreator = async (req: Request, res: Response) => {
  const data = req.body;
  try {
    await prisma.creator.update({
      where: {
        userId: data.id,
      },
      data: {
        user: {
          update: {
            name: data.name,
            status: data.status,
            country: data.country,
          },
        },
        instagram: data?.instagram,
        tiktok: data?.tiktok,
      },
    });
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateMediaKit = async (req: Request, res: Response) => {
  const { displayName, about, interests, creatorId } = JSON.parse(req.body.data);

  try {
    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      include: { interests: true },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    if ((req.files as any)?.profilePhoto) {
      const image = (req.files as any).profilePhoto;
      const profilePhotoURL = await uploadProfileImage(image.tempFilePath, image.name, 'creator');

      await prisma.user.update({
        where: {
          id: creator.userId,
        },
        data: {
          photoURL: profilePhotoURL,
        },
      });
    }

    const creatorInterests = creator.interests.map((interest: any) => interest.name);

    const unmatchedInterests = creatorInterests.filter((interest: string) => !interests.includes(interest));

    await prisma.interest.deleteMany({
      where: {
        name: { in: unmatchedInterests },
        userId: creator.userId,
      },
    });

    const newInterests = interests.filter((interest: string) => !creatorInterests.includes(interest));

    await prisma.interest.createMany({
      data: newInterests.map((interest: string) => ({
        name: interest,
        rank: 5,
        userId: creator.userId,
      })),
    });

    const mediaKit = await prisma.mediaKit.upsert({
      where: {
        creatorId: creatorId,
      },
      update: {
        about: about,
        displayName: displayName || '',
      },
      create: {
        about: about,
        creatorId: creatorId as string,
        displayName: displayName || '',
      },
    });

    return res.status(200).json({ message: 'Successfully updated', mediaKit });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getMediaKit = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const mediaKit = await prisma.mediaKit.findUnique({
      where: {
        creatorId: id as string,
      },
    });
    return res.status(200).json(mediaKit);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCreatorFullInfoById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      include: {
        paymentForm: true,
        creator: {
          include: {
            interests: true,
            mediaKit: {
              select: {
                about: true,
              },
            },
          },
        },
        shortlisted: true,
      },
    });

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCreatorFullInfoByIdPublic = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      select: {
        name: true,
        country: true,
        email: true,
        photoURL: true,
        photoBackgroundURL: true,
        creator: {
          select: {
            socialMediaData: true,
            interests: true,
            mediaKit: {
              select: {
                about: true,
              },
            },
          },
        },
        shortlisted: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Process socialMediaData to include only specified fields
    if (user.creator && user.creator.socialMediaData) {
      const processedSocialMediaData: any = {};

      ['instagram', 'tiktok'].forEach((platform) => {
        if (user.creator?.socialMediaData) {
          const socialMediaData = user.creator.socialMediaData as SocialMediaData;
          ['instagram', 'tiktok'].forEach((platform) => {
            if (socialMediaData[platform]?.data) {
              processedSocialMediaData[platform] = {
                followers: socialMediaData[platform].data?.followers,
                engagement_rate: socialMediaData[platform].data?.engagement_rate,
                avg_likes_per_post: socialMediaData[platform].data?.user_performance?.avg_likes_per_post,
                top_contents: socialMediaData[platform].data?.top_contents,
              };
            }
          });
          user.creator.socialMediaData = processedSocialMediaData;
        }
      });

      user.creator.socialMediaData = processedSocialMediaData;
    }

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(400).json({ message: 'Error fetching user data', error });
  }
};

export const updatePaymentForm = async (req: Request, res: Response) => {
  const { bankName, bankAccName, bankNumber, icPassportNumber, countryOfBank }: any = req.body;

  try {
    const existingPaymentForm = await prisma.paymentForm.findFirst({
      where: {
        userId: req.session.userid,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            id: true,
          },
        },
      },
    });
    // {"payTo":"Dan","bankName":"Affin Bank Berhad","accountName":"asdasdasd","accountEmail":"debis60817@lxheir.com","accountNumber":"131231231"}
    // if (!existingPaymentForm) return res.status(404).json({ message: 'Payment form not found' });

    if (existingPaymentForm?.status === 'rejected') {
      const { name, email } = existingPaymentForm.user;

      const bankAcc = {
        payTo: bankAccName || '',
        bankName: bankName || '',
        accountName: bankAccName || '',
        accountEmail: email || '',
        accountNumber: bankNumber || '',
      };

      await updateInvoices({ userId: existingPaymentForm.user?.id || '', bankAcc: bankAcc });
    }

    const paymentForm = await prisma.paymentForm.upsert({
      where: {
        userId: req.session.userid as string,
      },
      update: {
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankAccountName: bankAccName.toString(),
        bankName: bankName,
        countryOfBank: countryOfBank,
        status: 'approved',
      },
      create: {
        user: { connect: { id: req.session.userid } },
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankAccountName: bankAccName.toString(),
        bankName: bankName,
        countryOfBank: countryOfBank,
      },
    });

    await prisma.creator.update({
      where: {
        userId: paymentForm.userId,
      },
      data: {
        isFormCompleted: true,
      },
    });

    return res.status(200).json({ message: 'Successfully updated payment form.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateCreatorForm = async (req: Request, res: Response) => {
  //   const { fullName, address, icNumber, bankName, accountNumber } = req.body;
  //   const userId = req.session.userid as string;

  const { fullName, address, icNumber, bankName, accountName, accountNumber, userId } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        creator: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await prisma.user.update({
      where: {
        id: user?.id,
      },
      data: {
        name: fullName,
        creator: {
          update: {
            // address: address,
            isFormCompleted: true,
          },
        },
        paymentForm: {
          upsert: {
            where: {
              userId: user?.id,
            },
            update: {
              bankName: bankName,
              bankAccountNumber: accountNumber,
              bankAccountName: accountName,
              icNumber: icNumber,
            },
            create: {
              bankName: bankName,
              bankAccountNumber: accountNumber,
              bankAccountName: accountName,
              icNumber: icNumber,
            },
          },
        },
      },
    });

    return res.status(200).json({ message: 'You can start your pitch now !' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

// export const crawlCreator = async (req: Request, res: Response) => {
//   const { identifier, platform } = req.body;

//   // Check if identifier OR platform is undefined
//   if (!identifier || !platform) {
//     return res.status(400).json({ error: 'Missing identifier or platform' });
//   }

//   const options = {
//     hostname: 'api.fair-indonesia.com',
//     path: '/api/client/analyzer',
//     method: 'POST',
//     headers: {
//       Accept: 'application/json, text/plain, */*',
//       Authorization: 'IPMmEy81BL20jvkwd2zO',
//       'Content-Type': 'application/json',
//       Origin: 'https://www.fair-indonesia.com',
//     },
//   };

//   const data = JSON.stringify({ identifier, platform });

//   try {
//     const result = await new Promise((resolve, reject) => {
//       const apiRequest = https.request(options, (apiResponse) => {
//         let responseData = '';

//         apiResponse.on('data', (chunk) => {
//           responseData += chunk;
//         });

//         apiResponse.on('end', () => {
//           // Check if statusCode is defined before using it
//           if (apiResponse.statusCode && apiResponse.statusCode >= 200 && apiResponse.statusCode < 300) {
//             try {
//               const parsedData = JSON.parse(responseData);
//               resolve(parsedData);
//             } catch (error) {
//               console.error('Error parsing response:', error);
//               reject(new Error(`Invalid JSON response: ${responseData}`));
//             }
//           } else {
//             const statusCode = apiResponse.statusCode || 'unknown';
//             reject(new Error(`API request failed with status ${statusCode}: ${responseData}`));
//           }
//         });
//       });

//       apiRequest.on('error', (error) => {
//         console.error('Error making request:', error);
//         reject(new Error(`Error making request: ${error.message}`));
//       });

//       apiRequest.write(data);
//       apiRequest.end();
//     });

//     res.status(200).json(result);
//   } catch (error) {
//     console.log(error);
//     console.error('Unexpected error:', error);
//     res.status(500).json({ error: 'Unexpected error', details: error.message });
//   }
// };

export const getCreatorSocialMediaData = async (req: Request, res: Response) => {
  try {
    const creator = await prisma.creator.findUnique({
      where: {
        userId: req.session.userid as string,
      },
      select: {
        socialMediaData: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    return res.status(200).json(creator.socialMediaData);
  } catch (error) {
    console.error('Error fetching social media data:', error);
    return res.status(500).json({ message: 'Error fetching social media data' });
  }
};

export const getCreatorSocialMediaDataById = async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const creator = await prisma.creator.findUnique({
      where: {
        userId: userId,
      },
      select: {
        socialMediaData: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    return res.status(200).json(creator.socialMediaData);
  } catch (error) {
    console.error('Error fetching social media data:', error);
    return res.status(500).json({ message: 'Error fetching social media data' });
  }
};

export const updateSocialMedia = async (req: Request, res: Response) => {
  const { userid } = req.session;
  const { tiktok: tiktokUsername, instagram: instagramUsername } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'No creator found.' });
    }

    if (user.creator?.socialMediaData) {
      const { tiktok, instagram } = user.creator?.socialMediaData as any;

      if (tiktok > 2 && instagram > 2) {
        return res.status(400).json({ message: 'Limit reach. Contact our admin.' });
      }

      await prisma.creator.update({
        where: {
          userId: user.id,
        },
        data: {
          ...(instagramUsername && { instagram: instagramUsername }),
          ...(tiktokUsername && { tiktok: tiktokUsername }),
          socialMediaUpdateCount: { tiktok: tiktok + 1, instagram: instagram + 1 },
        },
      });
    } else {
      await prisma.creator.update({
        where: {
          userId: user.id,
        },
        data: {
          ...(instagramUsername && { instagram: instagramUsername }),
          ...(tiktokUsername && { tiktok: tiktokUsername }),
          socialMediaUpdateCount: { tiktok: 1, instagram: 1 },
        },
      });
    }

    return res.status(200).json({ message: 'Successfully changed.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getPartnerships = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      include: {
        shortlisted: {
          where: {
            isCampaignDone: true,
          },
          include: {
            campaign: {
              include: {
                campaignBrief: true,
                brand: true,
                company: true,
              },
            },
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    return res.status(200).json(user);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateCreatorPreference = async (req: Request, res: Response) => {
  const { languages, interests } = req.body;

  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    await prisma.creator.update({
      where: {
        userId: user.id,
      },
      data: {
        languages: languages,
      },
    });

    await prisma.interest.deleteMany({
      where: {
        userId: user.id,
      },
    });

    await prisma.interest.createMany({
      data: interests.map((interest: string) => ({
        name: interest,
        rank: 5,
        userId: user.id,
      })),
    });

    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const exportCreatorsToSheet = async (req: Request, res: Response) => {
  try {
    // Call the service function to export creators to spreadsheet
    const spreadsheetUrl = await exportCreatorsToSpreadsheet();

    // Return the URL of the spreadsheet
    return res.status(200).json({
      success: true,
      message: 'Creators exported to spreadsheet successfully',
      url: spreadsheetUrl,
    });
  } catch (error) {
    console.error('Error in exportCreatorsToSheet controller: ', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to export creators to spreadsheet',
      error: error.message,
    });
  }
};

export const createKanban = async (req: Request, res: Response) => {
  const { creatorId } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: creatorId,
      },
      include: {
        Board: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.Board) return res.status(400).json({ message: 'Kanban Board already exist' });

    await createKanbanBoard(user.id, 'creator');

    return res.sendStatus(200);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const createCampaignCreator = async (req: Request, res: Response) => {
  try {
    // const uniqueCreators = await prisma.user.groupBy({
    //   by: ['id'], // group by creator's unique ID
    //   _count: true,
    // });

    const shortlistedCreators = await prisma.shortListedCreator.findMany({
      include: {
        user: {
          include: {
            creator: true,
          },
        },
      },
    });

    const seen = new Set();

    const uniqueCreators = shortlistedCreators.filter((item) => {
      const creatorId = item?.user?.id;
      if (seen.has(creatorId)) return false;
      seen.add(creatorId);
      return true;
    });

    const formatData = uniqueCreators.map((item) => ({
      Name: item?.user?.name || '',
      Instagram: item?.user?.creator?.instagram || 'N/A',
      TikTok: item?.user?.creator?.tiktok || 'N/A',
      Email: item?.user?.email || '',
      'Phone Number': item?.user?.phoneNumber || '',
    }));

    await createCampaignCreatorSpreadSheet({
      spreadSheetId: '1i89GPX6a8OOyVAyHuHT7zelqrhHrbXYPkkvY8ybflYA',
      sheetByTitle: 'Campaign Creators',
      data: formatData,
    });

    // for (const item of shortlistedCreators) {
    //   await createCampaignCreatorSpreadSheet({
    //     spreadSheetId: '1i89GPX6a8OOyVAyHuHT7zelqrhHrbXYPkkvY8ybflYA',
    //     sheetByTitle: 'Campaign Creators',
    //     data: {
    //       name: item.user?.name || '',
    //       instagram: item.user?.creator?.instagram || '',
    //       tiktok: item.user?.creator?.tiktok || '',
    //       email: item.user?.email || '',
    //       phoneNumber: item.user?.phoneNumber || '',
    //     },
    //   });
    // }
    // await Promise.all(
    //   shortlistedCreators.map((item) => {
    //     return createCampaignCreatorSpreadSheet({
    //       spreadSheetId: '1i89GPX6a8OOyVAyHuHT7zelqrhHrbXYPkkvY8ybflYA',
    //       sheetByTitle: 'Campaign Creators',
    //       data: {
    //         name: item.user?.name || '',
    //         instagram: item.user?.creator?.instagram || '',
    //         tiktok: item.user?.creator?.tiktok || '',
    //         email: item.user?.email || '',
    //         phoneNumber: item.user?.phoneNumber || '',
    //       },
    //     });
    //   }),
    // );
    return res.sendStatus(200);
  } catch (error) {
    return res.status(400).json(error);
  }
  // try {
  //   const spreadsheetId = '1i89GPX6a8OOyVAyHuHT7zelqrhHrbXYPkkvY8ybflYA';
  //   const range = 'Campaign Creators!A2'; // adjust to match your headers
  //   // const creators = req.body.creators; // Expecting array of creators
  //   const shortlistedCreators = await prisma.shortListedCreator.findMany({
  //     include: {
  //       user: {
  //         include: {
  //           creator: true,
  //         },
  //       },
  //     },
  //   });
  //   const rows = shortlistedCreators.map((creator) => [
  //     creator.user?.name || '',
  //     creator.user?.creator?.instagram || '',
  //     creator.user?.creator?.tiktok || '',
  //     creator.user?.email || '',
  //     creator.user?.phoneNumber || '',
  //   ]);
  //   await batchUpdateRows(spreadsheetId, range, rows);
  //   res.status(200).json({ message: 'Spreadsheet updated successfully' });
  // } catch (err) {
  //   console.error(err);
  //   res.status(500).json({ message: 'Failed to update spreadsheet', error: err.message });
  // }
};

export const getCreatorAnalytics = async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    // Get creator and tokens
    const creator = await prisma.creator.findUnique({
      where: { userId },
      include: {
        instagramUser: true,
        tiktokUser: true,
      },
    });
    if (!creator) return res.status(404).json({ message: 'Creator not found' });

    // Instagram
    let instagramAnalytics = null;
    if (creator.instagramUser && creator.instagramUser.accessToken) {
      try {
        const accessToken = decryptToken(creator.instagramUser.accessToken as { iv: string; content: string });
        
        // Get real-time analytics from Instagram API
        const engagement = await getInstagramEngagementRateOverTime(accessToken);
        const monthly = await getInstagramMonthlyInteractions(accessToken);
        
        // Calculate overall engagement rate
        const totalEngagement = (creator.instagramUser.totalLikes || 0) + (creator.instagramUser.totalComments || 0);
        const overallEngagementRate = creator.instagramUser.followers_count 
          ? (totalEngagement / creator.instagramUser.followers_count) * 100 
          : 0;

        instagramAnalytics = {
          followers: creator.instagramUser.followers_count || 0,
          engagement_rate: parseFloat(overallEngagementRate.toFixed(1)),
          averageLikes: creator.instagramUser.averageLikes || 0,
          averageComments: creator.instagramUser.averageComments || 0,
          totalLikes: creator.instagramUser.totalLikes || 0,
          totalComments: creator.instagramUser.totalComments || 0,
          engagementRates: engagement.engagementRates,
          months: engagement.months,
          monthlyInteractions: monthly.monthlyData,
        };
      } catch (error) {
        console.error('Error fetching Instagram analytics:', error);
        // Return null analytics on error
        instagramAnalytics = null;
      }
    }

    // TikTok
    let tiktokAnalytics = null;
    if (creator.tiktokUser) {
      try {
        // Check if we have access token for real-time analytics
        const tiktokData = creator.tiktokData as any;
        if (tiktokData?.access_token) {
          const accessToken = decryptToken(tiktokData.access_token as { iv: string; content: string });
          
          // Get real-time analytics from TikTok API
          const engagement = await getTikTokEngagementRateOverTime(accessToken);
          const monthly = await getTikTokMonthlyInteractions(accessToken);
          
          // Calculate overall engagement rate
          const totalEngagement = (creator.tiktokUser.likes_count || 0);
          const overallEngagementRate = creator.tiktokUser.follower_count 
            ? (totalEngagement / creator.tiktokUser.follower_count) * 100 
            : 0;

          tiktokAnalytics = {
            followers: creator.tiktokUser.follower_count || 0,
            engagement_rate: parseFloat(overallEngagementRate.toFixed(1)),
            averageLikes: (creator.tiktokUser as any).averageLikes || 0,
            totalLikes: (creator.tiktokUser as any).totalLikes || 0,
            averageComments: (creator.tiktokUser as any).averageComments || 0,
            totalComments: (creator.tiktokUser as any).totalComments || 0,
            engagementRates: engagement.engagementRates,
            months: engagement.months,
            monthlyInteractions: monthly.monthlyData,
          };
        } else {
          // Fallback to stored data only
          const totalEngagement = creator.tiktokUser.likes_count || 0;
          const engagementRate = creator.tiktokUser.follower_count 
            ? (totalEngagement / creator.tiktokUser.follower_count) * 100 
            : 0;

          tiktokAnalytics = {
            followers: creator.tiktokUser.follower_count || 0,
            engagement_rate: parseFloat(engagementRate.toFixed(1)),
            averageLikes: (creator.tiktokUser as any).averageLikes || 0,
            totalLikes: (creator.tiktokUser as any).totalLikes || 0,
            averageComments: (creator.tiktokUser as any).averageComments || 0,
            totalComments: (creator.tiktokUser as any).totalComments || 0,
            engagementRates: [],
            months: [],
            monthlyInteractions: [],
          };
        }
      } catch (error) {
        console.error('Error fetching TikTok analytics:', error);
        // Fallback to basic stored data
        const totalEngagement = creator.tiktokUser.likes_count || 0;
        const engagementRate = creator.tiktokUser.follower_count 
          ? (totalEngagement / creator.tiktokUser.follower_count) * 100 
          : 0;

        tiktokAnalytics = {
          followers: creator.tiktokUser.follower_count || 0,
          engagement_rate: parseFloat(engagementRate.toFixed(1)),
          averageLikes: (creator.tiktokUser as any).averageLikes || 0,
          totalLikes: (creator.tiktokUser as any).totalLikes || 0,
          averageComments: (creator.tiktokUser as any).averageComments || 0,
          totalComments: (creator.tiktokUser as any).totalComments || 0,
          engagementRates: [],
          months: [],
          monthlyInteractions: [],
        };
      }
    }

    return res.status(200).json({
      instagram: instagramAnalytics,
      tiktok: tiktokAnalytics,
    });
  } catch (error) {
    console.error('Error in getCreatorAnalytics:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch analytics',
      error: error.message 
    });
  }
};
