import { Request, Response } from 'express';
import https from 'https';
import { Entity, PrismaClient } from '@prisma/client';
import { uploadAgreementForm } from '@configs/cloudStorage.config';
import { Title, saveNotification } from './notificationController';
import { clients, io } from '../server';

const prisma = new PrismaClient();

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
        country: true,
        status: true,
        email: true,
        role: true,
        creator: true,
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
          },
        },
      },
    });
    return res.status(200).json(creator);
  } catch (error) {
    return res.status(400).json({ error });
  }
};

export const deleteCreator = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const deleteCreator = await prisma.$transaction([
      prisma.industry.deleteMany({
        where: {
          userId: id,
        },
      }),
      prisma.interest.deleteMany({
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
      },
    });
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateMediaKit = async (req: Request, res: Response) => {
  const { name, about, interests, creatorId } = req.body;

  try {
    const creator = await prisma.creator.findUnique({
      where: { id: creatorId },
      include: { interests: true },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
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

    const addedInterst = await prisma.interest.createMany({
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
        name: name,
        about: about,
        interests: interests,
      },
      create: {
        name: name,
        about: about,
        interests: interests,
        creatorId: creatorId as string,
      },
    });
    return res.status(200).json({ message: 'Successfully updated', mediaKit });
  } catch (error) {
    console.log(error);
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
        creator: {
          include: {
            interests: true,
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

export const updatePaymentForm = async (req: Request, res: Response) => {
  const { bankName, bankNumber, bodyMeasurement, allergies, icPassportNumber }: any = req.body;

  try {
    const data = await prisma.paymentForm.upsert({
      where: {
        userId: req.session.userid as string,
      },
      update: {
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankName: bankName?.bank,
        bodyMeasurement: bodyMeasurement.toString(),
        allergies: allergies.map((allergy: any) => allergy.name),
      },
      create: {
        user: { connect: { id: req.session.userid } },
        icNumber: icPassportNumber.toString(),
        bankAccountNumber: bankNumber.toString(),
        bankName: bankName?.bank,
        bodyMeasurement: bodyMeasurement.toString(),
        allergies: allergies.map((allergy: any) => allergy.name),
      },
    });

    return res.status(200).json({ message: 'Successfully updated payment form' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const updateCreatorForm = async (req: Request, res: Response) => {
  const { fullName, address, icNumber, bankName, accountNumber, userId } = req.body;
  console.log(req.body);
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
            address: address,
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
              icNumber: icNumber,
            },
            create: {
              bankName: bankName,
              bankAccountNumber: accountNumber,
              icNumber: icNumber,
            },
          },
        },
      },
    });

    return res.status(200).json({ message: 'You can start your pitch now !' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const crawlCreator = async (req: Request, res: Response) => {
  console.log('crawlCreator function called');
  console.log('Request body:', req.body);

  const { identifier, platform } = req.body;

  if (!identifier || !platform) {
    console.log('Missing identifier or platform');
    return res.status(400).json({ error: 'Missing identifier or platform' });
  }

  const options = {
    hostname: 'stg.api.fair-indonesia.com',
    path: '/api/client/analyzer',
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: 'AtLrQ+Od&KKyxIr+E$4S*2nFS',
      'Content-Type': 'application/json',
      Origin: 'https://www.fair-indonesia.com',
    },
    // rejectUnauthorized: false
  };

  const data = JSON.stringify({ identifier, platform });

  console.log('Sending request to external API with data:', data);

  try {
    const result = await new Promise((resolve, reject) => {
      const apiRequest = https.request(options, (apiResponse) => {
        console.log('Received response from external API');
        console.log('Status Code:', apiResponse.statusCode);
        console.log('Headers:', apiResponse.headers);

        let responseData = '';

        apiResponse.on('data', (chunk) => {
          responseData += chunk;
        });

        apiResponse.on('end', () => {
          console.log('Response data:', responseData);
          try {
            const parsedData = JSON.parse(responseData);
            console.log('Parsed data:', parsedData);
            resolve(parsedData);
          } catch (error) {
            console.error('Error parsing response:', error);
            reject(new Error(`Error parsing response: ${error.message}`));
          }
        });
      });

      apiRequest.on('error', (error) => {
        console.error('Error making request:', error);
        reject(new Error(`Error making request: ${error.message}`));
      });

      apiRequest.write(data);
      apiRequest.end();
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Unexpected error', details: error.message });
  }
};

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
