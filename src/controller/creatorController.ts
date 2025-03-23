import { Request, Response } from 'express';
import https from 'https';
import { Entity, PrismaClient } from '@prisma/client';
import { uploadAgreementForm, uploadProfileImage } from '@configs/cloudStorage.config';
import { Title, saveNotification } from './notificationController';
import { clients, io } from '../server';

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
  const { bankName, bankAccName, bankNumber, icPassportNumber }: any = req.body;

  try {
    const paymentForm = await prisma.paymentForm.upsert({
      where: {
        userId: req.session.userid as string,
      },
      update: {
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankAccountName: bankAccName.toString(),
        bankName: bankName,
      },
      create: {
        user: { connect: { id: req.session.userid } },
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankAccountName: bankAccName.toString(),
        bankName: bankName,
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
