import { Request, Response } from 'express';
import { AdminInvite, forgetPasswordEmail } from '@configs/nodemailer.config';
import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';

import {
  // createNewAdmin,
  findUserByEmail,
  handleGetAdmins,
  updateAdmin,
  updateNewAdmin,
  createAdminForm,
  createNewAdmin,
  // createNewAdmin,
} from '@services/userServices';
import { Storage } from '@google-cloud/storage';
import { Entity, PrismaClient } from '@prisma/client';
import { Title, saveNotification } from './notificationController';
import { uploadProfileImage } from '@configs/cloudStorage.config';
// import { serializePermission } from '@utils/serializePermission';

const storage = new Storage({
  keyFilename: '@configs/test-cs.json',
});

const bucket = storage.bucket('app-test-cult-cretive');

const prisma = new PrismaClient();

export const updateProfileAdmin = async (req: Request, res: Response) => {
  const { files } = req;
  const body = req.body;

  const permission = body.permission;

  try {
    if (files && files.image) {
      const { image } = files as any;
      const publicURL = await uploadProfileImage(image.tempFilePath, image.name, 'admin');
      await updateAdmin(req.body, publicURL);
    } else {
      await updateAdmin(req.body);
    }

    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json({ message: error });
  }
};

// Only superadmin is allow to run this function
export const getAdmins = async (req: Request, res: Response) => {
  const userid = req.session.userid;
  try {
    if (req.query.target && req.query.target === 'active') {
      const admins = await prisma.user.findMany({
        where: {
          NOT: {
            role: 'creator',
          },
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          status: true,
          phoneNumber: true,
          country: true,
          email: true,
          photoURL: true,
          admin: {
            include: {
              adminPermissionModule: {
                select: {
                  permission: true,
                  module: true,
                },
              },
              role: true,
            },
          },
          client: {
            select: {
              id: true,
              company: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      // Transform data for frontend consumption
      const transformedAdmins = admins.map((admin) => {
        const isClient = admin.admin?.role?.name === 'Client';
        const displayName = isClient && admin.client?.company?.name ? admin.client.company.name : admin.name;

        return {
          id: admin.id,
          name: displayName,
          originalName: admin.name, // Keep original name for "Me" display logic
          status: admin.status,
          phoneNumber: admin.phoneNumber,
          country: admin.country,
          email: admin.email,
          photoURL: admin.photoURL,
          role: admin.admin?.role?.name,
          admin: admin.admin,
          client: admin.client,
        };
      });

      return res.status(200).json(transformedAdmins);
    }

    const data = await handleGetAdmins(userid as string);
    return res.status(200).send(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAdminLogs = async (req: Request, res: Response) => {
  const { adminId } = req.params;

  try {
    const logs = await prisma.adminLog.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json(logs);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch admin logs' });
  }
};

// export const approveOrReject = async (req: Request, res: Response) => {
//   const { approve } = req.body;

//   try {
//     if (approve) {
//       await prisma.notification.create({
//         data: {
//           receiver_id: 1,
//           content: 'Your pitch has been approved',
//         },
//       });
//       return res.send('You pitch has been approved');
//     }
//     await prisma.notification.create({
//       data: {
//         receiver_id: 1,
//         content: 'Your pitch has been rejected',
//       },
//     });
//     return res.send('You pitch has been rejected');
//   } catch (error) {
//     res.end(error);
//   }
// };

// export const getAllNotification = async (req: Request, res: Response) => {
//   const { id } = req.params;
//   try {
//     const data = await prisma.notification.findMany({
//       where: {
//         receiver_id: parseInt(id),
//       },
//     });

//     if (data.length < 1) {
//       return res.send('No notifcation');
//     }

//     return res.send(data);
//   } catch (error) {
//     return res.send(error);
//   }
// };

export const inviteAdmin = async (req: Request, res: Response) => {
  const { email, role } = req.body;

  try {
    const user = await findUserByEmail(email);

    if (user) {
      return res.status(400).json({ message: 'Admin is already registered.' });
    }

    const response = await createNewAdmin(email, role);
    AdminInvite(response?.user.email as string, response?.admin.inviteToken as string);
    return res.status(200).send(response);
  } catch (error) {
    return res.status(404).send(error);
  }
};

export const createAdmin = async (req: Request, res: Response) => {
  try {
    const user = await findUserByEmail(req.body.email);

    if (user) {
      return res.status(400).json({ message: 'User already registered' });
    }

    const result = await createAdminForm(req.body);

    AdminInvite(result?.user.email as string, result?.admin.inviteToken as string);

    return res.status(200).json({ message: 'Successfully created', result });
  } catch (error) {
    return res.status(404).send(error);
  }
};

export const updateAdminInformation = async (req: Request, res: Response) => {
  const photo = (req?.files as any)?.photoUrl;
  try {
    const result = await updateNewAdmin(req.body, photo);
    res.status(200).json({ message: 'Successfully updated', result });
  } catch (error) {
    res.status(404).send(error);
  }
};

export const getAllActiveAdmins = async (_req: Request, res: Response) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        NOT: {
          role: 'creator',
        },
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        status: true,
        phoneNumber: true,
        country: true,
        email: true,
        admin: {
          include: {
            adminPermissionModule: {
              select: {
                permission: true,
                module: true,
              },
            },
            role: true,
          },
        },
      },
    });

    return res.status(200).json(admins);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const forgetPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    // Normalize email to lowercase for consistent lookup
    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase().trim(),
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'No account registered with the email.' });
    }

    const token = jwt.sign({ email: user?.email }, process.env.ACCESSKEY as Secret, {
      expiresIn: '5m',
    });

    await prisma.resetPasswordToken.upsert({
      where: {
        userId: user?.id,
      },
      update: {
        token: token,
      },
      create: {
        token: token,
      },
    });

    forgetPasswordEmail(user?.email, token, user?.name || '');

    return res.status(200).json({ message: 'Reset link has been sent to your email!' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const checkForgetPasswordToken = async (req: Request, res: Response) => {
  const params = req.params;
  try {
    if (!params.token) {
      return res.status(404).json({ message: 'Token not found.' });
    }

    const forgetPasswordToken = await prisma.resetPasswordToken.findFirst({
      where: {
        token: params.token,
      },
    });

    if (!forgetPasswordToken) {
      return res.status(404).json({ message: 'Token not found.' });
    }

    const userDecode: any = jwt.verify(forgetPasswordToken.token as string, process.env.ACCESSKEY as string);

    if (!userDecode) {
      return res.status(404).json({ message: 'Token expired' });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: userDecode?.email,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ message: 'User authenticated.', email: user?.email });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const { token, password, confirmPassword } = req.body;

  try {
    if (password !== confirmPassword) {
      return res.status(404).json({ message: 'Password must match.' });
    }

    const tokenDecoded: any = jwt.verify(token as string, process.env.ACCESSKEY as string);

    const user = await prisma.user.findFirst({
      where: {
        email: tokenDecoded.email,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        password: hashedPassword,
      },
    });

    // Also update ChildAccount password if this user is a child account (for data consistency)
    await prisma.childAccount.updateMany({
      where: { email: user.email.toLowerCase() },
      data: { password: hashedPassword },
    });

    return res.status(200).json({ message: 'Successfully changed password.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

/**
 * OPTIMIZED: Get user overview with limited data and aggregation
 * GET /api/user/overview/:userId
 */
export const getOverview = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { limit = '50' } = req.query; // Optional limit for campaigns

  try {
    // OPTIMIZED: Only fetch user with limited submissions (in progress only)
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        submission: {
          where: {
            status: 'IN_PROGRESS',
          },
          take: 20, // Limit to 20 in-progress submissions
          select: {
            id: true,
            status: true,
            createdAt: true,
            task: {
              select: {
                id: true,
                name: true,
              },
            },
            campaign: {
              select: {
                id: true,
                name: true,
                campaignBrief: {
                  select: {
                    images: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const limitNum = parseInt(limit as string, 10);

    // OPTIMIZED: Limit campaigns and use select instead of include
    const campaigns = await prisma.campaign.findMany({
      where: {
        shortlisted: {
          some: {
            userId: user.id,
            isCampaignDone: false,
          },
        },
      },
      take: limitNum, // Limit campaigns
      select: {
        id: true,
        name: true,
        campaignType: true,
        campaignBrief: {
          select: {
            images: true,
          },
        },
        submission: {
          where: {
            userId: user.id,
          },
          select: {
            id: true,
            status: true,
            submissionType: {
              select: {
                type: true,
              },
            },
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const adjustedCampaigns = campaigns.map((campaign) => {
      const submissions = campaign.submission;
      let completed = 0;
      let totalSubmissions = 0;
      let lastUpdate = '';

      submissions?.forEach((submission) => {
        if (
          submission.status === 'APPROVED' ||
          (submission.submissionType?.type === 'FIRST_DRAFT' && submission.status === 'CHANGES_REQUIRED')
        ) {
          completed++;
        }
      });

      const isChangesRequired =
        campaign.submission.find((submission) => submission.submissionType.type === 'FIRST_DRAFT')?.status ===
        'CHANGES_REQUIRED';

      totalSubmissions = campaign.campaignType === 'ugc' ? (isChangesRequired ? 3 : 2) : isChangesRequired ? 4 : 3;

      const pendingReviewSubmission = submissions.find((submission) => submission.status === 'PENDING_REVIEW');
      const inProgressSubmission = submissions.find((submission) => submission.status === 'IN_PROGRESS');

      if (pendingReviewSubmission) {
        lastUpdate = 'Awaiting client approval.';
      } else if (inProgressSubmission) {
        lastUpdate = `${submissionMapping[inProgressSubmission.submissionType.type]} is ready for submission`;
      }

      return {
        campaignId: campaign?.id,
        campaignName: campaign?.name,
        campaignImages: campaign?.campaignBrief?.images,
        brand: {
          id: campaign?.brand?.id || campaign?.company?.id,
          name: campaign?.brand?.name || campaign?.company?.name,
        },
        completed: ((completed / totalSubmissions) * 100).toFixed(),
        lastUpdate: lastUpdate,
      };
    });

    const data = {
      adjustedCampaigns,
      tasks: (user as any).submission || [],
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

const submissionMapping: any = {
  AGREEMENT_FORM: 'Agreement',
  FIRST_DRAFT: 'Draft',
  FINAL_DRAFT: 'Draft',
  POSTING: 'Posting',
};

/**
 * Get user by email
 * Used by frontend to fetch user status for PIC
 */
export const getUserByEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: email,
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error: any) {
    console.error('Error fetching user by email:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while fetching user',
    });
  }
};
