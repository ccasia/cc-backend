import { Request, Response } from 'express';
import {
  Admin,
  CampaignAdmin,
  CampaignBrief,
  CampaignRequirement,
  CampaignStatus,
  CampaignTimeline,
  Company,
  Creator,
  Entity,
  Interest,
  LogisticStatus,
  PaymentForm,
  Pitch,
  PrismaClient,
  ShortListedCreator,
  Submission,
  SubmissionType,
  User,
  TimelineStatus,
} from '@prisma/client';

import amqplib from 'amqplib';

import {
  deleteContent,
  uploadAgreementForm,
  uploadAttachments,
  uploadImage,
  uploadPitchVideo,
} from '@configs/cloudStorage.config';
import dayjs from 'dayjs';
import { logChange, logAdminChange } from '@services/campaignServices';
import { saveNotification } from '@controllers/notificationController';
import { clients, io } from '../server';
import fs from 'fs';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import path from 'path';
import { compress } from '@helper/compression';
import { agreementInput } from '@helper/agreementInput';
import { pdfConverter } from '@helper/pdfConverter';
import {
  notificationPendingAgreement,
  notificationPitch,
  notificationSignature,
  notificationCampaignLive,
  notificationAdminAssign,
  notificationMaintenance,
  notificationLogisticTracking,
  notificationLogisticDelivery,
} from '@helper/notification';
import { deliveryConfirmation, shortlisted, tracking } from '@configs/nodemailer.config';
import { createNewSpreadSheet } from '@services/google_sheets/sheets';
import { getRemainingCredits } from '@services/companyService';
import { handleGuestForShortListing } from '@services/shortlistService';
import getCountry from '@utils/getCountry';
// import { applyCreditCampiagn } from '@services/packageService';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

interface image {
  path: string;
  preview: string;
}

interface timeline {
  id: string;
  openForPitch: number;
  shortlistCreator: number;
  firstDraft: number;
  finalDraft: number;
  feedBackFirstDraft: number;
  feedBackFinalDraft: number;
  filterPitch: number;
  agreementSign: number;
  qc: number;
  posting: number;
}

interface RawFootage {
  url: string;
}

interface Photo {
  url: string;
}
interface Campaign {
  campaignId?: string;
  campaignInterests: string[];
  campaignIndustries: string;
  campaignBrand: {
    id: string;
  };
  hasBrand: Boolean;
  client: Company;
  campaignStartDate: Date;
  campaignEndDate: Date;
  campaignTitle: string;
  campaignObjectives: string;
  campaignDo: any;
  campaignDont: any;
  campaignDescription: string;
  audienceAge: string[];
  audienceGender: string[];
  audienceLocation: string[];
  audienceLanguage: string[];
  audienceCreatorPersona: string[];
  audienceUserPersona: string;
  adminManager: [];
  campaignStage: string;
  campaignImages: image[];
  agreementFrom: { id: string };
  defaultTimeline: timeline;
  status: string;
  adminId: string;
  timeline: any;
  adminTest: [];
  brandTone: string;
  productName: string;
  socialMediaPlatform: string[];
  videoAngle: string[];
  campaignType: string;
  // agreementForm: { id: string };
  otherAttachments?: string[];
  referencesLinks?: string[];
  rawFootage: boolean;
  photos: boolean;
  crossPosting: boolean;
  ads: boolean;
  campaignCredits: number;
  country: string;
}

const MAPPING: Record<string, string> = {
  AGREEMENT_FORM: 'Agreement',
  FIRST_DRAFT: 'First Draft',
  FINAL_DRAFT: 'Final Draft',
  POSTING: 'Posting',
};

// const generateAgreement = async (creator: any, campaign: any) => {
//   try {
//     const agreementsPath = await agreementInput({
//       date: dayjs().format('ddd LL'),
//       creatorName: creator.name as string,
//       icNumber: creator?.paymentForm.icNumber,
//       address: creator.creator.address,
//       agreement_endDate: dayjs().add(1, 'M').format('ddd LL'),
//       now_date: dayjs().format('ddd LL'),
//       creatorAccNumber: creator?.paymentForm.bankAccountNumber,
//       creatorBankName: creator?.paymentForm?.bankName,
//       creatorBankAccName: creator?.paymentForm?.bankAccountName,
//       agreementFormUrl: campaign?.campaignBrief?.agreementFrom,
//       version: 1,
//     });

//     // const pdfPath = await pdfConverter(
//     //   agreementsPath,
//     //   path.resolve(__dirname, `../form/pdf/${creator.name.split(' ').join('_')}.pdf`),
//     // );

//     // const url = await uploadAgreementForm(
//     //   pdfPath,
//     //   `${creator.name.split(' ').join('_')}-${campaign.name}.pdf`,
//     //   'creatorAgreements',
//     // );

//     // await fs.promises.unlink(pdfPath);

//     // return url;
//   } catch (error) {
//     throw new Error(error);
//   }
// };

export const createCampaign = async (req: Request, res: Response) => {
  const {
    campaignId,
    campaignTitle,
    campaignBrand,
    hasBrand,
    client,
    campaignStartDate,
    campaignEndDate,
    campaignObjectives,
    socialMediaPlatform,
    videoAngle,
    campaignDescription,
    audienceGender,
    audienceAge,
    audienceLocation,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    campaignDo,
    campaignDont,
    adminManager,
    campaignStage,
    campaignIndustries,
    timeline,
    brandTone,
    productName,
    agreementFrom,
    referencesLinks,
    campaignType,
    rawFootage,
    photos,
    crossPosting,
    ads,
    campaignCredits,
    country,
  }: Campaign = JSON.parse(req.body.data);
  // Also read optional fields not in the Campaign interface
  const rawBody: any = (() => {
    try {
      return JSON.parse(req.body.data);
    } catch {
      return {};
    }
  })();
  const requestedOrigin = rawBody?.origin as 'ADMIN' | 'CLIENT' | undefined;
  const clientManagers = Array.isArray(rawBody?.clientManagers) ? rawBody.clientManagers : [];

  try {
    const publicURL: any = [];
    const otherAttachments: string[] = [];

    // Handle Campaign Images
    if (req.files && req.files.campaignImages) {
      const images: any = (req.files as any).campaignImages as [];

      if (images.length) {
        for (const item of images as any) {
          const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
          publicURL.push(url);
        }
      } else {
        const url = await uploadImage(images.tempFilePath, images.name, 'campaign');
        publicURL.push(url);
      }
    }

    if (req.files && req.files.otherAttachments) {
      const attachments: any = (req.files as any).otherAttachments as [];

      if (attachments.length) {
        for (const item of attachments as any) {
          const url: string = await uploadAttachments({
            tempFilePath: item.tempFilePath,
            fileName: item.name,
            folderName: 'otherAttachments',
          });
          otherAttachments.push(url);
        }
      } else {
        const url: string = await uploadAttachments({
          tempFilePath: attachments.tempFilePath,
          fileName: attachments.name,
          folderName: 'otherAttachments',
        });
        otherAttachments.push(url);
      }
    }

    // Handle All processes
    await prisma.$transaction(
      async (tx) => {
        const admins = await Promise.all(
          adminManager.map(async (admin) => {
            return await tx.user.findUnique({
              where: {
                id: (admin as any).id as string,
              },
              include: {
                admin: true,
              },
            });
          }),
        );

        // Attach client managers (if provided) to campaignAdmin as well
        const clientManagerUsers = await Promise.all(
          clientManagers.map(async (cm: any) => {
            // Accept either {id} or email/name strings; try id first
            if (cm?.id) {
              return tx.user.findUnique({ where: { id: cm.id } });
            }
            // Try by email
            if (typeof cm === 'string' && cm.includes('@')) {
              return tx.user.findUnique({ where: { email: cm } });
            }
            return null;
          }),
        );
        const existingClient = await tx.company.findUnique({
          where: { id: client.id },
          include: { subscriptions: { where: { status: 'ACTIVE' } } },
        });

        if (!existingClient) throw new Error('Company not found');

        const availableCredits = await getRemainingCredits(existingClient.id);

        // Ensure availableCredits is a valid number
        if (availableCredits === null || typeof availableCredits !== 'number') {
          throw new Error('Unable to retrieve available credits for the client');
        }

        // Check if campaignCredits exceed availableCredits
        if (campaignCredits > availableCredits) {
          throw new Error('Not enough credits to create the campaign');
        }

        const url: string = await createNewSpreadSheet({ title: campaignTitle });

        // Create Campaign
        // Normalize dates for campaign brief
        const normalizedStartDate = campaignStartDate ? dayjs(campaignStartDate).toDate() : new Date();
        const normalizedEndDate = campaignEndDate ? dayjs(campaignEndDate).toDate() : normalizedStartDate;

        const campaign = await tx.campaign.create({
          data: {
            campaignId: campaignId,
            name: campaignTitle,
            campaignType: campaignType,
            description: campaignDescription,
            status: campaignStage as CampaignStatus,
            origin: requestedOrigin === 'CLIENT' ? 'CLIENT' : 'ADMIN',
            brandTone: brandTone,
            productName: productName,
            spreadSheetURL: url,
            rawFootage: rawFootage || false,
            ads: ads || false,
            photos: photos || false,
            crossPosting: crossPosting || false,
            agreementTemplate: {
              connect: {
                id: agreementFrom.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaignObjectives,
                images: publicURL.map((image: any) => image) || '',
                otherAttachments: otherAttachments,
                referencesLinks: referencesLinks?.map((link: any) => link.value) || [],
                startDate: normalizedStartDate,
                endDate: normalizedEndDate,
                industries: campaignIndustries,
                campaigns_do: campaignDo,
                campaigns_dont: campaignDont,
                videoAngle: videoAngle,
                socialMediaPlatform: socialMediaPlatform,
              },
            },
            campaignRequirement: {
              create: {
                gender: audienceGender,
                age: audienceAge,
                geoLocation: audienceLocation,
                language: audienceLanguage,
                creator_persona: audienceCreatorPersona,
                user_persona: audienceUserPersona,
                country: country,
              },
            },
            campaignCredits,
            creditsPending: campaignCredits,
            creditsUtilized: 0,
            subscription: {
              connect: {
                id: existingClient.subscriptions[0].id,
              },
            },
          },
          include: {
            campaignBrief: true,
          },
        });

        // Deduct credits from subscription
        await tx.subscription.update({
          where: {
            id: existingClient.subscriptions[0].id,
          },
          data: {
            creditsUsed: {
              increment: campaignCredits,
            },
          },
        });

        // Create Campaign Timeline
        const timelines: CampaignTimeline[] = await Promise.all(
          timeline.map(async (item: any, index: number) => {
            const submission = await tx.submissionType.findFirst({
              where: {
                type: item.timeline_type.name.includes('First Draft')
                  ? 'FIRST_DRAFT'
                  : item.timeline_type.name.includes('Agreement')
                    ? 'AGREEMENT_FORM'
                    : item.timeline_type.name.includes('Final Draft')
                      ? 'FINAL_DRAFT'
                      : item.timeline_type.name.includes('Posting')
                        ? 'POSTING'
                        : 'OTHER',
              },
            });

            if (submission?.type === 'OTHER') {
              return tx.campaignTimeline.create({
                data: {
                  for: item.for,
                  duration: parseInt(item.duration),
                  startDate: dayjs(item.startDate).toDate(),
                  endDate: dayjs(item.endDate).toDate(),
                  order: index + 1,
                  name: item.timeline_type.name,
                  campaign: { connect: { id: campaign.id } },
                },
              });
            }

            return tx.campaignTimeline.create({
              data: {
                for: item.for,
                duration: parseInt(item.duration),
                startDate: dayjs(item.startDate).toDate(),
                endDate: dayjs(item.endDate).toDate(),
                order: index + 1,
                name: item.timeline_type.name,
                campaign: { connect: { id: campaign.id } },
                submissionType: { connect: { id: submission?.id } },
              },
            });
          }),
        );

        // Connect to brand
        if (campaignBrand) {
          // connect with brand
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              brand: { connect: { id: campaignBrand.id } },
            },
          });
        } else {
          // connect with client
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              company: { connect: { id: client.id } },
            },
          });
        }

        if (!campaign || !campaign.id) {
          throw new Error('Campaign creation failed or campaign ID is missing');
        }

        // Check if the user creating the campaign is a Client
        const userId = req.session.userid;
        if (userId) {
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            include: { admin: { include: { role: true } } },
          });

          // If the user is a Client, add them to campaignAdmin
          if (currentUser?.admin?.role?.name === 'Client') {
            await tx.campaignAdmin.create({
              data: {
                adminId: userId,
                campaignId: campaign.id,
              },
            });
          }
        }

        await tx.thread.create({
          data: {
            title: campaign.name,
            description: campaign.description,
            campaignId: campaign.id,
            photoURL: publicURL[0],
            UserThread: {
              create: admins.map((admin: any) => ({
                userId: admin.id,
              })),
            },
          },
          include: {
            UserThread: true,
            campaign: true,
          },
        });

        // Add adminManager and clientManagers to campaignAdmin
        const adminIdsToAdd = [
          ...admins.map((a: any) => a?.id).filter(Boolean),
          ...clientManagerUsers.map((u: any) => u?.id).filter(Boolean),
        ] as string[];
        for (const adminUserId of adminIdsToAdd) {
          const exists = await tx.campaignAdmin.findUnique({
            where: { adminId_campaignId: { adminId: adminUserId, campaignId: campaign.id } },
          });
          if (!exists) {
            await tx.campaignAdmin.create({ data: { adminId: adminUserId, campaignId: campaign.id } });
          }
        }

        await Promise.all(
          admins.map(async (admin: any) => {
            const existing = await tx.campaignAdmin.findUnique({
              where: {
                adminId_campaignId: {
                  adminId: admin?.id,
                  campaignId: campaign?.id,
                },
              },
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            });

            if (existing) {
              // Skip existing admin instead of aborting the whole request
              return null;
            }

            const createdAdminRel = await tx.campaignAdmin.create({
              data: {
                adminId: admin?.id,
                campaignId: campaign.id,
              },
              include: {
                admin: true,
              },
            });

            await tx.event.create({
              data: {
                start: dayjs(campaign?.campaignBrief?.startDate).format(),
                end: dayjs(campaign?.campaignBrief?.endDate).format(),
                title: campaign?.name,
                userId: createdAdminRel.admin.userId as string,
                allDay: false,
              },
            });

            // await applyCreditCampiagn(client.id, campaignCredits);
            // await applyCreditCampiagn(client.id, campaignCredits);

            const { title, message } = notificationAdminAssign(campaign.name);

            const data = await tx.notification.create({
              data: {
                title: title,
                message: message,
                entity: 'Status',
                campaign: {
                  connect: {
                    id: campaign.id,
                  },
                },
                userNotification: {
                  create: {
                    userId: admin.id,
                  },
                },
              },
              include: {
                userNotification: {
                  select: {
                    userId: true,
                  },
                },
              },
            });

            io.to(clients.get(admin.id)).emit('notification', data);
            return createdAdminRel;
          }),
        );

        logChange('Created the Campaign', campaign.id, req);

        // Get admin info for logging
        const admin = await prisma.user.findUnique({
          where: { id: req.session.userid },
        });
        const adminName = admin?.name || 'Admin';

        // Log admin activity for campaign creation
        const adminActivityMessage = `${adminName} created ${campaign.name}`;
        await logChange(adminActivityMessage, campaign.id, req);

        const adminId = req.session.userid;
        if (adminId) {
          const adminLogMessage = `Created campaign - "${campaign.name}" `;
          logAdminChange(adminLogMessage, adminId, req);
        }

        if (io) {
          io.emit('campaign');
        }
        return res.status(200).json({ campaign, message: 'Campaign created successfully.' });
      },
      {
        timeout: 500000,
      },
    );
  } catch (error) {
    if (!res.headersSent) {
      return res.status(400).json(error?.message);
    }
    console.error('createCampaign error after response sent:', error);
  }
};

// Campaign Info for Admin
export const getAllCampaigns = async (req: Request, res: Response) => {
  const id = req.session.userid;

  try {
    let campaigns;

    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      select: {
        admin: {
          select: {
            mode: true,
            role: true,
          },
        },
        id: true,
      },
    });

    if (user?.admin?.mode === 'god' || user?.admin?.role?.name === 'CSL') {
      campaigns = await prisma.campaign.findMany({
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: {
            include: { company: { include: { subscriptions: { include: { package: true, customPackage: true } } } } },
          },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },

                  paymentForm: true,
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistic: {
            include: {
              user: true,
            },
          },
          creatorAgreement: true,
        },
      });
    } else {
      campaigns = await prisma.campaign.findMany({
        where: {
          campaignAdmin: {
            some: {
              adminId: user?.id,
            },
          },
        },
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: { include: { company: { include: { subscriptions: true } } } },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistic: true,
          creatorAgreement: true,
        },
      });
    }

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log(`Getting campaign by ID: ${id}`);
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: id,
      },
      include: {
        agreementTemplate: true,
        submission: {
          include: {
            submissionType: true,
            dependencies: true,
            dependentOn: true,
          },
        },
        brand: {
          include: { company: { include: { subscriptions: { include: { package: true, customPackage: true } } } } },
        },
        company: {
          include: {
            pic: true,
            subscriptions: {
              include: {
                customPackage: true,
                package: true,
              },
            },
          },
        },
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                role: true,
                user: {
                  include: {
                    agreementTemplate: true,
                  },
                },
              },
            },
          },
        },
        campaignClients: {
          include: {
            client: {
              include: {
                user: true,
                company: true,
              },
            },
          },
        },
        campaignSubmissionRequirement: {
          include: {
            submissionType: {
              select: {
                type: true,
              },
            },
          },
        },
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    interests: true,
                  },
                },
              },
            },
          },
        },
        shortlisted: {
          select: {
            id: true,
            ugcVideos: true,
            userId: true,
            adminComments: true,
            user: {
              select: {
                id: true,
                name: true,
                photoURL: true,
                status: true,
                creator: {
                  select: {
                    isGuest: true,
                  },
                },
              },
            },
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
        logistic: true,

        creatorAgreement: true,
      },
    });

    console.log(`Campaign found:`, {
      id: campaign?.id,
      name: campaign?.name,
      origin: campaign?.origin,
      status: campaign?.status,
    });

    return res.status(200).json(campaign);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const matchCampaignWithCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;
  const { cursor, take = 10, search } = req.query;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: {
          include: {
            interests: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    console.log('matchCampaignWithCreator - Starting search for creator:', user.id);

    // Get all ACTIVE campaigns
    let campaigns = await prisma.campaign.findMany({
      take: Number(take),
      ...(cursor && {
        skip: 1,
        cursor: {
          id: cursor as string,
        },
      }),
      where: {
        AND: [
          { status: 'ACTIVE' },
          {
            ...(search && {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            }),
          },
        ],
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        bookMarkCampaign: true,
        shortlisted: true,
        logistic: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
        campaignClients: {
          include: {
            client: {
              include: {
                user: true,
                company: true,
              },
            },
          },
        },
        campaignLogs: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`matchCampaignWithCreator - Found ${campaigns.length} ACTIVE campaigns`);

    // Log each campaign's timelines and additional info before filtering
    campaigns.forEach((campaign) => {
      console.log(`Campaign ${campaign.id} (${campaign.name}) - Status: ${campaign.status}`);
      console.log(`Timelines (${campaign.campaignTimeline?.length || 0}):`);
      campaign.campaignTimeline?.forEach((timeline) => {
        console.log(`  - ${timeline.name} (Status: ${timeline.status}, For: ${timeline.for})`);
      });

      // Log campaign admins and creator
      console.log(`Campaign admins (${campaign.campaignAdmin?.length || 0}):`);
      campaign.campaignAdmin?.forEach((admin) => {
        console.log(`  - Admin ID: ${admin.adminId}, Role: ${admin.admin?.user?.role || 'unknown'}`);
      });

      // Log campaign logs to see who created it
      console.log(`Campaign logs (${campaign.campaignLogs?.length || 0}):`);
      campaign.campaignLogs?.forEach((log: any) => {
        console.log(`  - Action: ${log.action}, User ID: ${log.userId}, Role: ${log.userRole}`);
      });

      // Check if this campaign would pass the filter
      const hasOpenForPitchTimeline = campaign.campaignTimeline?.some(
        (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
      );
      console.log(`  Will this campaign pass filter? ${hasOpenForPitchTimeline ? 'YES' : 'NO'}`);

      // Check if campaign has additional requirements that might be missing
      if (!campaign.campaignRequirement) {
        console.log(`  WARNING: Campaign has no requirements defined`);
      }
      if (!campaign.campaignBrief) {
        console.log(`  WARNING: Campaign has no brief defined`);
      }
    });

    if (campaigns?.length === 0) {
      const data = {
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      };

      return res.status(200).json(data);
    }

    // Show all active campaigns to creators (both admin and client created) - like superadmin
    const beforeFilterCount = campaigns.length;

    // For now, show ALL active campaigns to creators to match superadmin behavior
    // This ensures creators can see all campaigns like superadmin does
    campaigns = campaigns.filter((campaign) => {
      // Show all ACTIVE campaigns regardless of timeline status
      return campaign.status === 'ACTIVE';
    });

    const afterFilterCount = campaigns.length;

    console.log(
      `matchCampaignWithCreator - After filtering: ${afterFilterCount}/${beforeFilterCount} campaigns remain (showing ALL active campaigns to creators)`,
    );

    const country = await getCountry(req.ip as string);

    console.log('COUNTRY', country);

    // TEMPORARY: Disable country filtering to fix creator discovery issue
    // The country filtering was preventing creators from seeing campaigns
    const beforeCountryFilterCount = campaigns.length;
    
    // Log country information for debugging
    console.log(`DEBUG: Creator country detected as: ${country || 'UNKNOWN'}`);
    console.log(`DEBUG: Before country filtering - ${beforeCountryFilterCount} campaigns available`);
    
    // Show campaigns with country requirements for debugging
    campaigns.forEach(campaign => {
      if (campaign.campaignRequirement?.country) {
        console.log(`Campaign ${campaign.id} (${campaign.name}) requires country: ${campaign.campaignRequirement.country}`);
      } else {
        console.log(`Campaign ${campaign.id} (${campaign.name}) has no country requirement`);
      }
    });
    
    // TEMPORARILY BYPASS COUNTRY FILTERING - Show all campaigns to creators
    // This ensures creators can see all available campaigns while we fix country detection
    console.log('TEMPORARILY BYPASSING COUNTRY FILTERING - Showing all campaigns to creators');
    
    const afterCountryFilterCount = campaigns.length;
    console.log(`Country filtering bypassed: ${afterCountryFilterCount}/${beforeCountryFilterCount} campaigns remain (no filtering applied)`);
    
    // TODO: Re-enable proper country filtering once country detection is working correctly
    // Original filtering logic should be:
    // campaigns = campaigns.filter((campaign) => {
    //   if (!campaign.campaignRequirement?.country) return true;
    //   if (!country) return true;
    //   return campaign.campaignRequirement.country.toLowerCase().trim() === country.toLowerCase().trim();
    // });

    // campaigns = campaigns.filter((campaign) => campaign.campaignBrief.)

    const calculateInterestMatchingPercentage = (creatorInterests: Interest[], creatorPerona: []) => {
      const totalInterests = creatorPerona.length;

      const matchingInterests = creatorInterests.filter((interest) =>
        creatorPerona.includes(interest?.name?.toLowerCase() as never),
      ).length;

      return (matchingInterests / totalInterests) * 100;
    };

    const calculateRequirementMatchingPercentage = (creator: Creator, campaignRequirements: CampaignRequirement) => {
      let matches = 0;
      let totalCriteria = 0;

      function isAgeInRange(age: any, ranges: any) {
        for (const range of ranges) {
          const [min, max] = range.split('-').map(Number);
          if (age >= min && age <= max) {
            return true;
          }
        }
        return false;
      }

      // Age
      const creatorAge = dayjs().diff(dayjs(creator.birthDate), 'year');
      if (campaignRequirements?.age) {
        totalCriteria++;
        if (isAgeInRange(creatorAge, campaignRequirements.age)) {
          matches++;
        }
      }

      // Gender
      const creatorGender =
        creator.pronounce === 'he/him' ? 'male' : creator.pronounce === 'she/her' ? 'female' : 'nonbinary';
      if (campaignRequirements?.gender) {
        totalCriteria++;
        if (campaignRequirements.gender.includes(creatorGender)) {
          matches++;
        }
      }

      // Language
      const creatorLang: any = creator.languages;
      if (campaignRequirements?.language.length) {
        totalCriteria++;
        if (campaignRequirements.language.map((item: any) => creatorLang.includes(item))) {
          matches++;
        }
      }

      return (matches / totalCriteria) * 100;
    };

    const calculateOverallMatchingPercentage = (
      interestMatch: number,
      requirementMatch: number,
      interestWeight = 0.5,
      requirementWeight = 0.5,
    ) => {
      return interestMatch * interestWeight + requirementMatch * requirementWeight;
    };

    const matchedCampaignWithPercentage = campaigns.map((item) => {
      const interestPercentage = calculateInterestMatchingPercentage(
        user?.creator?.interests as never,
        item.campaignRequirement?.creator_persona as any,
      );

      const requirementPercentage = calculateRequirementMatchingPercentage(
        user?.creator as Creator,
        item.campaignRequirement as CampaignRequirement,
      );

      const overallMatchingPercentage = calculateOverallMatchingPercentage(interestPercentage, requirementPercentage);

      return {
        ...item,
        percentageMatch: overallMatchingPercentage,
      };
    });

    // Keep the original order from database (newest first) instead of overriding
    const sortedMatchedCampaigns = matchedCampaignWithPercentage;

    const lastCursor = campaigns.length > Number(take) - 1 ? campaigns[Number(take) - 1]?.id : null;

    const data = {
      data: {
        campaigns: sortedMatchedCampaigns,
      },
      metaData: {
        lastCursor: lastCursor,
        hasNextPage: true,
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllActiveCampaign = async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        shortlisted: true,
        submission: true,
        logistic: true,
      },
    });

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getAllCampaignsFinance = async (req: Request, res: Response) => {
  const { userid } = req.session;
  const user = await prisma.user.findUnique({
    where: {
      id: userid,
    },
  });

  // if (user?.role !== 'finance') {
  //   return res.status(401).json({ message: 'Unauthorized' });
  // }

  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: true,
        campaignSubmissionRequirement: true,
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    // industries: true,
                    interests: true,
                  },
                },
              },
            },
          },
        },
        shortlisted: {
          select: {
            user: {
              include: {
                creator: true,
              },
            },
            userId: true,
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
      },
    });
    //console.log(campaigns);
    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const creatorMakePitch = async (req: Request, res: Response) => {
  const { campaignId, content, type } = req.body;
  const id = req.session.userid;
  let pitch;

  try {
    // Get campaign to check origin
    const campaignWithOrigin = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaignWithOrigin) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const isPitchExist = await prisma.pitch.findUnique({
      where: {
        userId_campaignId: {
          userId: id as string,
          campaignId: campaignId,
        },
      },
    });

    // Determine initial status based on campaign origin
    const initialStatus = campaignWithOrigin.origin === 'CLIENT' ? 'PENDING_REVIEW' : 'undecided';

    if (isPitchExist) {
      if (isPitchExist.type === 'text') {
        pitch = await prisma.pitch.update({
          where: {
            id: isPitchExist.id,
          },
          data: {
            type: 'text',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: initialStatus,
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      }
    } else {
      if (type === 'video') {
        pitch = await prisma.pitch.create({
          data: {
            type: 'video',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: initialStatus,
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      } else {
        pitch = await prisma.pitch.create({
          data: {
            type: 'text',
            content: content,
            userId: id as string,
            campaignId: campaignId,
            status: initialStatus,
          },
          include: {
            campaign: true,
            user: true,
          },
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        pitch: true,
        campaignAdmin: true,
      },
    });

    if (pitch) {
      // Log the pitch submission in campaign logs for Creator Activities tab
      const creatorName = user?.name || 'Unknown Creator';
      const campaignName = campaign?.name || 'Unknown Campaign';
      const logMessage = `${creatorName} pitched for ${campaignName}`;
      await logChange(logMessage, campaignId, req);

      const notification = notificationPitch(pitch.campaign.name, 'Creator');
      const newPitch = await saveNotification({
        userId: user?.id as string,
        message: notification.message,
        title: notification.title,
        entity: 'Pitch',
        entityId: campaign?.id as string,
        pitchId: pitch.id,
      });

      io.to(clients.get(user?.id)).emit('notification', newPitch);

      const admins = campaign?.campaignAdmin;

      const notificationAdmin = notificationPitch(pitch.campaign.name, 'Admin', pitch.user.name as string);

      admins?.map(async ({ adminId }) => {
        const notification = await saveNotification({
          userId: adminId as string,
          message: notificationAdmin.message,
          title: notificationAdmin.title,
          entity: 'Pitch',
          entityId: campaign?.id as string,
        });

        io.to(clients.get(adminId)).emit('notification', notification);
      });
    }

    return res.status(202).json({ message: 'Pitch submitted successfully!' });
  } catch (error) {
    return res.status(400).json({ message: 'Error! Please try again.' });
  }
};

export const getAllPitches = async (req: Request, res: Response) => {
  const userId = req.session.userid;

  try {
    // Get user role for role-based status display
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const pitches = await prisma.pitch.findMany({
      include: {
        campaign: true,
        user: true,
        admin: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!pitches || pitches.length === 0) {
      return res.status(404).json({ message: 'No pitches found.' });
    }

    // Transform pitches to show role-based status for client-created campaigns and filter for clients
    const transformedPitches = pitches
      .filter((pitch) => {
        // For clients: only show pitches that are SENT_TO_CLIENT or APPROVED
        // Hide pitches with PENDING_REVIEW status (admin review stage)
        if (user?.role === 'client' && pitch.campaign.origin === 'CLIENT') {
          return pitch.status === 'SENT_TO_CLIENT' || pitch.status === 'APPROVED';
        }
        // For admin and creators: show all pitches
        return true;
      })
      .map((pitch) => {
        let displayStatus = pitch.status;

        if (pitch.campaign.origin === 'CLIENT' && user) {
          // Role-based status display logic for client-created campaigns
          if (user.role === 'admin' || user.role === 'superadmin') {
            // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
            displayStatus = pitch.status;
          } else if (user.role === 'client') {
            // Client sees: SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
            if (pitch.status === 'SENT_TO_CLIENT') {
              displayStatus = 'PENDING_REVIEW';
            }
          } else if (user.role === 'creator') {
            // Creator sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
            if (pitch.status === 'SENT_TO_CLIENT') {
              displayStatus = 'PENDING_REVIEW';
            }
          }
        }

        return {
          ...pitch,
          displayStatus,
        };
      });

    return res.status(200).json({ pitches: transformedPitches });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

export const getAllCreatorAgreements = async (req: Request, res: Response) => {
  try {
    // Fetch all creator agreements with related User, Campaign, and Admin information
    const creatorAgreements = await prisma.creatorAgreement.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        admin: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const formattedCreatorAgreements = creatorAgreements.map((agreement) => ({
      id: agreement.id,
      agreementUrl: agreement.agreementUrl,
      createdAt: agreement.createdAt,
      completedAt: agreement.completedAt,
      turnaroundTime: agreement.completedAt
        ? Math.round((new Date(agreement.completedAt).getTime() - new Date(agreement.createdAt).getTime()) / 1000) // Calculate turnaround time in seconds
        : null,
      user: agreement.user,
      campaign: agreement.campaign,
      approvedByAdmin: agreement.admin?.user,
    }));

    // Return the formatted creator agreements
    return res.status(200).json(formattedCreatorAgreements);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

export const getCampaignsByCreatorId = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    const shortlisted = await prisma.shortListedCreator.findMany({
      where: {
        userId: userid,
      },
    });

    const campaignShortlistedIds = shortlisted.map((item: any) => item.campaignId);

    const campaigns = await Promise.all(
      campaignShortlistedIds.map(async (id) => {
        const campaign = await prisma.campaign.findUnique({
          where: {
            id: id,
          },
          include: {
            creatorAgreement: true,
            logistic: true,
            company: true,
            brand: { include: { company: { include: { subscriptions: true } } } },
            campaignBrief: true,
            campaignRequirement: true,
            campaignTimeline: true,
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    role: true,
                  },
                },
              },
            },
            campaignClients: {
              include: {
                client: {
                  include: {
                    user: true,
                    company: true,
                  },
                },
              },
            },
            shortlisted: true,
          },
        });

        return { ...campaign };
      }),
    );

    return res.status(200).json({ campaigns });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const changeCampaignStage = async (req: Request, res: Response) => {
  const { status } = req.body;
  const { campaignId } = req.params;
  const adminId = req.session.userid;

  let updatedCampaign: any;
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: { select: { startDate: true } },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    if (dayjs(campaign.campaignBrief?.startDate).isAfter(dayjs(), 'date')) {
      updatedCampaign = await prisma.campaign.update({
        where: {
          id: campaignId,
        },
        data: {
          status: 'SCHEDULED',
        },
        include: {
          campaignAdmin: true,
          shortlisted: {
            include: {
              user: true,
            },
          },
        },
      });
    } else {
      updatedCampaign = await prisma.campaign.update({
        where: {
          id: campaignId,
        },
        data: {
          status: status,
        },
        include: {
          campaignAdmin: true,
          shortlisted: {
            include: {
              user: true,
            },
          },
        },
      });
    }

    if (updatedCampaign?.status === 'PAUSED' && adminId) {
      const adminLogMessage = `Paused the campaign - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    if (updatedCampaign?.shortlisted.length > 0 && updatedCampaign?.status === 'PAUSED') {
      updatedCampaign?.shortlisted?.map(async (value: { userId: string }) => {
        const { title, message } = notificationMaintenance(updatedCampaign.name);

        const data = await saveNotification({
          userId: value.userId as string,
          title: title,
          message: message,
          entity: 'Status',
          entityId: updatedCampaign.id,
        });
        io.to(clients.get(value.userId)).emit('notification', data);
      });
    }

    if (updatedCampaign?.status === 'ACTIVE') {
      for (const admin of updatedCampaign.campaignAdmin) {
        const { title, message } = notificationCampaignLive(updatedCampaign.name);

        const data = await saveNotification({
          userId: admin.adminId,
          title: title,
          message: message,
          entity: 'Status',
          entityId: updatedCampaign.id,
        });
        io.to(clients.get(admin.adminId)).emit('notification', data);
      }
    }

    if (updatedCampaign?.status === 'ACTIVE') {
      const adminLogMessage = `Resumed the campaign - ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    io.emit('campaignStatus', updatedCampaign);

    return res.status(200).json({ message: 'Campaign stage changed successfully.', status: updatedCampaign?.status });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const closeCampaign = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: {
        status: 'COMPLETED',
      },
      include: {
        campaignAdmin: true,
      },
    });
    campaign.campaignAdmin.forEach(async (item) => {
      const data = await saveNotification({
        userId: item.adminId,
        message: `${campaign.name} is close on ${dayjs().format('ddd LL')}`,
        entity: 'Campaign',
        entityId: campaign.id,
      });
      io.to(clients.get(item.adminId)).emit('notification', data);
    });

    if (adminId) {
      const adminLogMessage = `Closed campaign ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Campaign closed successfully.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getPitchById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.session.userid;

  try {
    // Get user role for role-based status display
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const pitch = await prisma.pitch.findUnique({
      where: {
        id: id,
      },
      include: {
        user: {
          include: {
            creator: {
              include: {
                // industries: true,
                interests: true,
              },
            },
          },
        },
        campaign: true,
      },
    });

    if (!pitch) {
      return res.status(400).json({ message: 'Pitch not found.' });
    }

    // For clients: only allow access to pitches that are SENT_TO_CLIENT or APPROVED
    // Hide pitches with PENDING_REVIEW status (admin review stage)
    if (user?.role === 'client' && pitch.campaign.origin === 'CLIENT' && pitch.status === 'PENDING_REVIEW') {
      return res.status(403).json({ message: 'Access denied. This pitch is still under admin review.' });
    }

    // Add role-based status display for client-created campaigns
    let displayStatus = pitch.status;

    if (pitch.campaign.origin === 'CLIENT' && user) {
      // Role-based status display logic for client-created campaigns
      if (user.role === 'admin' || user.role === 'superadmin') {
        // Admin sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> SENT_TO_CLIENT, APPROVED -> APPROVED
        displayStatus = pitch.status;
      } else if (user.role === 'client') {
        // Client sees: SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
        if (pitch.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        }
      } else if (user.role === 'creator') {
        // Creator sees: PENDING_REVIEW -> PENDING_REVIEW, SENT_TO_CLIENT -> PENDING_REVIEW, APPROVED -> APPROVED
        if (pitch.status === 'SENT_TO_CLIENT') {
          displayStatus = 'PENDING_REVIEW';
        }
      }
    }

    return res.status(200).json({
      pitch: {
        ...pitch,
        displayStatus,
      },
    });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignInfo = async (req: Request, res: Response) => {
  const { id, name, description, campaignInterests, campaignIndustries, isKWSPCampaign } = req.body;
  const adminId = req.session.userid;
  try {
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: {
        name: name,
        description: description,
        isKWSPCampaign,
      },
    });

    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: id,
      },
      data: {
        // interests: campaignInterests,
        industries: campaignIndustries,
      },
    });

    const message = 'Updated campaign information';
    logChange(message, id, req);

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';

    // Log admin activity for editing campaign details
    const adminActivityMessage = `${adminName} edited the Campaign Details`;
    await logChange(adminActivityMessage, id, req);

    if (adminId) {
      const adminLogMessage = `Updated campaign info for campaign - ${name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: message, ...updatedCampaign, ...updatedCampaignBrief });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignBrandOrCompany = async (req: Request, res: Response) => {
  const {
    id,
    // `campaignBrand.id` can be either a brand ID or company ID
    campaignBrand,
  } = req.body;

  try {
    // If `null`, then `campaignBrand.id` is a company ID
    const brand = await prisma.brand.findUnique({
      where: {
        id: campaignBrand.id,
      },
    });
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: brand
        ? {
            brandId: campaignBrand.id,
            companyId: null,
          }
        : {
            brandId: null,
            companyId: campaignBrand.id,
          },
    });

    const message = `Updated ${brand ? 'brand' : 'company'}`;
    logChange(message, updatedCampaign.id, req);

    const adminId = req.session.userid;
    if (adminId) {
      const adminLogMessage = `Updated ${brand ? 'brand' : 'company'}`;
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: message, ...updatedCampaign });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignDosAndDonts = async (req: Request, res: Response) => {
  const { campaignId, campaignDo, campaignDont } = req.body;

  try {
    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: campaignId,
      },
      data: {
        campaigns_do: campaignDo,
        campaigns_dont: campaignDont,
      },
    });

    const message = "Dos and don'ts updated successfully.";
    logChange(message, campaignId, req);
    const adminId = req.session.userid;
    if (adminId) {
      const adminLogMessage = "Updated do's and don'ts.";
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: message, ...updatedCampaignBrief });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignRequirements = async (req: Request, res: Response) => {
  const {
    campaignId,
    audienceGender,
    audienceAge,
    audienceLocation,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    country,
  } = req.body;

  try {
    const updatedCampaignRequirement = await prisma.campaignRequirement.update({
      where: {
        campaignId: campaignId,
      },
      data: {
        gender: audienceGender,
        age: audienceAge,
        geoLocation: audienceLocation,
        language: audienceLanguage,
        creator_persona: audienceCreatorPersona,
        user_persona: audienceUserPersona,
        country: country,
      },
      include: {
        campaign: { select: { name: true } },
      },
    });

    const message = 'Updated campaign requirements';
    logChange(message, campaignId, req);

    const adminmessage = `Update Campaign requirements for campaign - ${updatedCampaignRequirement.campaign.name} `;
    const adminId = req.session.userid;
    logAdminChange(adminmessage, adminId, req);

    return res.status(200).json({ message: message, newRequirement: updatedCampaignRequirement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignTimeline = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { timeline, campaignStartDate, campaignEndDate } = req.body;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignTimeline: true,
        campaignBrief: true,
        campaignAdmin: true,
        campaignTasks: true,
        shortlisted: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    if (dayjs(campaignStartDate).isAfter(dayjs(), 'date') && campaign.shortlisted.length > 0) {
      return res
        .status(404)
        .json({ message: 'Failed to change campaign start date because there is existing shortlisted creators.' });
    }

    for (const [index, item] of timeline.entries()) {
      let submissionType;

      if (item.timeline_type.name === 'Agreement') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'AGREEMENT_FORM',
          },
        });
      } else if (item.timeline_type.name === 'First Draft') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'FIRST_DRAFT',
          },
        });
      } else if (item.timeline_type.name === 'Final Draft') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'FINAL_DRAFT',
          },
        });
      } else if (item.timeline_type.name === 'Posting') {
        submissionType = await prisma.submissionType.findFirst({
          where: {
            type: 'POSTING',
          },
        });
      }

      await prisma.campaignTimeline.upsert({
        where: {
          id: item?.id || item?.timeline_type.id,
        },
        update: {
          name: item?.timeline_type.name,
          for: item?.for,
          duration: parseInt(item.duration),
          startDate: dayjs(item?.startDate) as any,
          endDate: dayjs(item?.endDate) as any,
          campaignId: campaign?.id,
          order: index + 1,
          submissionTypeId: submissionType?.id,
        },
        create: {
          name: item?.timeline_type.name,
          for: item?.for,
          duration: parseInt(item.duration),
          startDate: dayjs(item?.startDate) as any,
          endDate: dayjs(item?.endDate) as any,
          campaignId: campaign?.id,
          order: index + 1,
          submissionTypeId: submissionType?.id,
        },
      });
    }

    // const data = await Promise.all(
    //   timeline.map(async (item: any, index: number) => {
    //     const result = await prisma.campaignTimeline.upsert({
    //       where: {
    //         id: item?.id || item?.timeline_type.id,
    //       },
    //       update: {
    //         name: item?.timeline_type.name,
    //         for: item?.for,
    //         duration: parseInt(item.duration),
    //         startDate: dayjs(item?.startDate) as any,
    //         endDate: dayjs(item?.endDate) as any,
    //         campaignId: campaign?.id,
    //         order: index + 1,
    //       },
    //       create: {
    //         name: item?.timeline_type.name,
    //         for: item?.for,
    //         duration: parseInt(item.duration),
    //         startDate: dayjs(item?.startDate) as any,
    //         endDate: dayjs(item?.endDate) as any,
    //         campaignId: campaign?.id,
    //         order: index + 1,
    //       },
    //       include: {
    //         campaignTasks: true,
    //       },
    //     });
    //     return result;
    //   }),
    // );

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        startDate: dayjs(campaignStartDate).format(),
        endDate: dayjs(campaignEndDate).format(),
      },
    });

    const message = 'Updated timeline';
    logChange(message, id, req);

    const adminId = req.session.userid;
    if (adminId) {
      const adminLogMessage = `Updated timeline for ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }
    return res.status(200).json({ message: message });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const changePitchStatus = async (req: Request, res: Response) => {
  const { status, pitchId, totalUGCVideos } = req.body;
  const adminId = req.session.userid;

  try {
    const existingPitch = await prisma.pitch.findUnique({
      where: {
        id: pitchId,
      },
      include: {
        campaign: {
          include: {
            campaignBrief: true,
          },
        },
        user: {
          include: {
            paymentForm: true,
            creator: true,
          },
        },
      },
    });

    if (!existingPitch) {
      return res.status(404).json({ message: 'Pitch not found.' });
    }

    if (!existingPitch.user.creator?.isFormCompleted)
      return res.status(404).json({ message: 'Payment form not completed.' });

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = existingPitch.user.name || 'Creator';

    if (status === 'approved') {
      // Log admin activity for pitch approval
      const adminActivityMessage = `${adminName} approved ${creatorName}'s pitch`;
      await logChange(adminActivityMessage, existingPitch.campaignId, req);

      await prisma.$transaction(
        async (tx) => {
          const pitch = await prisma.pitch.update({
            where: {
              id: existingPitch.id,
            },
            data: {
              status: status,
              completedAt: status === 'approved' ? new Date() : null,
              approvedByAdminId: adminId,
            },
            include: {
              campaign: {
                include: {
                  campaignBrief: true,
                },
              },
            },
          });

          await tx.creatorAgreement.create({
            data: {
              userId: existingPitch.userId,
              campaignId: existingPitch.campaignId,
              agreementUrl: '',
            },
          });

          await tx.shortListedCreator.create({
            data: {
              userId: pitch?.userId,
              campaignId: pitch?.campaignId,
              ugcVideos: totalUGCVideos ? parseInt(totalUGCVideos) : null,
            },
          });

          const timelines = await tx.campaignTimeline.findMany({
            where: {
              AND: [
                {
                  campaignId: pitch?.campaignId,
                },
                {
                  for: 'creator',
                },
                {
                  name: {
                    not: 'Open For Pitch',
                  },
                },
              ],
            },
            include: {
              submissionType: true,
            },
            orderBy: {
              order: 'asc',
            },
          });

          const board = await tx.board.findUnique({
            where: {
              userId: existingPitch.userId,
            },
            include: {
              columns: true,
            },
          });

          if (!board) {
            throw new Error('Board not found.');
          }

          const columnToDo = await tx.columns.findFirst({
            where: {
              AND: [
                { boardId: board?.id },
                {
                  name: {
                    contains: 'To Do',
                  },
                },
              ],
            },
          });

          const columnInProgress = await tx.columns.findFirst({
            where: {
              AND: [
                { boardId: board?.id },
                {
                  name: {
                    contains: 'In Progress',
                  },
                },
              ],
            },
          });

          if (!columnToDo || !columnInProgress) {
            throw new Error('Column not found.');
          }

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: SubmissionWithRelations[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: timeline.campaignId,
                  userId: pitch.userId as string,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          const agreement = submissions.find((submission) => submission?.submissionType.type === 'AGREEMENT_FORM');
          const draft = submissions.find((submission) => submission?.submissionType.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((submission) => submission?.submissionType.type === 'FINAL_DRAFT');
          const posting = submissions.find((submission) => submission?.submissionType.type === 'POSTING');

          // Might change in the future
          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ];

          const filteredDependencies = dependencies.filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          await tx.submissionDependency.createMany({
            data: filteredDependencies,
          });

          // Sending email
          const user = existingPitch.user;
          const campaignName = existingPitch?.campaign?.name;
          const campaignId = existingPitch?.campaign?.id;
          const creatorName = existingPitch?.user?.name;

          const image: any = pitch?.campaign?.campaignBrief?.images;

          shortlisted(user.email, campaignName, creatorName ?? 'Creator', campaignId, image[0]);

          const message = `Approved a sent pitch by  ${existingPitch.user.name} in campaign - ${pitch.campaign.name} `;
          logAdminChange(message, adminId, req);

          const data = await saveNotification({
            userId: pitch.userId,
            entityId: pitch.campaign.id as string,
            title: "✅ You're shorlisted!",
            message: `Congratulations! You've been shortlisted for the ${pitch.campaign.name} campaign.`,
            entity: 'Shortlist',
          });

          const socketId = clients.get(pitch.userId);

          if (socketId) {
            io.to(socketId).emit('notification', data);
            io.to(socketId).emit('shortlisted', {
              message: 'shortlisted',
              campaignId: pitch.campaign.id,
              campaignName: pitch.campaign.name,
            });
          }

          // Fetching admins for the campaign
          const admins = await tx.campaignAdmin.findMany({
            where: {
              campaignId: pitch.campaignId,
            },
            include: {
              admin: {
                include: {
                  user: true,
                },
              },
            },
          });

          // Send notifications to each admin
          for (const admin of admins) {
            const { title, message } = notificationPendingAgreement(pitch.campaign.name);
            const notification = await saveNotification({
              userId: admin.adminId,
              title: title,
              message: message,
              entity: 'Pitch',
              creatorId: pitch.userId,
              entityId: pitch.campaignId,
            });

            const adminSocketId = clients.get(admin.admin.userId);
            if (adminSocketId) {
              io.to(adminSocketId).emit('notification', notification);
            }
          }

          const campaign = await tx.campaign.findUnique({
            where: {
              id: pitch.campaignId,
            },
            include: {
              thread: true,
            },
          });

          if (!campaign || !campaign.thread) {
            return res.status(404).json({ message: 'Campaign or thread not found.' });
          }

          const isThreadExist = await tx.userThread.findFirst({
            where: {
              threadId: campaign.thread.id,
              userId: pitch.userId,
            },
          });

          if (!isThreadExist) {
            await tx.userThread.create({
              data: {
                threadId: campaign.thread.id,
                userId: pitch.userId,
              },
            });
          }
        },
        {
          timeout: 20000,
        },
      );
    } else {
      // Log admin activity for pitch rejection
      const adminActivityMessage = `${adminName} rejected ${creatorName}'s pitch`;
      await logChange(adminActivityMessage, existingPitch.campaignId, req);

      const pitch = await prisma.pitch.update({
        where: {
          id: existingPitch.id,
        },
        data: {
          status: status,
        },
        include: {
          campaign: {
            include: {
              campaignBrief: true,
            },
          },
        },
      });

      const isExist = await prisma.shortListedCreator.findUnique({
        where: {
          userId_campaignId: {
            userId: pitch?.userId,
            campaignId: pitch?.campaignId,
          },
        },
      });

      if (isExist) {
        await prisma.shortListedCreator.delete({
          where: {
            userId_campaignId: {
              userId: pitch?.userId,
              campaignId: pitch?.campaignId,
            },
          },
        });
      }

      const submissions = await prisma.submission.findMany({
        where: {
          AND: [
            {
              userId: pitch.userId,
            },
            {
              campaignId: pitch.campaignId,
            },
          ],
        },
        include: {
          dependentOn: true,
          task: true,
        },
      });

      await prisma.submission.deleteMany({
        where: {
          AND: [
            {
              campaignId: pitch.campaignId,
            },
            {
              userId: pitch.userId,
            },
          ],
        },
      });

      const board = await prisma.board.findUnique({
        where: {
          userId: pitch?.userId,
        },
        include: {
          columns: {
            include: {
              task: true,
            },
          },
        },
      });

      if (board) {
        await prisma.task.deleteMany({
          where: {
            column: {
              boardId: board.id,
            },
          },
        });
      }

      // const toDoColumn = board.columns.find((item) => item.name === 'To Do');
      // const inProgressColumn = board.columns.find((item) => item.name === 'In Progress');

      //   for (const submission of submissions) {
      //     // const task = toDoColumn?.task.find((item) => item.submissionId === submission.id);

      //     await prisma.task.delete({
      //       where: {
      //         id: submission.task?.id,
      //       },
      //     });
      //   }
      // }

      const agreement = await prisma.creatorAgreement.findFirst({
        where: {
          AND: [{ userId: pitch.userId }, { campaignId: pitch.campaignId }],
        },
      });

      if (agreement) {
        await prisma.creatorAgreement.delete({
          where: {
            id: agreement.id,
          },
        });
      }
      const message = `Rejected a pitch sent by  ${existingPitch.user.name} for campaign - ${pitch.campaign.name} `;
      logAdminChange(message, adminId, req);
    }

    io.to(clients.get(existingPitch.userId)).emit('pitchUpdate');

    return res.status(200).json({ message: 'Successfully changed.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getCampaignForCreatorById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userid } = req.session as any;
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        logistic: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
                role: true,
              },
            },
          },
        },
        campaignClients: {
          include: {
            client: {
              include: {
                user: true,
                company: true,
              },
            },
          },
        },
        campaignTimeline: {
          where: {
            AND: [
              { for: 'creator' },
              {
                name: {
                  not: 'Open For Pitch',
                },
              },
            ],
          },
        },
        campaignBrief: true,
        campaignRequirement: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        shortlisted: true,
        invoice: true,
        submission: {
          where: {
            userId: userid,
          },
          include: {
            submissionType: true,
          },
        },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'No campaign found.' });

    const agreement = await prisma.creatorAgreement.findUnique({
      where: {
        userId_campaignId: {
          userId: userid,
          campaignId: id,
        },
      },
    });

    const submissions = campaign.submission;
    let completed = 0;
    let totalSubmissions = 0;

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

    const adjustedData = {
      ...campaign,
      totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
      // totalCompletion:
      //   (campaign.submission.filter(
      //     (submission) =>
      //       submission.userId === userid &&
      //       (submission.status === 'APPROVED' ||
      //         submission.submissionType.type === 'FIRST_DRAFT' ||
      //         submission.status === 'CHANGES_REQUIRED'),
      //   ).length /
      //     campaign.submission.filter((submission) => submission.userId === userid).length) *
      //     100 || null,
    };

    // const adjustedCampaigns = campaigns.map((campaign) => {
    //   const submissions = campaign.submission;
    //   let completed = 0;
    //   let totalSubmissions = 0;

    //   submissions?.forEach((submission) => {
    //     if (
    //       submission.status === 'APPROVED' ||
    //       (submission.submissionType?.type === 'FIRST_DRAFT' && submission.status === 'CHANGES_REQUIRED')
    //     ) {
    //       completed++;
    //     }
    //   });

    //   const isChangesRequired =
    //     campaign.submission.find((submission) => submission.submissionType.type === 'FIRST_DRAFT')?.status ===
    //     'CHANGES_REQUIRED';

    //   totalSubmissions = campaign.campaignType === 'ugc' ? (isChangesRequired ? 3 : 2) : isChangesRequired ? 4 : 3;

    //   return {
    //     ...campaign,
    //     pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
    //     shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
    //     creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
    //     submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
    //     totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
    //   };
    // });

    return res.status(200).json({ ...adjustedData, agreement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getCampaignPitchForCreator = async (req: Request, res: Response) => {
  const userid = req.session.userid;

  try {
    const campaings = await prisma.pitch.findMany({
      where: {
        AND: [
          {
            userId: userid,
          },
          {
            AND: [
              {
                status: {
                  not: 'approved',
                },
              },
              {
                status: {
                  not: 'rejected',
                },
              },
            ],
          },
        ],
      },
      include: {
        campaign: {
          include: {
            campaignRequirement: true,
            campaignAdmin: true,
            company: true,
            brand: { include: { company: { include: { subscriptions: true } } } },
            campaignBrief: {
              select: {
                images: true,
                interests: true,
              },
            },
            pitch: true,
            shortlisted: true,
          },
        },
      },
    });
    return res.status(200).json(campaings);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getSubmission = async (req: Request, res: Response) => {
  const { userId, campaignId, submissionTypeId } = req.query;

  try {
    const submission = await prisma.submission.findMany({
      where: {
        userId: userId as string,
        campaignId: campaignId as string,
      },
      include: {
        submissionType: {
          select: {
            type: true,
          },
        },
      },
    });

    return res.status(200).json(submission);
  } catch (error) {
    return res.status(400).json(error);
  }
};

// export const editCampaign = async (req: Request, res: Response) => {
//   const { id, name, desc, brief, admin } = req.body;
//   try {
//     const updatedCampaign = await prisma.campaign.update({
//       where: { id: id },
//       data: {
//         name: name,
//         description: desc,
//         campaignBrief: brief,
//         campaignAdmin: admin,
//       },
//     });
//     return res.status(200).json({ message: 'Succesfully updated', ...updatedCampaign });
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };

export const getCampaignLog = async (req: Request, res: Response) => {
  //console.log('=== BEGIN getCampaignLog ===');
  //console.log(req.params);
  //console.log('=== END getCampaignLog ===');

  const { id } = req.params;

  try {
    const campaignLog = await prisma.campaignLog.findMany({
      where: {
        campaignId: id,
      },
    });
    return res.status(200).json(campaignLog);
  } catch (error) {
    // TODO TEMP
    //console.log('=== BEGIN getCampaignLog error ===');
    //console.log(error);
    //console.log('=== END getCampaignLog error ===');
  }
};

export const uploadVideoTest = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  const { userid } = req.session;

  const fileName = `${userid}_${campaignId}_pitch.mp4`;

  try {
    if (!(req.files as any).pitchVideo) {
      return res.status(404).json({ message: 'Pitch Video not found.' });
    }

    const file = (req.files as any).pitchVideo;

    console.log(file);

    const filePath = `/tmp/${fileName}`;
    const compressedFilePath = `/tmp/${userid}_compressed.mp4`;

    await file.mv(filePath);

    const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
    const channel = await amqp.createChannel();
    // await channel.assertQueue('pitch', { durable: true });

    // channel.sendToQueue(
    //   'pitch',
    //   Buffer.from(
    //     JSON.stringify({
    //       tempPath: filePath,
    //       outputPath: compressedFilePath,
    //       userId: userid,
    //       campaignId: campaignId,
    //       fileName: fileName,
    //     }),
    //   ),
    //   {
    //     persistent: true,
    //   },
    // );

    // await channel.close();
    // await amqp.close();

    try {
      await channel.assertQueue('pitch', { durable: true });

      channel.sendToQueue(
        'pitch',
        Buffer.from(
          JSON.stringify({
            tempPath: filePath,
            outputPath: compressedFilePath,
            userId: userid,
            campaignId: campaignId,
            fileName: fileName,
          }),
        ),
        { persistent: true },
      );

      return res.status(200).json({ message: 'Pitch video started processing' });
    } catch (queueError) {
      return res.status(500).json({ message: 'Failed to send message to queue.', error: queueError });
    } finally {
      await channel.close();
      await amqp.close();
    }

    return res.status(200).json({ message: 'Pitch video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const saveCampaign = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  const userid = req.session.userid;

  try {
    const bookmark = await prisma.bookMarkCampaign.create({
      data: {
        userId: userid as string,
        campaignId: campaignId as string,
      },
      include: {
        campaign: true,
      },
    });

    return res.status(200).json({ message: `Campaign ${bookmark.campaign?.name} has been bookmarked.` });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const unSaveCampaign = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const bookmark = await prisma.bookMarkCampaign.delete({
      where: {
        id: id as string,
      },
      include: {
        campaign: true,
      },
    });

    return res
      .status(200)
      .json({ message: `Campaign ${bookmark.campaign?.name} has been removed from your saved campaigns.` });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createLogistics = async (req: Request, res: Response) => {
  const {
    data: { trackingNumber, itemName, courier, otherCourier },
    campaignId,
    creatorId: userId,
  } = req.body;

  const adminId = req.session.userid;

  try {
    const logistic = await prisma.logistic.create({
      data: {
        trackingNumber: trackingNumber,
        itemName: itemName,
        courier: courier === 'Other' ? otherCourier : courier,
        campaignId: campaignId as string,
        userId: userId as string,
      },
      include: {
        user: true,
        campaign: {
          include: {
            campaignBrief: true,
          },
        },
      },
    });

    const image: any = logistic?.campaign?.campaignBrief?.images;

    //Email for tracking logistics
    tracking(
      logistic.user.email,
      logistic.campaign.name,
      logistic.user.name ?? 'Creator',
      logistic.trackingNumber,
      logistic.campaignId,
      image[0],
    );

    const { title, message } = notificationLogisticTracking(logistic.campaign.name, logistic.trackingNumber);

    const notification = await saveNotification({
      userId: userId,
      title,
      message,
      // message: `Hi ${logistic.user.name}, your logistics details for the ${logistic.campaign.name} campaign are now available. Please check the logistics section for shipping information and tracking details. If you have any questions, don't hesitate to reach out!`,
      entity: 'Logistic',
    });

    io.to(clients.get(userId)).emit('notification', notification);

    const adminLogMessage = `Created New Logistic for campaign - ${logistic.campaign.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Logistics created successfully.' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const getLogisticById = async (req: Request, res: Response) => {
  try {
    const logistics = await prisma.logistic.findMany();
    return res.status(200).json(logistics);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateStatusLogistic = async (req: Request, res: Response) => {
  // eslint-disable-next-line prefer-const
  let { logisticId, status } = req.body;
  const adminId = req.session.userid;

  if (status === 'Pending Delivery Confirmation') {
    status = status.split(' ').join('_');
  }
  try {
    const updated = await prisma.logistic.update({
      where: {
        id: logisticId,
      },
      data: {
        status: status as LogisticStatus,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        campaign: {
          select: {
            name: true,
            campaignBrief: {
              select: {
                images: true,
              },
            },
          },
        },
      },
    });

    const images: any = updated.campaign.campaignBrief?.images;

    if (status === 'Product_has_been_received') {
      // Call deliveryConfirmation function
      deliveryConfirmation(
        updated.user.email,
        updated.campaign.name,
        updated.user.name ?? 'Creator',
        updated.campaignId,
        images[0],
      );

      // Create and send the notification
      const { title, message } = notificationLogisticDelivery(updated.campaign.name);
      const notification = await saveNotification({
        userId: updated.userId,
        title,
        message,
        entity: 'Logistic',
      });

      io.to(clients.get(updated.userId)).emit('notification', notification);
    }

    // // deliveryConfirmation
    // deliveryConfirmation(updated.user.email, updated.campaign.name, updated.user.name ?? 'Creator', updated.campaignId);

    // const { title, message } = notificationLogisticDelivery(updated.campaign.name,);

    // const notification = await saveNotification({
    //   userId: updated.userId,
    //   title,
    //   message,
    //   entity: 'Logistic',
    // });

    // io.to(clients.get(updated.userId)).emit('notification', notification);

    const adminLogMessage = `Updated Logistic status for campaign - ${updated.campaign.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Logistic status updated successfully.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const shortlistCreator = async (req: Request, res: Response) => {
  const { newVal: creators, campaignId } = req.body;

  const adminId = req.session.userid;

  try {
    await prisma.$transaction(
      async (tx) => {
        try {
          const campaign = await tx.campaign.findUnique({
            where: { id: campaignId },
            include: { thread: true, campaignBrief: true },
          });

          if (!campaign) throw new Error('Campaign not found.');

          const timelines = await tx.campaignTimeline.findMany({
            where: {
              campaignId: campaign.id,
              for: 'creator',
              name: { not: 'Open For Pitch' },
            },
            include: { submissionType: true },
            orderBy: { order: 'asc' },
          });

          // Fetch all creators in one query
          const creatorIds = creators.map((c: any) => c.id);

          const creatorData = await tx.user.findMany({
            where: { id: { in: creatorIds } },
            include: { creator: true, paymentForm: true },
          });

          // Bulk create agreements
          await tx.creatorAgreement.createMany({
            data: creatorData.map((creator) => ({
              userId: creator.id,
              campaignId: campaign.id,
              agreementUrl: '',
            })),
          });

          // Bulk create shortlisted creators
          const shortlistedCreators = await tx.shortListedCreator.createMany({
            data: creatorData.map((creator) => ({
              userId: creator.id,
              campaignId,
              amount: 0,
              currency: 'MYR',
            })),
          });

          // Fetch all boards in one query
          const boards = await tx.board.findMany({
            where: { userId: { in: creatorIds } },
            include: { columns: true },
          });

          for (const creator of creatorData) {
            const board = boards.find((b) => b.userId === creator.id);
            if (!board) throw new Error(`Board not found for user ${creator.id}`);

            const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
            const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
            if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

            type SubmissionWithRelations = Submission & {
              submissionType: SubmissionType;
            };

            const submissions: any[] = await Promise.all(
              timelines.map(async (timeline, index) => {
                return await tx.submission.create({
                  data: {
                    dueDate: timeline.endDate,
                    campaignId: campaign.id,
                    userId: creator.id as string,
                    // status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
                    status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                    submissionTypeId: timeline.submissionTypeId as string,
                    task: {
                      create: {
                        name: timeline.name,
                        position: index,
                        columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                        priority: '',
                        status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                      },
                    },
                  },
                  include: {
                    submissionType: true,
                  },
                });
              }),
            );

            // Create dependencies
            const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
            const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
            const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
            const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

            const dependencies = [
              { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
              { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
              { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
            ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

            if (dependencies.length) await tx.submissionDependency.createMany({ data: dependencies });
          }

          // Notify admins & creators
          const admins = await tx.campaignAdmin.findMany({
            where: { campaignId },
            include: { admin: { include: { user: true } } },
          });

          for (const creator of creatorData) {
            const notification = await saveNotification({
              userId: creator.id,
              entityId: campaignId,
              message: `Congratulations! You've been shortlisted for the ${campaign.name} campaign.`,
              entity: 'Shortlist',
            });

            const image: any = campaign.campaignBrief?.images;
            shortlisted(creator.email, campaign.name, creator.name ?? 'Creator', campaign.id, image[0]);

            const socketId = clients.get(creator.id);
            if (socketId) {
              io.to(socketId).emit('notification', notification);
              // Emit shortlisted event with campaign data for popup
              io.to(socketId).emit('shortlisted', {
                message: 'shortlisted',
                campaignId: campaign.id,
                campaignName: campaign.name,
              });
            }

            if (!campaign.thread) throw new Error('Campaign thread not found');

            const isThreadExist = await tx.userThread.findFirst({
              where: {
                threadId: campaign.thread.id,
                userId: creator.id as string,
              },
            });

            if (!isThreadExist) {
              await tx.userThread.create({
                data: {
                  threadId: campaign.thread.id,
                  userId: creator.id as string,
                },
              });
            }
          }
        } catch (error) {
          console.error('Transaction error:', error);
          throw error;
        }
      },
      { timeout: 10000 },
    );

    const adminLogMessage = `Creator Shortlisted for Campaign - ${campaignId.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Successfully shortlisted' });
  } catch (error) {
    console.log('SHORTLIST ERROR', error);
    return res.status(400).json(error);
  }
};

export const receiveLogistic = async (req: Request, res: Response) => {
  const { logisticId } = req.body;
  try {
    await prisma.logistic.update({
      where: {
        id: logisticId,
      },
      data: {
        status: 'Product_has_been_received',
      },
    });

    return res.status(200).json({ message: 'Item has been successfully delivered.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const creatorAgreements = async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  try {
    const agreements = await prisma.creatorAgreement.findMany({
      where: {
        campaignId: campaignId,
      },
      include: {
        user: {
          include: {
            creator: true,
            paymentForm: true,
            shortlisted: {
              where: {
                campaignId: campaignId,
              },
            },
          },
        },
      },
    });

    return res.status(200).json(agreements);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateAmountAgreement = async (req: Request, res: Response) => {
  try {
    const { paymentAmount, currency, user, campaignId, id: agreementId, isNew } = JSON.parse(req.body.data);

    console.log('Received update data:', { paymentAmount, currency, campaignId, agreementId, isNew });

    const creator = await prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        paymentForm: true,
        creator: true,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Get current agreement amount for comparison
    let currentAgreement = null;
    if (isNew) {
      // For V3: Find by userId and campaignId
      currentAgreement = await prisma.creatorAgreement.findUnique({
        where: {
          userId_campaignId: {
            userId: creator.id,
            campaignId: campaignId,
          },
        },
      });
    } else if (agreementId) {
      // For V2: Find by id
      currentAgreement = await prisma.creatorAgreement.findUnique({
        where: { id: agreementId },
      });
    }

    // Get admin info for logging
    const adminId = req.session.userid;
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = creator.name || 'Creator';

    // Update shortlisted creator first
    await prisma.shortListedCreator.updateMany({
      where: {
        userId: creator.id,
        campaignId: campaignId,
      },
      data: {
        amount: parseInt(paymentAmount),
        currency: currency,
      },
    });

    let url = '';
    if (req?.files && (req?.files as any)?.agreementForm) {
      // Generate and upload new agreement file
      url = await uploadAgreementForm(
        (req?.files as any)?.agreementForm.tempFilePath,
        `${creator.id}-${campaign.name}-${Date.now()}.pdf`,
        'creatorAgreements',
      );
    }

    // Handle V3 agreement creation or V2 agreement update
    let updatedAgreement;

    if (isNew) {
      // For V3: Get the campaign's agreement template URL if no new file was uploaded
      let finalAgreementUrl = url;
      if (!url) {
        // Get the campaign with its agreement template
        const campaignWithTemplate = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { agreementTemplate: true },
        });
        finalAgreementUrl = campaignWithTemplate?.agreementTemplate?.url || '';
      }

      // For V3: Create or update CreatorAgreement using upsert
      updatedAgreement = await prisma.creatorAgreement.upsert({
        where: {
          userId_campaignId: {
            userId: creator.id,
            campaignId: campaignId,
          },
        },
        update: {
          agreementUrl: finalAgreementUrl, // Use template URL if no new file
          amount: paymentAmount,
          currency: currency,
          isSent: false, // Not sent yet
        },
        create: {
          userId: creator.id,
          campaignId: campaignId,
          agreementUrl: finalAgreementUrl, // Use template URL if no new file
          amount: paymentAmount,
          currency: currency,
          isSent: false, // Not sent yet
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
              shortlisted: {
                where: {
                  campaignId: campaignId,
                },
              },
            },
          },
        },
      });

      // Update pitch status to AGREEMENT_PENDING for V3
      await prisma.pitch.updateMany({
        where: {
          userId: creator.id,
          campaignId: campaignId,
          status: 'APPROVED',
        },
        data: {
          status: 'AGREEMENT_PENDING',
        },
      });
    } else {
      // For V2: Update existing CreatorAgreement
      updatedAgreement = await prisma.creatorAgreement.update({
        where: {
          id: agreementId,
        },
        data: {
          userId: creator.id,
          campaignId: campaignId,
          ...(url && { agreementUrl: url }), // Only update URL if new file was uploaded
          updatedAt: dayjs().format(),
          amount: paymentAmount,
          currency: currency,
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
              shortlisted: {
                where: {
                  campaignId: campaignId,
                },
              },
            },
          },
        },
      });
    }

    // Log admin activity for amount change if amount was actually changed (not just set for the first time)
    if (currentAgreement && currentAgreement.amount && currentAgreement.amount !== paymentAmount) {
      const oldAmount = currentAgreement.amount;
      const newAmount = paymentAmount;
      const oldCurrency = currentAgreement.currency || 'MYR'; // Get the previous currency
      const newCurrency = currency; // Use the new currency from the request

      // Get currency symbol based on currency code
      const getCurrencySymbol = (currencyCode: string) => {
        switch (currencyCode) {
          case 'SGD':
          case 'AUD':
          case 'USD':
            return '$';
          case 'MYR':
            return 'RM';
          case 'JPY':
            return '¥';
          case 'IDR':
            return 'Rp';
          default:
            return 'RM'; // Default fallback
        }
      };

      const oldCurrencySymbol = getCurrencySymbol(oldCurrency);
      const newCurrencySymbol = getCurrencySymbol(newCurrency);
      const adminActivityMessage = `${adminName} changed the amount from ${oldCurrencySymbol}${oldAmount} to ${newCurrencySymbol}${newAmount} on the Agreement for ${creatorName}`;
      await logChange(adminActivityMessage, campaignId, req);
    }

    console.log('Updated agreement:', updatedAgreement);

    return res.status(200).json({
      message: 'Agreement updated successfully',
      agreement: updatedAgreement,
    });
  } catch (error) {
    console.error('Error in updateAmountAgreement:', error);
    return res.status(500).json({ message: 'Error updating agreement', error: error.message });
  }
};

export const sendAgreement = async (req: Request, res: Response) => {
  const { user, id: agreementId, campaignId, isNew } = req.body;

  const adminId = req.session.userid;
  
  console.log('[sendAgreement] Request received:', {
    userId: user?.id,
    agreementId,
    campaignId,
    isNew: !!isNew,
    adminId
  });

  try {
    const isUserExist = await prisma.user.findUnique({
      where: {
        id: user?.id,
      },
      include: {
        creator: true,
      },
    });

    if (!isUserExist) {
      console.log('[sendAgreement] User not found:', user?.id);
      return res.status(404).json({ message: 'Creator not exist' });
    }
    
    console.log('[sendAgreement] User found:', { id: isUserExist.id, name: isUserExist.name });

    let agreement;

    // Handle V3 agreements (client-created campaigns)
    if (isNew) {
      // For V3: Find agreement by userId and campaignId
      agreement = await prisma.creatorAgreement.findUnique({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaignId,
          },
        },
      });
    } else {
      // For V2: Find agreement by id
      agreement = await prisma.creatorAgreement.findUnique({
        where: {
          id: agreementId,
        },
      });
    }

    if (!agreement) {
      console.log('[sendAgreement] Agreement not found for:', { userId: user?.id, campaignId, isNew });
      return res.status(404).json({ message: 'Agreement not found.' });
    }
    
    console.log('[sendAgreement] Agreement found:', { id: agreement.id, isSent: agreement.isSent });

    // update the status of agreement
    if (isNew) {
      // For V3: Update by userId and campaignId
      await prisma.creatorAgreement.update({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaignId,
          },
        },
        data: {
          isSent: true,
          completedAt: new Date(),
          approvedByAdminId: adminId,
        },
      });
    } else {
      // For V2: Update by id
      await prisma.creatorAgreement.update({
        where: {
          id: agreement.id,
        },
        data: {
          isSent: true,
          completedAt: new Date(),
          approvedByAdminId: adminId,
        },
      });
    }

    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: {
        AND: [
          {
            userId: isUserExist.id,
          },
          {
            campaignId: campaignId,
          },
        ],
      },
    });

    if (!shortlistedCreator) {
      return res.status(404).json({ message: 'This creator is not shortlisted.' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      select: {
        name: true,
        agreementTemplate: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    // update shortlisted creator table
    await prisma.shortListedCreator.update({
      where: {
        id: shortlistedCreator.id,
      },
      data: {
        isAgreementReady: true,
      },
    });

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = isUserExist.name || 'Creator';

    // Log admin activity for sending agreement
    const adminActivityMessage = `${adminName} sent the Agreement to ${creatorName}`;
    await logChange(adminActivityMessage, campaignId, req);

    if (adminId) {
      const adminLogMessage = `Sent Agreement  to ${user.name} in campaign - ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    const { title, message } = notificationSignature(campaign.name);

    const notification = await saveNotification({
      userId: isUserExist.id,
      title: title,
      message: message,
      entity: 'Agreement',
      entityId: campaignId,
    });

    const socketId = clients.get(isUserExist.id);

    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(clients.get(isUserExist.id)).emit('agreementReady');
    }

    console.log('[sendAgreement] Agreement sent successfully');
    return res.status(200).json({ message: 'Agreement has been sent.' });
  } catch (error) {
    console.error('[sendAgreement] Error:', error);
    return res.status(400).json(error);
  }
};

export const editCampaignImages = async (req: Request, res: Response) => {
  const { campaignImages, campaignId } = req.body;
  const newImages: string[] = [];
  const adminId = req.session.userid;

  try {
    const newCampaignImages = (req.files as any)?.campaignImages;

    const campaign = await prisma.campaignBrief.findFirst({
      where: {
        campaignId: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign Not Found.' });
    }

    if (!newCampaignImages && !campaignImages) {
      return res.status(404).json({ message: "Campaign image can't be empty." });
    }

    if (newCampaignImages) {
      if (newCampaignImages?.length) {
        for (const item of newCampaignImages as any) {
          const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
          newImages.push(url);
        }
      } else {
        const images = newCampaignImages;
        const url = await uploadImage(images.tempFilePath, images.name, 'campaign');
        newImages.push(url);
      }

      if (campaignImages) {
        newImages.push(campaignImages);
      }

      // const adminLogMessage = `Added A New Campaign Image To - ${campaign.title}`;
      // logAdminChange(adminLogMessage, adminId, req);

      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [newImages].flat(),
        },
      });
    } else {
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [campaignImages].flat(),
        },
      });
    }

    if (adminId) {
      const adminLogMessage = `Updated Campaign Images In ${campaign.title} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Image are updated.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const draftPitch = async (req: Request, res: Response) => {
  const { content, userId, campaignId } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const pitch = await prisma.pitch.findFirst({
      where: {
        AND: [{ userId: user?.id }, { campaignId: campaign?.id }],
      },
    });

    if (!pitch) {
      await prisma.pitch.create({
        data: {
          userId: user?.id,
          campaignId: campaign?.id,
          content: content,
          status: 'draft',
          type: 'text',
        },
      });
    } else {
      await prisma.pitch.update({
        where: {
          id: pitch?.id,
        },
        data: {
          content: content,
        },
      });
    }

    return res.status(200).json({ message: 'Pitch has been saved as draft.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// For creator
export const getMyCampaigns = async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        pitch: true,
        shortlisted: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const campaigns = await prisma.campaign.findMany({
      where: {
        OR: [
          {
            shortlisted: {
              some: {
                userId: user.id,
              },
            },
          },
          {
            pitch: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
      include: {
        logistic: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        invoice: true,
        shortlisted: {
          where: {
            userId: user.id,
          },
        },
        pitch: {
          where: {
            userId: user.id,
          },
        },
        campaignBrief: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
                role: true,
              },
            },
          },
        },
        campaignRequirement: true,

        creatorAgreement: {
          where: {
            userId: user.id,
          },
        },
        submission: {
          where: {
            userId: user.id,
          },
          include: {
            submissionType: true,
            dependencies: true,
            dependentOn: true,
          },
        },
        campaignTimeline: {
          where: {
            AND: [
              { for: 'creator' },
              {
                name: {
                  not: 'Open For Pitch',
                },
              },
            ],
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Sort by newest first to match discover page
      },
    });

    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };
    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };
    // const checkCondition = (submission: any) => {
    //   console.log(submission);
    //   if (submission.userId === user.id) {
    //     return submission;
    //     // if (
    //     //   // (submission.submissionType.type === 'FIRST_DRAFT' &&
    //     //   //   (submission.status === 'APPROVED' || submission.status === 'CHANGES_REQUIRED')) ||
    //     //   submission.status === 'APPROVED'
    //     // ) {
    //     //   return submission;
    //     // }
    //   }
    // };

    // const adjustedCampaigns = campaigns.map((campaign) => ({
    //   ...campaign,
    //   pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
    //   shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
    //   creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
    //   submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
    //   totalCompletion:
    //     (campaign.submission.filter(
    //       (submission) =>
    //         submission.userId === userId &&
    //         (submission.status === 'APPROVED' ||
    //           submission.submissionType.type === 'FIRST_DRAFT' ||
    //           submission.status === 'CHANGES_REQUIRED'),
    //     ).length /
    //       campaign.submission.filter((submission) => submission.userId === user.id).length) *
    //       100 || null,
    // }));

    const adjustedCampaigns = campaigns.map((campaign) => {
      const submissions = campaign.submission;
      let completed = 0;
      let totalSubmissions = 0;

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

      return {
        ...campaign,
        pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
        shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
        creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
        submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
        totalCompletion: ((completed / totalSubmissions) * 100).toFixed(),
      };
    });

    return res.status(200).json(adjustedCampaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const removePitchVideo = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.body;

  try {
    const fileName = `${userId}_${campaignId}_pitch.mp4`;

    await deleteContent({ folderName: 'pitchVideo', fileName: fileName });

    return res.status(200).json({ message: 'Pitch video is removed.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignAdmin = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  const {
    data: { admins },
  } = req.body;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
        thread: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const adjustedAdmins: any = await Promise.all(
      admins.map(async (admin: any) => {
        const data = await prisma.admin.findFirst({
          where: {
            userId: admin.id,
          },
        });
        return data;
      }),
    );

    const existingAdmins = await prisma.campaignAdmin.findMany({
      where: {
        campaignId: campaign.id,
      },
      select: {
        admin: {
          select: { userId: true },
        },
      },
    });

    const filteredExistingAdmins = existingAdmins.map((item) => item?.admin?.userId); //map to admin id

    const newAdmins: any[] = admins.filter((admin: { id: string }) => !filteredExistingAdmins.includes(admin.id));

    const removedAdmins: any[] = existingAdmins.filter((admin) =>
      admins.every((item: any) => item.id !== admin.admin.userId),
    );

    await prisma.campaignAdmin.deleteMany({
      where: {
        campaignId: campaign?.id,
      },
    });

    await prisma.campaign.update({
      where: {
        id: campaign?.id,
      },
      data: {
        campaignAdmin: {
          create: adjustedAdmins.map((admin: any) => ({
            adminId: admin.userId,
          })),
        },
      },
    });

    if (newAdmins.length > 0) {
      newAdmins.forEach(async (admin) => {
        await prisma.userThread.create({
          data: {
            userId: admin.id,
            threadId: campaign.thread?.id!,
          },
        });
      });
    }

    if (removedAdmins.length > 0) {
      removedAdmins.forEach(async (admin) => {
        await prisma.userThread.delete({
          where: {
            userId_threadId: {
              userId: admin.admin.userId,
              threadId: campaign?.thread?.id!,
            },
          },
        });
      });
    }

    if (adminId) {
      const adminLogMessage = `Updated Admins list in ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const editCampaignClients = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  const {
    data: { clients },
  } = req.body;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignClients: true,
        thread: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const adjustedClients: any = await Promise.all(
      clients.map(async (client: any) => {
        const data = await prisma.client.findFirst({
          where: {
            userId: client.id,
          },
        });
        return data;
      }),
    );

    const existingClients = await prisma.campaignClient.findMany({
      where: {
        campaignId: campaign.id,
      },
      select: {
        client: {
          select: { userId: true },
        },
      },
    });

    const filteredExistingClients = existingClients.map((item) => item?.client?.userId); //map to client id

    const newClients: any[] = clients.filter((client: { id: string }) => !filteredExistingClients.includes(client.id));

    const removedClients: any[] = existingClients.filter((client) =>
      clients.every((item: any) => item.id !== client.client.userId),
    );

    await prisma.campaignClient.deleteMany({
      where: {
        campaignId: campaign?.id,
      },
    });

    // Also remove removed clients from campaignAdmin
    if (removedClients.length > 0) {
      const removedClientUserIds = removedClients.map(client => client.client.userId);
      await prisma.campaignAdmin.deleteMany({
        where: {
          campaignId: campaign?.id,
          adminId: {
            in: removedClientUserIds,
          },
        },
      });
    }

    await prisma.campaign.update({
      where: {
        id: campaign?.id,
      },
      data: {
        campaignClients: {
          create: adjustedClients.map((client: any) => ({
            clientId: client.id,
          })),
        },
      },
    });

    // Also add clients to campaignAdmin so they can access the campaign
    const clientAdminEntries = adjustedClients.map((client: any) => ({
      adminId: client.userId,
      campaignId: campaign?.id,
    }));

    await prisma.campaignAdmin.createMany({
      data: clientAdminEntries,
      skipDuplicates: true, // Skip if already exists
    });

    if (newClients.length > 0) {
      newClients.forEach(async (client) => {
        await prisma.userThread.create({
          data: {
            userId: client.id,
            threadId: campaign.thread?.id!,
          },
        });
      });
    }

    if (removedClients.length > 0) {
      removedClients.forEach(async (client) => {
        await prisma.userThread.delete({
          where: {
            userId_threadId: {
              userId: client.client.userId,
              threadId: campaign?.thread?.id!,
            },
          },
        });
      });
    }

    if (adminId) {
      const adminLogMessage = `Updated Clients list in ${campaign.name} `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const debugV3Submissions = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log(`[debugV3Submissions] Debugging submissions for campaign: ${id}`);
    
    // Get all submission types
    const allSubmissionTypes = await prisma.submissionType.findMany();
    console.log(`[debugV3Submissions] All submission types:`, allSubmissionTypes);
    
    // Get campaign with submissions and creator agreements
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        submission: {
          include: {
            submissionType: true,
            user: { select: { id: true, name: true } }
          }
        },
        shortlisted: {
          include: {
            user: { select: { id: true, name: true } }
          }
        },
        creatorAgreement: {
          include: {
            user: { select: { id: true, name: true } }
          }
        }
      },
    });
    
    console.log(`[debugV3Submissions] Campaign submissions:`, campaign?.submission);
    console.log(`[debugV3Submissions] Campaign shortlisted:`, campaign?.shortlisted);
    console.log(`[debugV3Submissions] Creator agreements:`, campaign?.creatorAgreement);
    
    return res.status(200).json({
      campaignId: id,
      campaignOrigin: campaign?.origin,
      campaignStatus: campaign?.status,
      campaignName: campaign?.name,
      allSubmissionTypes: allSubmissionTypes.map(st => ({ id: st.id, type: st.type })),
      existingSubmissions: campaign?.submission?.map(s => ({
        id: s.id,
        userId: s.userId,
        userName: s.user?.name,
        submissionType: s.submissionType?.type,
        status: s.status
      })),
      shortlistedCreators: campaign?.shortlisted?.map(sc => ({
        userId: sc.userId,
        userName: sc.user?.name
      })),
      creatorAgreements: campaign?.creatorAgreement?.map(ca => ({
        id: ca.id,
        userId: ca.userId,
        userName: ca.user?.name,
        isSent: ca.isSent,
        agreementUrl: ca.agreementUrl
      }))
    });
  } catch (error) {
    console.error('[debugV3Submissions] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

export const activateV3Campaign = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  try {
    console.log(`[activateV3Campaign] Activating V3 campaign: ${id}`);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, origin: true }
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    
    if (campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This is not a V3 campaign' });
    }

    console.log(`[activateV3Campaign] Current status: ${campaign.status}`);

    // Update campaign status to ACTIVE
    await prisma.campaign.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });

    if (adminId) {
      const adminLogMessage = `Activated V3 campaign ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    console.log(`[activateV3Campaign] Campaign activated successfully`);
    return res.status(200).json({ 
      message: 'V3 campaign activated successfully',
      previousStatus: campaign.status,
      newStatus: 'ACTIVE'
    });
  } catch (error) {
    console.error('[activateV3Campaign] Error:', error);
    return res.status(500).json({ 
      message: 'Failed to activate V3 campaign', 
      error: error.message 
    });
  }
};

export const fixV3Submissions = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  try {
    console.log(`[fixV3Submissions] Fixing missing submissions for V3 campaign: ${id}`);
    
    // First, let's check what submission types exist in the database
    const allSubmissionTypes = await prisma.submissionType.findMany();
    console.log(`[fixV3Submissions] All submission types in database:`, 
      allSubmissionTypes.map(st => ({ id: st.id, type: st.type })));

    // Get campaign with all related data
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        shortlisted: {
          include: {
            user: true,
          }
        },
        submission: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });
    
    if (campaign.origin !== 'CLIENT') {
      return res.status(400).json({ message: 'This is not a V3 campaign' });
    }

    console.log(`[fixV3Submissions] Campaign has ${campaign.shortlisted?.length || 0} shortlisted creators`);

    let createdSubmissions = 0;

    // Use transaction to ensure all changes are atomic
    await prisma.$transaction(async (tx) => {
      // For each shortlisted creator, ensure all submission types exist
      for (const shortlistedCreator of campaign.shortlisted || []) {
        const userId = shortlistedCreator.userId;
        
        console.log(`[fixV3Submissions] Processing creator: ${userId}`);

        // Get existing submissions for this creator
        const existingSubmissions = await tx.submission.findMany({
          where: {
            userId: userId as string,
            campaignId: campaign.id,
          }
        });

        console.log(`[fixV3Submissions] Found ${existingSubmissions.length} existing submissions for creator ${userId}`);

        // Get all required submission types
        const submissionTypes = await tx.submissionType.findMany({
          where: {
            type: {
              in: ['AGREEMENT_FORM', 'FIRST_DRAFT', 'FINAL_DRAFT', 'POSTING']
            }
          }
        });
        
        console.log(`[fixV3Submissions] Found ${submissionTypes.length} submission types:`, 
          submissionTypes.map(st => ({ id: st.id, type: st.type })));

        for (const submissionType of submissionTypes) {
          const existingSubmissionOfType = existingSubmissions.find(
            s => s.submissionTypeId === submissionType.id
          );
          
          console.log(`[fixV3Submissions] Checking ${submissionType.type}:`, {
            submissionTypeId: submissionType.id,
            existingSubmission: !!existingSubmissionOfType,
            existingSubmissionId: existingSubmissionOfType?.id
          });

          if (!existingSubmissionOfType) {
            let defaultStatus = 'NOT_STARTED';
            
            // Set appropriate statuses for missing submissions
            if (submissionType.type === 'AGREEMENT_FORM') {
              defaultStatus = 'APPROVED'; // They're already shortlisted
            } else if (submissionType.type === 'FIRST_DRAFT') {
              defaultStatus = 'IN_PROGRESS'; // Ready for first draft
            } else if (submissionType.type === 'FINAL_DRAFT') {
              defaultStatus = 'NOT_STARTED'; // Will be enabled after first draft approval
            } else if (submissionType.type === 'POSTING') {
              defaultStatus = 'NOT_STARTED'; // Will be enabled after final draft approval
            }
            
            console.log(`[fixV3Submissions] Creating missing ${submissionType.type} submission with status: ${defaultStatus}`);

            const newSubmission = await tx.submission.create({
              data: {
                userId: userId as string,
                campaignId: campaign.id,
                submissionTypeId: submissionType.id,
                status: defaultStatus as any,
              }
            });
            
            createdSubmissions++;
            console.log(`[fixV3Submissions] Created missing ${submissionType.type} submission: ${newSubmission.id}`);
          } else {
            console.log(`[fixV3Submissions] ${submissionType.type} submission already exists for creator ${userId}`);
          }
        }
      }

      console.log(`[fixV3Submissions] Fix completed successfully`);
    });

    if (adminId) {
      const adminLogMessage = `Fixed V3 submissions for campaign ${campaign.name} - created ${createdSubmissions} missing submissions`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ 
      message: 'V3 submissions fixed successfully',
      createdSubmissions,
      affectedCreators: campaign.shortlisted?.length || 0,
    });
  } catch (error) {
    console.error('[fixV3Submissions] Error during fix:', error);
    return res.status(500).json({ 
      message: 'Failed to fix V3 submissions', 
      error: error.message 
    });
  }
};

export const convertToV3 = async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = req.session.userid;

  try {
    console.log(`[convertToV3] Starting V2 to V3 conversion for campaign: ${id}`);

    // Get campaign with all related data
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        shortlisted: {
          include: {
            user: true,
          }
        },
        submission: true,
        creatorAgreement: true,
        pitch: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });
    
    if (campaign.origin === 'CLIENT') {
      return res.status(400).json({ message: 'Campaign is already V3' });
    }

    console.log(`[convertToV3] Campaign has ${campaign.shortlisted?.length || 0} shortlisted creators`);

    // Use transaction to ensure all changes are atomic
    await prisma.$transaction(async (tx) => {
      // 1. Update campaign origin to CLIENT (V3)
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { origin: 'CLIENT' },
      });
      console.log(`[convertToV3] Updated campaign origin to CLIENT`);

      // 2. For each shortlisted creator, create V3 pitch records
      for (const shortlistedCreator of campaign.shortlisted || []) {
        const userId = shortlistedCreator.userId;
        
        console.log(`[convertToV3] Processing creator: ${userId}`);

        // Check if V3 pitch already exists
        const existingV3Pitch = await tx.pitch.findFirst({
          where: {
            userId: userId as string,
            campaignId: campaign.id,
            // V3 pitches typically have status that indicates they're part of V3 flow
          }
        });

        if (!existingV3Pitch) {
          // Create V3 pitch with AGREEMENT_SUBMITTED status since they're already shortlisted
          const v3Pitch = await tx.pitch.create({
            data: {
              userId: userId as string,
              campaignId: campaign.id,
              type: 'text', // Default type for V3
              content: 'Migrated from V2 campaign - creator was pre-approved',
              status: 'AGREEMENT_SUBMITTED', // They're already in the system
            }
          });
          console.log(`[convertToV3] Created V3 pitch for creator ${userId}: ${v3Pitch.id}`);
        } else {
          console.log(`[convertToV3] V3 pitch already exists for creator ${userId}`);
        }

        // 3. Migrate existing submissions to V3 compatible structure
        const existingSubmissions = await tx.submission.findMany({
          where: {
            userId: userId as string,
            campaignId: campaign.id,
          }
        });

        console.log(`[convertToV3] Found ${existingSubmissions.length} existing submissions for creator ${userId}`);

        // Update existing submissions to be V3 compatible if needed
        for (const submission of existingSubmissions) {
          // Ensure submissions are in correct status for V3 flow
          if (submission.status === 'APPROVED' || submission.status === 'COMPLETED') {
            // Keep as is - these are good states
            console.log(`[convertToV3] Keeping submission ${submission.id} status: ${submission.status}`);
          } else if (submission.status === 'PENDING_REVIEW') {
            // Keep as pending review
            console.log(`[convertToV3] Keeping submission ${submission.id} in PENDING_REVIEW`);
          } else if (submission.status === 'IN_PROGRESS' || submission.status === 'NOT_STARTED') {
            // These should remain as IN_PROGRESS for V3
            await tx.submission.update({
              where: { id: submission.id },
              data: { status: 'IN_PROGRESS' },
            });
            console.log(`[convertToV3] Updated submission ${submission.id} to IN_PROGRESS`);
          }
        }

        // 4. Create missing submissions for complete V3 flow - Enhanced version
        const submissionTypes = await tx.submissionType.findMany({
          where: {
            type: {
              in: ['AGREEMENT_FORM', 'FIRST_DRAFT', 'FINAL_DRAFT', 'POSTING']
            }
          }
        });

        console.log(`[convertToV3] Found ${submissionTypes.length} submission types:`, 
          submissionTypes.map(st => ({ id: st.id, type: st.type })));

        for (const submissionType of submissionTypes) {
          const existingSubmissionOfType = existingSubmissions.find(
            s => s.submissionTypeId === submissionType.id
          );

          console.log(`[convertToV3] Checking ${submissionType.type}:`, {
            submissionTypeId: submissionType.id,
            existingSubmission: !!existingSubmissionOfType,
            existingSubmissionId: existingSubmissionOfType?.id
          });

          if (!existingSubmissionOfType) {
            let defaultStatus = 'NOT_STARTED';
            
            // For already shortlisted creators, we assume they've completed agreement
            if (submissionType.type === 'AGREEMENT_FORM') {
              defaultStatus = 'APPROVED';
            } else if (submissionType.type === 'FIRST_DRAFT') {
              defaultStatus = 'IN_PROGRESS'; // Ready for first draft
            } else if (submissionType.type === 'FINAL_DRAFT') {
              defaultStatus = 'NOT_STARTED'; // Will be enabled after first draft approval
            } else if (submissionType.type === 'POSTING') {
              defaultStatus = 'NOT_STARTED'; // Will be enabled after final draft approval
            }
            
            console.log(`[convertToV3] Creating missing ${submissionType.type} submission with status: ${defaultStatus}`);

            const newSubmission = await tx.submission.create({
              data: {
                userId: userId as string,
                campaignId: campaign.id,
                submissionTypeId: submissionType.id,
                status: defaultStatus as any, // Cast to handle enum typing
              }
            });
            console.log(`[convertToV3] Created missing ${submissionType.type} submission: ${newSubmission.id} with status: ${defaultStatus}`);
          } else {
            console.log(`[convertToV3] ${submissionType.type} submission already exists for creator ${userId}`);
          }
        }

        // 5. Handle creator agreements - ensure they exist for V3
        const existingAgreement = campaign.creatorAgreement?.find(
          agreement => agreement.userId === userId
        );

        if (!existingAgreement) {
          // Create creator agreement record for V3 compatibility
          await tx.creatorAgreement.create({
            data: {
              userId: userId as string,
              campaignId: campaign.id,
              agreementUrl: '', // Will be filled when creator uploads
              isSent: false,
            }
          });
          console.log(`[convertToV3] Created creator agreement record for creator ${userId}`);
        }
      }

      console.log(`[convertToV3] Conversion completed successfully`);
    });

    if (adminId) {
      const adminLogMessage = `Converted campaign ${campaign.name} from V2 to V3 - migrated ${campaign.shortlisted?.length || 0} creators`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    // Count how many submissions were created during conversion
    const finalSubmissionCount = await prisma.submission.count({
      where: { campaignId: campaign.id }
    });

    return res.status(200).json({ 
      message: 'Campaign successfully converted to V3',
      migratedCreators: campaign.shortlisted?.length || 0,
      totalSubmissions: finalSubmissionCount,
      conversionComplete: true,
    });
  } catch (error) {
    console.error('[convertToV3] Error during conversion:', error);
    return res.status(500).json({ 
      message: 'Failed to convert campaign to V3', 
      error: error.message 
    });
  }
};

// Add client managers to a campaign and flip origin to CLIENT (V3)
export const addClientManagers = async (req: Request, res: Response) => {
  const adminId = req.session.userid;
  const { campaignId, clientManagers } = req.body as { campaignId: string; clientManagers: Array<{ id?: string; email?: string } | string> };

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    // Resolve client manager userIds
    const userIds: string[] = [];
    for (const cm of clientManagers || []) {
      const id = typeof cm === 'string' ? cm : cm?.id || '';
      if (id) {
        userIds.push(id);
        continue;
      }
      const email = typeof cm !== 'string' ? cm?.email : undefined;
      if (email) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) userIds.push(user.id);
      }
    }

    // Create campaignAdmin entries for these users
    for (const uid of userIds) {
      const exists = await prisma.campaignAdmin.findUnique({
        where: { adminId_campaignId: { adminId: uid, campaignId } },
      });
      if (!exists) {
        await prisma.campaignAdmin.create({ data: { adminId: uid, campaignId } });
      }
    }

    // Flip origin to CLIENT for v3 flow
    await prisma.campaign.update({ where: { id: campaignId }, data: { origin: 'CLIENT' } });

    if (adminId) {
      const adminLogMessage = `Added ${userIds.length} client manager(s) and converted campaign to V3`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Client managers added and campaign converted to V3.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignAttachments = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { otherAttachments: currentAttachments } = req.body;
  const otherAttachments: string[] = [];
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    if (req.files && req.files.otherAttachments) {
      const attachments: any = (req.files as any).otherAttachments as [];

      if (attachments.length) {
        for (const item of attachments as any) {
          const url: string = await uploadAttachments({
            tempFilePath: item.tempFilePath,
            fileName: item.name,
            folderName: 'otherAttachments',
          });
          otherAttachments.push(url);
        }
      } else {
        const url: string = await uploadAttachments({
          tempFilePath: attachments.tempFilePath,
          fileName: attachments.name,
          folderName: 'otherAttachments',
        });
        otherAttachments.push(url);
      }
    }

    if (currentAttachments) {
      if (Array.isArray(currentAttachments)) {
        otherAttachments.push(...currentAttachments);
      } else {
        otherAttachments.push(currentAttachments);
      }
    }

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        otherAttachments: otherAttachments,
      },
    });

    const adminLogMessage = `Updated Other Attachments in - ${campaign.name}`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createNewSpreadSheets = async (req: Request, res: Response) => {
  const { campaignId } = req.body;
  console.log(campaignId);
  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const url = await createNewSpreadSheet({ title: campaign.name });

    const data = await prisma.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        spreadSheetURL: url,
      },
    });

    return res.status(200).json({ message: 'Spreadsheet is created', url: data.spreadSheetURL });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignReference = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { referencesLinks } = req.body;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignAdmin: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        referencesLinks: referencesLinks?.map((link: any) => link.value) || [],
      },
    });

    if (adminId) {
      const Message = `Updated reference links in campaign - ${campaign.name}`;
      logAdminChange(Message, adminId, req);
    }
    return res.status(200).json({ message: 'Update Success.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const linkNewAgreement = async (req: Request, res: Response) => {
  const { template, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await prisma.campaign.update({
      where: {
        id: campaign.id,
      },
      data: {
        agreementTemplate: {
          connect: { id: template?.id },
        },
      },
    });

    if (adminId) {
      const adminLogMessage = `Linked/Updated Agreement to - "${campaign.name}" `;
      logAdminChange(adminLogMessage, adminId, req);
    }

    return res.status(200).json({ message: 'Successfully linked new agreeement' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

interface RequestQuery {
  status: string;
  page: number;
  limit: number;
  userId: string;
}

export const getAllCampaignsByAdminId = async (req: Request<RequestQuery>, res: Response) => {
  const { userId } = req.params;
  // const { status, limit = 9, cursor } = req.query;
  const { cursor, limit = 10, search, status } = req.query;
  console.log('getAllCampaignsByAdminId called with:', { userId, status, search, limit, cursor });

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        admin: {
          select: {
            mode: true,
            role: true,
          },
        },
        id: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (user.admin?.mode === 'god' || user.admin?.role?.name === 'CSL') {
      // Handle comma-separated status values
      let statusCondition = {};
      if (status) {
        const statusValues = (status as string).split(',');
        if (statusValues.length > 1) {
          statusCondition = {
            status: {
              in: statusValues as CampaignStatus[],
            },
          };
        } else {
          statusCondition = {
            status: statusValues[0] as CampaignStatus,
          };
        }
      }

      const campaigns: any = await prisma.campaign.findMany({
        take: Number(limit),
        ...(cursor && {
          skip: 1,
          cursor: { id: cursor as string },
        }),
        where: {
          AND: [
            statusCondition,
            {
              ...(search && {
                name: {
                  contains: search as string,
                  mode: 'insensitive',
                },
              }),
            },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          agreementTemplate: true,
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: { include: { company: { include: { subscriptions: true } } } },
          company: true,
          campaignTimeline: true,
          campaignBrief: true,
          campaignRequirement: true,
          campaignLogs: {
            include: {
              admin: true,
            },
          },
          campaignAdmin: {
            include: {
              admin: {
                include: {
                  user: {
                    include: {
                      agreementTemplate: true,
                    },
                  },
                },
              },
            },
          },
          campaignSubmissionRequirement: true,
          pitch: {
            include: {
              user: {
                include: {
                  creator: {
                    include: {
                      interests: true,
                    },
                  },

                  paymentForm: true,
                },
              },
            },
          },
          shortlisted: {
            select: {
              user: {
                include: {
                  creator: true,
                },
              },
              userId: true,
            },
          },
          campaignTasks: {
            include: {
              campaignTaskAdmin: true,
            },
          },
          logistic: {
            include: {
              user: true,
            },
          },
          creatorAgreement: true,
        },
      });

      const totalActiveCampaigns = campaigns.filter((campaign: Campaign) => campaign.status === 'ACTIVE').length;
      const totalComletedCampaigns = campaigns.filter((campaign: Campaign) => campaign.status === 'COMPLETED').length;

      if (campaigns.length == 0) {
        return res.status(200).json({
          data: {
            campaigns: [],
          },
          metaData: {
            lastCursor: null,
            hasNextPage: false,
          },
        });
      }

      const lastCursor = campaigns.length > Number(limit) - 1 ? campaigns[Number(limit) - 1].id : null;

      const data = {
        data: {
          campaigns,
          totalCampaigns: campaigns?.length,
          totalActiveCampaigns,
          totalComletedCampaigns,
        },
        metaData: {
          lastCursor: lastCursor,
        },
      };

      return res.status(200).json(data);
    }

    // Handle comma-separated status values for non-superadmin users
    let statusCondition = {};
    if (status) {
      const statusValues = (status as string).split(',');
      if (statusValues.length > 1) {
        statusCondition = {
          status: {
            in: statusValues as CampaignStatus[],
          },
        };
      } else {
        statusCondition = {
          status: statusValues[0] as CampaignStatus,
        };
      }
    }

    console.log('Non-superadmin user, status condition:', statusCondition);

    const campaigns = await prisma.campaign.findMany({
      take: Number(limit),
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor as string },
      }),
      where: {
        AND: [
          {
            campaignAdmin: {
              some: {
                adminId: user.id,
              },
            },
          },
          statusCondition,
          {
            ...(search && {
              name: {
                contains: search as string,
                mode: 'insensitive',
              },
            }),
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      // where: {
      //   ...(status
      //     ? {
      //         AND: [
      //           {
      //             campaignAdmin: {
      //               some: {
      //                 adminId: user.id,
      //               },
      //             },
      //           },
      //           {
      //             status: status as any,
      //           },
      //         ],
      //       }
      //     : {
      //         campaignAdmin: {
      //           some: {
      //             adminId: user.id,
      //           },
      //         },
      //       }),
      // },
      include: {
        agreementTemplate: true,
        submission: {
          include: {
            submissionType: true,
            dependencies: true,
          },
        },
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignLogs: {
          include: {
            admin: true,
          },
        },
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: {
                  include: {
                    agreementTemplate: true,
                  },
                },
              },
            },
          },
        },
        campaignSubmissionRequirement: true,
        pitch: {
          include: {
            user: {
              include: {
                creator: {
                  include: {
                    interests: true,
                  },
                },

                paymentForm: true,
              },
            },
          },
        },
        shortlisted: {
          select: {
            user: {
              include: {
                creator: true,
              },
            },
            userId: true,
          },
        },
        campaignTasks: {
          include: {
            campaignTaskAdmin: true,
          },
        },
        logistic: {
          include: {
            user: true,
          },
        },
        creatorAgreement: true,
      },
    });

    console.log(`Found ${campaigns.length} campaigns for non-superadmin user ${user.id}`);
    if (campaigns.length > 0) {
      console.log(
        'Campaign statuses:',
        campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      );
    }

    const totalActiveCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;

    const totalComletedCampaigns = campaigns.filter((campaign) => campaign.status === 'COMPLETED').length;

    if (campaigns.length == 0) {
      return res.status(200).json({
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      });
    }

    const lastCursor = campaigns.length > Number(limit) - 1 ? campaigns[Number(limit) - 1].id : null;

    const data = {
      data: {
        campaigns,
        totalCampaigns: campaigns?.length,
        totalActiveCampaigns,
        totalComletedCampaigns,
      },
      metaData: {
        lastCursor: lastCursor,
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const removeCreatorFromCampaign = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    console.log(`Attempting to remove creator ${creatorId} from campaign ${campaignId}`);

    const user = await prisma.user.findUnique({
      where: {
        id: creatorId,
      },
    });

    if (!user) return res.status(404).json({ message: 'No user found.' });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        thread: true,
        pitch: {
          where: {
            userId: creatorId,
          },
        },
      },
    });

    if (!campaign) return res.status(404).json({ message: 'No campaign found.' });

    const threadId = campaign?.thread?.id;
    console.log(`Found campaign: ${campaign.name}, thread ID: ${threadId}`);
    console.log(`Creator has ${campaign.pitch?.length || 0} pitches for this campaign`);

    await prisma.$transaction(async (tx) => {
      // First check if creator is shortlisted
      const shortlistedCreator = await tx.shortListedCreator.findFirst({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      console.log(`Shortlisted creator record found: ${!!shortlistedCreator}`);

      // If creator is shortlisted, handle that flow
      if (shortlistedCreator) {
        console.log(`Processing shortlisted creator: ${shortlistedCreator.id}`);

        if (shortlistedCreator.isCampaignDone && shortlistedCreator.ugcVideos) {
          await tx.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              creditsUtilized: {
                decrement: shortlistedCreator.ugcVideos!,
              },
              creditsPending: {
                increment: shortlistedCreator.ugcVideos!,
              },
            },
          });
          console.log(`Updated campaign credits for shortlisted creator`);
        }

        // Delete the shortlisted creator record
        await tx.shortListedCreator.delete({
          where: {
            id: shortlistedCreator.id,
          },
        });
        console.log(`Deleted shortlisted creator record`);
      }

      // Always delete these records regardless of shortlist status
      console.log(`Deleting creator's content and submissions for campaign`);

      // Delete videos
      const deletedVideos = await tx.video.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedVideos.count} videos`);

      // Delete photos
      const deletedPhotos = await tx.photo.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedPhotos.count} photos`);

      // Delete raw footage
      const deletedFootage = await tx.rawFootage.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedFootage.count} raw footage items`);

      // Delete submissions
      const deletedSubmissions = await tx.submission.deleteMany({
        where: {
          AND: [
            {
              userId: user.id,
            },
            {
              campaignId: campaign.id,
            },
          ],
        },
      });
      console.log(`Deleted ${deletedSubmissions.count} submissions`);

      // Delete pitches
      const deletedPitches = await tx.pitch.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });
      console.log(`Deleted ${deletedPitches.count} pitches`);

      // Delete user thread if it exists
      if (threadId) {
        try {
          await tx.userThread.delete({
            where: {
              userId_threadId: {
                userId: user.id,
                threadId: threadId!,
              },
            },
          });
          console.log(`Deleted user thread for creator`);
        } catch (error) {
          console.log('Error deleting user thread:', error);
          // Continue with other deletions even if this one fails
        }
      }

      // Delete creator agreement if it exists
      try {
        await tx.creatorAgreement.delete({
          where: {
            userId_campaignId: {
              userId: user.id,
              campaignId: campaign.id,
            },
          },
        });
        console.log(`Deleted creator agreement`);
      } catch (error) {
        console.log('Error deleting creator agreement:', error);
        // Continue with other deletions
      }

      // Delete invoice if it exists
      try {
        const invoice = await tx.invoice.findFirst({
          where: {
            AND: [
              {
                creatorId: user.id,
              },
              {
                campaignId: campaign.id,
              },
            ],
          },
          include: {
            creator: {
              include: {
                user: true,
              },
            },
          },
        });

        if (invoice) {
          await tx.invoice.delete({
            where: {
              id: invoice.id,
            },
          });

          // Remove the invoice deletion logging for withdrawal - it should not appear in Invoice Actions
          // const logMessage = `Deleted invoice ${invoice.invoiceNumber} for creator "${user.name}" during withdrawal from campaign`;
          // await logChange(logMessage, campaign.id, req);
        }
      } catch (error) {
        console.log('Error deleting invoice:', error);
      }

      const pitch = await tx.pitch.findFirst({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      if (pitch) {
        await tx.pitch.delete({ where: { id: pitch.id } });
      }
    });

    const adminLogMessage = `Withdrew Creator "${user.name}" From - ${campaign.name} `;
    logAdminChange(adminLogMessage, adminId, req);

    // Log the creator withdrawal in campaign logs
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    const adminName = admin?.name || 'Admin';
    const adminActivityMessage = `${adminName} withdrew ${user.name} from the campaign`;
    await logChange(adminActivityMessage, campaign.id, req);

    return res.status(200).json({ message: 'Successfully withdraw' });
  } catch (error) {
    console.log('Error removing creator from campaign:', error);
    return res.status(400).json({
      message: 'Failed to remove creator from campaign.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getCampaignsTotal = async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.count();
    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const shortlistCreatorV2 = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;

  console.log('shortlistCreatorV2 called with:', { creators, campaignId });

  try {
    await prisma.$transaction(async (tx) => {
      try {
        const campaign = await tx.campaign.findUnique({
          where: {
            id: campaignId,
          },
          include: {
            shortlisted: true,
            thread: true,
            campaignBrief: true,
          },
        });

        if (!campaign) throw new Error('Campaign not found');

        // Check if this is an admin-created campaign
        if (campaign.origin === 'CLIENT') {
          throw new Error(
            'This endpoint is for admin-created campaigns only. Use shortlistCreatorV2ForClient for client-created campaigns.',
          );
        }

        if (!campaign?.campaignCredits) throw new Error('Campaign is not assigned to any credits');

        const existingCreators = campaign.shortlisted.reduce((acc, creator) => acc + (creator.ugcVideos ?? 0), 0);

        const totalCreditsAssigned = creators.reduce(
          (acc: number, creator: { credits: number }) => acc + creator.credits,
          0,
        );

        if (totalCreditsAssigned > campaign.campaignCredits - existingCreators) throw new Error('Credits exceeded');

        const creatorIds = creators.map((c: any) => c.id);

        const creatorData = await tx.user.findMany({
          where: { id: { in: creatorIds } },
          include: { creator: true, paymentForm: true },
        });

        // await tx.campaign.update({
        //   where: {
        //     id: campaign.id,
        //   },
        //   data: {
        //     creditsUtilized: {
        //       increment: totalCreditsAssigned,
        //     },
        //     creditsPending: {
        //       decrement: totalCreditsAssigned,
        //     },
        //   },
        // });

        await tx.creatorAgreement.createMany({
          data: creatorData.map((creator) => ({
            userId: creator.id,
            campaignId: campaign.id,
            agreementUrl: '',
          })),
        });

        await tx.shortListedCreator.createMany({
          data: creators.map((creator: any) => ({
            userId: creator.id,
            campaignId,
            ugcVideos: creator.credits,
          })),
        });

        const boards = await tx.board.findMany({
          where: { userId: { in: creatorIds } },
          include: { columns: true },
        });

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            campaignId: campaign.id,
            for: 'creator',
            name: { not: 'Open For Pitch' },
          },
          include: { submissionType: true },
          orderBy: { order: 'asc' },
        });

        for (const creator of creatorData) {
          const board = boards.find((b) => b.userId === creator.id);
          if (!board) throw new Error(`Board not found for user ${creator.id}`);

          const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
          const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
          if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: any[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: campaign.id,
                  userId: creator.id as string,
                  // status: index === 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );

          // Create dependencies
          const agreement = submissions.find((s) => s.submissionType?.type === 'AGREEMENT_FORM');
          const draft = submissions.find((s) => s.submissionType?.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((s) => s.submissionType?.type === 'FINAL_DRAFT');
          const posting = submissions.find((s) => s.submissionType?.type === 'POSTING');

          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ].filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          if (dependencies.length) await tx.submissionDependency.createMany({ data: dependencies });
        }

        // Notify admins & creators
        const admins = await tx.campaignAdmin.findMany({
          where: { campaignId },
          include: { admin: { include: { user: true } } },
        });

        for (const creator of creatorData) {
          const notification = await saveNotification({
            userId: creator.id,
            entityId: campaignId,
            message: `Congratulations! You've been shortlisted for the ${campaign.name} campaign.`,
            entity: 'Shortlist',
          });

          const image: any = campaign.campaignBrief?.images;
          shortlisted(creator.email, campaign.name, creator.name ?? 'Creator', campaign.id, image[0]);

          const socketId = clients.get(creator.id);
          if (socketId) {
            io.to(socketId).emit('notification', notification);
            // Emit shortlisted event with campaign data for popup
            io.to(socketId).emit('shortlisted', {
              message: 'shortlisted',
              campaignId: campaign.id,
              campaignName: campaign.name,
            });
          }

          if (!campaign.thread) throw new Error('Campaign thread not found');

          const isThreadExist = await tx.userThread.findFirst({
            where: {
              threadId: campaign.thread.id,
              userId: creator.id as string,
            },
          });

          if (!isThreadExist) {
            await tx.userThread.create({
              data: {
                threadId: campaign.thread.id,
                userId: creator.id as string,
              },
            });
          }
        }
      } catch (error) {
        throw new Error(error);
      }
    });

    return res.status(200).json({ message: 'Successfully shortlisted creators' });
  } catch (error) {
    if (error?.message) {
      return res.status(400).json(error?.message);
    }
    return res.status(400).json(error);
  }
};

export const resendAgreement = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.body;
  const adminId = req.session.userid;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creator: true,
      },
    });

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        name: true,
        agreementTemplate: true,
      },
    });

    if (!user || !campaign) {
      return res.status(404).json({ message: 'User or campaign not found.' });
    }

    // Find the agreement
    const agreement = await prisma.creatorAgreement.findFirst({
      where: {
        userId: userId,
        campaignId: campaignId,
      },
    });

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found.' });
    }

    // Update the agreement status for resend
    await prisma.creatorAgreement.update({
      where: {
        id: agreement.id,
      },
      data: {
        isSent: true,
        completedAt: new Date(),
        approvedByAdminId: adminId,
      },
    });

    // Update shortlisted creator table
    const shortlistedCreator = await prisma.shortListedCreator.findFirst({
      where: {
        userId: userId,
        campaignId: campaignId,
      },
    });

    if (shortlistedCreator) {
      await prisma.shortListedCreator.update({
        where: {
          id: shortlistedCreator.id,
        },
        data: {
          isAgreementReady: true,
        },
      });
    }

    // Get admin info for logging
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
    });
    const adminName = admin?.name || 'Admin';
    const creatorName = user.name || 'Creator';

    // Log admin activity for resending agreement
    const adminActivityMessage = `${adminName} resent the Agreement to ${creatorName}`;
    await logChange(adminActivityMessage, campaignId, req);

    if (adminId) {
      const adminLogMessage = `Resent Agreement to ${user.name} in campaign - ${campaign.name}`;
      logAdminChange(adminLogMessage, adminId, req);
    }

    const { title, message } = notificationSignature(campaign.name);

    const notification = await saveNotification({
      userId: userId,
      title: title,
      message: message,
      entity: 'Agreement',
      entityId: campaignId,
    });

    const socketId = clients.get(userId);

    if (socketId) {
      io.to(socketId).emit('notification', notification);
      io.to(clients.get(userId)).emit('agreementReady');
    }

    return res.status(200).json({ message: 'Agreement resent successfully.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

// V3: Creator submits agreement for a client-origin campaign
export const submitAgreementV3 = async (req: Request, res: Response) => {
  const { pitchId } = req.params as { pitchId: string };
  const { agreementUrl } = req.body as { agreementUrl?: string };
  const userId = req.session.userid;

  try {
    console.log('[submitAgreementV3] start', { pitchId, userId, hasAgreementUrl: !!agreementUrl });
    const pitch = await prisma.pitch.findUnique({
      where: { id: pitchId },
      include: { campaign: true },
    });

    if (!pitch) {
      console.log('[submitAgreementV3] pitch not found');
      return res.status(404).json({ message: 'Pitch not found' });
    }

    // Allow if current user is the pitch owner, or an admin/superadmin (to help testing)
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isOwner = pitch.userId === userId;
    const isPrivileged = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';
    console.log('[submitAgreementV3] auth', { isOwner, isPrivileged, currentUserRole: currentUser?.role });
    if (!isOwner && !isPrivileged) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!pitch.campaignId) return res.status(400).json({ message: 'Campaign not found for pitch' });

    // Upsert creator agreement for V3
    console.log('[submitAgreementV3] upserting agreement', { campaignId: pitch.campaignId, pitchUserId: pitch.userId });
    await prisma.creatorAgreement.upsert({
      where: {
        userId_campaignId: {
          userId: pitch.userId,
          campaignId: pitch.campaignId,
        },
      },
      update: {
        agreementUrl: agreementUrl || undefined,
        isSent: true,
        completedAt: new Date(),
      },
      create: {
        userId: pitch.userId,
        campaignId: pitch.campaignId,
        agreementUrl: agreementUrl || '',
        isSent: true,
        completedAt: new Date(),
      },
    });

    // Mark pitch as AGREEMENT_SUBMITTED for V3 flow
    console.log('[submitAgreementV3] updating pitch status to AGREEMENT_SUBMITTED');
    const updatedPitch = await prisma.pitch.update({
      where: { id: pitch.id },
      data: { status: 'AGREEMENT_SUBMITTED' },
    });

    // Notify campaign admins
    const admins = await prisma.campaignAdmin.findMany({
      where: { campaignId: pitch.campaignId as string },
      include: { admin: { include: { user: true } } },
    });
    const submitter = await prisma.user.findUnique({ where: { id: pitch.userId } });
    const campaignName = pitch.campaign?.name || '';

    // Mark shortlisted row as agreement ready so admin UI reflects new state
    const shortlisted = await prisma.shortListedCreator.findFirst({
      where: { userId: pitch.userId, campaignId: pitch.campaignId as string },
    });
    if (shortlisted) {
      await prisma.shortListedCreator.update({
        where: { id: shortlisted.id },
        data: { isAgreementReady: true },
      });
    }
    for (const a of admins) {
      const notification = await saveNotification({
        userId: a.adminId,
        title: 'Agreement Submitted',
        message: `${submitter?.name || 'Creator'} submitted the agreement for ${campaignName}.`,
        entity: 'Agreement',
        entityId: pitch.campaignId as string,
      });
      const socketId = clients.get(a.admin.userId);
      if (socketId) {
        io.to(socketId).emit('notification', notification);
        io.to(socketId).emit('agreementReady');
        io.to(socketId).emit('pitchUpdate');
      }
    }

    // Log campaign change
    await logChange(`${submitter?.name || 'Creator'} submitted agreement`, pitch.campaignId as string, req);

    console.log('[submitAgreementV3] success');
    return res.status(200).json({ message: 'Agreement submitted', pitch: updatedPitch });
  } catch (error) {
    console.error('submitAgreementV3 error:', error);
    return res.status(400).json({ message: error?.message || 'Failed to submit agreement' });
  }
};

export const changeCampaignCredit = async (req: Request, res: Response) => {
  const { campaignId, newCredit } = req.body;
  const { userid } = req.session;

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        brand: true,
        company: {
          select: {
            subscriptions: {
              where: {
                status: 'ACTIVE',
              },
            },
            brand: true,
          },
        },
        subscription: true,
      },
    });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const subscription = campaign?.subscription || null;

    if (!subscription) return res.status(404).json({ message: 'No subscription found' });

    const subscribedCampaigns = await prisma.subscription.findFirst({
      where: {
        id: subscription.id,
      },
      select: {
        campaign: {
          select: {
            campaignCredits: true,
            shortlisted: true,
            id: true,
            name: true,
            creditsPending: true,
          },
        },
      },
    });

    const totalAssignedCredits = subscribedCampaigns?.campaign.reduce(
      (acc, cur) => acc + (cur.campaignCredits ?? 0),
      0,
    );

    if (newCredit < 0) {
      //Deduct from existing credits and add into subscription credit

      await prisma.campaign.update({
        where: {
          id: campaign.id,
        },
        data: {
          campaignCredits: {
            decrement: Math.abs(newCredit),
          },
          creditsPending: {
            decrement: Math.abs(newCredit),
          },
        },
      });
    } else {
      if (totalAssignedCredits === subscription.totalCredits) {
        // const campaigns = subscribedCampaigns?.campaign || [];

        // const newCampaigns = campaigns.map((item) => {
        //   const shortlistedCreditsAssigned = item.shortlisted.reduce((acc, cur) => acc + (cur?.ugcVideos ?? 0), 0);

        //   return {
        //     campaignId: item.id,
        //     campaignName: item.name,
        //     creditsPending: (item.campaignCredits ?? 0) - shortlistedCreditsAssigned,
        //   };
        // });

        // console.log(newCampaigns);

        return res.status(400).json({ message: 'All available credits have been used.' });
      }

      if (totalAssignedCredits + newCredit > (subscription?.totalCredits ?? 0)) {
        return res.status(400).json({
          message: `Only ${(subscription?.totalCredits ?? 0) - (totalAssignedCredits ?? 0)} credits is available to add.`,
        });
      }

      await prisma.$transaction(async (tx) => {
        const updatedCampaign = await tx.campaign.update({
          where: {
            id: campaign.id,
          },
          data: {
            campaignCredits: {
              increment: newCredit,
            },
            creditsPending: {
              increment: newCredit,
            },
          },
        });

        await tx.adminLog.create({
          data: {
            message: `${user?.name} changed the campaign credit for "${campaign.name}" from ${campaign.campaignCredits} to ${updatedCampaign.campaignCredits} credits.`,
            admin: {
              connect: {
                userId: user?.id,
              },
            },
            performedBy: user?.name,
          },
        });
      });
    }

    res.status(200).json({ message: 'Successfully changed' });
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: error });
  }
};

export const getClientCampaigns = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('getClientCampaigns called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get the user first
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    console.log('User found:', {
      id: user?.id,
      role: user?.role,
      clientId: user?.client?.id,
      companyId: user?.client?.companyId,
    });

    // Make sure user exists
    if (!user) {
      console.log('User not found');
      return res.status(401).json({ message: 'Unauthorized. User not found.' });
    }

    // Check if the user has any campaign admin entries
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        adminId: userid,
      },
    });

    console.log(`Found ${campaignAdminEntries.length} campaignAdmin entries for user ${userid}`);

    // Find only campaigns created by this client user
    // We can identify this by looking at the campaignAdmin relation
    // or by checking if the user is in the campaign's admin list
    const campaigns = await prisma.campaign.findMany({
      where: {
        campaignAdmin: {
          some: {
            adminId: userid,
          },
        },
      },
      include: {
        brand: { include: { company: true } },
        company: true,
        campaignBrief: true,
        campaignTimeline: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`Found ${campaigns.length} campaigns for user ${userid}`);
    if (campaigns.length > 0) {
      console.log(
        'Campaign IDs:',
        campaigns.map((c) => c.id),
      );
      console.log(
        'Campaign statuses:',
        campaigns.map((c) => c.status),
      );
    }

    return res.status(200).json(campaigns);
  } catch (error) {
    console.error('Error fetching client campaigns:', error);
    return res.status(400).json({ message: 'Error fetching campaigns', error });
  }
};

export const activateClientCampaign = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;
    const { campaignId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user is an admin/superadmin
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: { include: { role: true } },
      },
    });

    if (!user) {
      return res.status(403).json({ message: 'User not found' });
    }

    // Allow both admin and superadmin roles
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only admin or superadmin users can activate client campaigns' });
    }

    console.log('User found:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
    });

    // Parse request data
    let data;
    try {
      data = JSON.parse(req.body.data);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    const { campaignType, deliverables, adminManager, agreementTemplateId, status } = data;

    console.log('Received data:', { campaignType, deliverables, adminManager, agreementTemplateId, status });

    // Validate required fields
    if (!campaignType) {
      return res.status(400).json({ message: 'Campaign type is required' });
    }

    if (!adminManager || (Array.isArray(adminManager) && adminManager.length === 0)) {
      return res.status(400).json({ message: 'At least one admin manager is required' });
    }

    // Ensure adminManager is always an array
    const adminManagerArray = Array.isArray(adminManager) ? adminManager : [adminManager];

    if (!agreementTemplateId) {
      return res.status(400).json({ message: 'Agreement template is required' });
    }

    // Check if campaign exists and is in PENDING_ADMIN_ACTIVATION status
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        status: 'PENDING_ADMIN_ACTIVATION',
      },
      include: {
        company: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found or not in pending admin activation status' });
    }

    // Log user info for debugging
    console.log('User activating campaign:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      adminMode: user.admin?.mode,
      adminRoleId: user.admin?.roleId,
    });

    // Process deliverables
    const rawFootage = deliverables?.includes('RAW_FOOTAGES') || false;
    const photos = deliverables?.includes('PHOTOS') || false;
    const ads = deliverables?.includes('ADS') || false;
    const crossPosting = deliverables?.includes('CROSS_POSTING') || false;

    // Update campaign with CSM-provided information
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: campaignId,
      },
      data: {
        status: 'ACTIVE',
        campaignType,
        rawFootage,
        photos,
        ads,
        crossPosting,
        agreementTemplate: {
          connect: {
            id: agreementTemplateId,
          },
        },
      },
    });

    // Create campaign timelines for creators
    // This is necessary for creators to see the campaign in their discovery feed
    console.log('Creating campaign timelines for creators');

    try {
      // Create default timeline types if they don't exist
      const submissionTypes = await prisma.submissionType.findMany();
      if (!submissionTypes.length) {
        console.log('No submission types found, creating default ones');
        await prisma.submissionType.createMany({
          data: [
            { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
            { type: 'FIRST_DRAFT', description: 'First Draft' },
            { type: 'FINAL_DRAFT', description: 'Final Draft' },
            { type: 'POSTING', description: 'Posting' },
            { type: 'OTHER', description: 'Other' },
          ],
          skipDuplicates: true,
        });
      }

      // Get campaign brief for dates
      const campaignBrief = await prisma.campaignBrief.findUnique({
        where: { campaignId },
      });

      if (!campaignBrief) {
        console.error('Campaign brief not found for campaign', campaignId);
        throw new Error('Campaign brief not found');
      }

      // Calculate timeline dates based on campaign start and end dates
      const startDate = new Date(campaignBrief.startDate);
      const endDate = new Date(campaignBrief.endDate);
      const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

      // Get submission types
      const agreementFormType = await prisma.submissionType.findFirst({ where: { type: 'AGREEMENT_FORM' } });
      const firstDraftType = await prisma.submissionType.findFirst({ where: { type: 'FIRST_DRAFT' } });
      const finalDraftType = await prisma.submissionType.findFirst({ where: { type: 'FINAL_DRAFT' } });
      const postingType = await prisma.submissionType.findFirst({ where: { type: 'POSTING' } });

      if (!agreementFormType || !firstDraftType || !finalDraftType || !postingType) {
        console.error('Required submission types not found');
        throw new Error('Required submission types not found');
      }

      // Create timelines
      const timelinesToCreate = [
        {
          name: 'Open For Pitch', // This name must exactly match what the frontend is looking for
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: startDate,
          endDate: new Date(startDate.getTime() + Math.max(3, Math.floor(totalDays * 0.2)) * 24 * 60 * 60 * 1000),
          order: 1,
          status: 'OPEN' as TimelineStatus,
          campaignId,
        },
        {
          name: 'Agreement',
          for: 'creator',
          duration: Math.max(2, Math.floor(totalDays * 0.1)),
          startDate: startDate,
          endDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
          order: 2,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: agreementFormType.id,
        },
        {
          name: 'First Draft',
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
          endDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          order: 3,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: firstDraftType.id,
        },
        {
          name: 'Final Draft',
          for: 'creator',
          duration: Math.max(3, Math.floor(totalDays * 0.2)),
          startDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          endDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) +
                Math.max(3, Math.floor(totalDays * 0.2)) +
                Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          order: 4,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: finalDraftType.id,
        },
        {
          name: 'Posting',
          for: 'creator',
          duration: Math.max(2, Math.floor(totalDays * 0.1)),
          startDate: new Date(
            startDate.getTime() +
              (Math.max(2, Math.floor(totalDays * 0.1)) +
                Math.max(3, Math.floor(totalDays * 0.2)) +
                Math.max(3, Math.floor(totalDays * 0.2))) *
                24 *
                60 *
                60 *
                1000,
          ),
          endDate,
          order: 5,
          status: 'OPEN' as TimelineStatus,
          campaignId,
          submissionTypeId: postingType.id,
        },
      ];

      // Create all timelines one by one to ensure they are created correctly
      console.log('Creating timelines one by one for better error handling...');

      const createdTimelines = [];
      for (const timeline of timelinesToCreate) {
        try {
          const createdTimeline = await prisma.campaignTimeline.create({
            data: timeline,
          });
          createdTimelines.push(createdTimeline);
          console.log(`Successfully created timeline: ${createdTimeline.name}`);
        } catch (error) {
          console.error(`Error creating timeline ${timeline.name}:`, error);
        }
      }

      // Verify the Open For Pitch timeline was created correctly
      const openForPitchTimeline = await prisma.campaignTimeline.findFirst({
        where: {
          campaignId,
          name: 'Open For Pitch',
          status: 'OPEN',
        },
      });

      console.log('Open For Pitch timeline found?', openForPitchTimeline ? 'YES' : 'NO');
      if (openForPitchTimeline) {
        console.log('Open For Pitch timeline details:', {
          id: openForPitchTimeline.id,
          name: openForPitchTimeline.name,
          status: openForPitchTimeline.status,
          for: openForPitchTimeline.for,
          campaignId: openForPitchTimeline.campaignId,
        });
      } else {
        console.error(
          'Failed to create Open For Pitch timeline! This will prevent the campaign from appearing in creator discovery.',
        );
      }

      console.log('Successfully created campaign timelines for creators');
    } catch (error) {
      console.error('Error creating campaign timelines for creators:', error);
      // Don't throw the error, as we still want to complete the activation process
    }

    // Add admin managers to the campaign
    console.log('Adding admin managers:', adminManagerArray);

    for (const adminId of adminManagerArray) {
      try {
        console.log(`Adding admin ${adminId} to campaign ${campaignId}`);

        // Check if the admin exists
        const admin = await prisma.admin.findFirst({
          where: {
            id: adminId,
          },
        });

        if (!admin) {
          console.log(`Admin with ID ${adminId} not found, trying as userId instead`);

          // Try to find admin by userId
          const adminByUserId = await prisma.admin.findFirst({
            where: {
              userId: adminId,
            },
          });

          if (adminByUserId) {
            await prisma.campaignAdmin.create({
              data: {
                adminId: adminByUserId.userId,
                campaignId,
              },
            });
            console.log(`Successfully added admin with userId ${adminId} to campaign`);
          } else {
            console.error(`No admin found with ID or userId ${adminId}`);
          }
        } else {
          await prisma.campaignAdmin.create({
            data: {
              adminId: adminId,
              campaignId,
            },
          });
          console.log(`Successfully added admin ${adminId} to campaign`);
        }
      } catch (error) {
        console.error(`Error adding admin ${adminId} to campaign:`, error);
        // Continue with other admins even if one fails
      }
    }

    // Create campaign log for activation
    await prisma.campaignLog.create({
      data: {
        message: `Campaign activated by CSM ${user.name || user.id}`,
        adminId: user.id,
        campaignId,
      },
    });

    // Check if campaign would appear in creator discovery feed
    try {
      console.log('Checking if campaign would appear in creator discovery feed...');

      // Query the campaign with the same conditions used in matchCampaignWithCreator
      const activatedCampaign = await prisma.campaign.findFirst({
        where: {
          id: campaignId,
          status: 'ACTIVE',
        },
        include: {
          campaignTimeline: true,
        },
      });

      // Check if the campaign has an "Open For Pitch" timeline with status "OPEN"
      const hasOpenForPitchTimeline = activatedCampaign?.campaignTimeline?.some(
        (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
      );

      console.log('Campaign status:', activatedCampaign?.status);
      console.log('Has Open For Pitch timeline with OPEN status:', hasOpenForPitchTimeline);
      console.log(
        'Campaign should appear in creator discovery feed:',
        activatedCampaign?.status === 'ACTIVE' && hasOpenForPitchTimeline,
      );
    } catch (error) {
      console.error('Error checking creator discovery eligibility:', error);
    }

    // Create notification for client and add clients to campaignAdmin
    if (campaign.companyId) {
      const clientUsers = await prisma.user.findMany({
        where: {
          client: {
            companyId: campaign.companyId,
          },
        },
      });

      console.log(`Found ${clientUsers.length} clients for company ${campaign.companyId}`);

      for (const clientUser of clientUsers) {
        // Add client to campaignAdmin so they can see the campaign in their dashboard
        try {
          // Check if client is already in campaignAdmin
          const existingCampaignAdmin = await prisma.campaignAdmin.findUnique({
            where: {
              adminId_campaignId: {
                adminId: clientUser.id,
                campaignId,
              },
            },
          });

          if (!existingCampaignAdmin) {
            await prisma.campaignAdmin.create({
              data: {
                adminId: clientUser.id,
                campaignId,
              },
            });
            console.log(`Added client ${clientUser.id} to campaign ${campaignId}`);
          } else {
            console.log(`Client ${clientUser.id} already in campaignAdmin for campaign ${campaignId}`);
          }
        } catch (error) {
          console.error(`Error adding client ${clientUser.id} to campaign:`, error);
          // Continue with other clients even if one fails
        }

        // Create notification
        await prisma.notification.create({
          data: {
            title: 'Campaign Activated',
            message: `Your campaign "${campaign.name}" has been activated by CSM`,
            entity: 'Campaign',
            campaignId,
            userId: clientUser.id,
          },
        });
      }
    }

    // Log the campaign admin entries for this campaign
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        campaignId,
      },
      include: {
        admin: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    console.log(`Campaign ${campaignId} now has ${campaignAdminEntries.length} admin entries`);
    console.log(
      'Admin IDs:',
      campaignAdminEntries.map((entry) => entry.adminId),
    );

    // Create a thread for the campaign if it doesn't exist
    try {
      const existingThread = await prisma.thread.findFirst({
        where: {
          campaignId: campaignId,
        },
      });

      if (!existingThread) {
        console.log('Creating thread for client campaign');
        await prisma.thread.create({
          data: {
            campaignId: campaignId,
            title: `Campaign Thread - ${campaign.name}`,
            description: `Thread for campaign ${campaign.name}`,
          },
        });
        console.log('Thread created successfully for client campaign');
      } else {
        console.log('Thread already exists for this campaign');
      }
    } catch (error) {
      console.error('Error creating thread for client campaign:', error);
      // Don't fail the activation if thread creation fails
    }

    return res.status(200).json({
      message: 'Client campaign activated successfully',
      campaign: updatedCampaign,
    });
  } catch (error: any) {
    console.error('Error activating client campaign:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while activating client campaign',
    });
  }
};

// Debug endpoint to update campaign origin for testing
export const updateCampaignOrigin = async (req: Request, res: Response) => {
  const { campaignId, origin } = req.body;

  try {
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: { origin: origin as 'ADMIN' | 'CLIENT' },
    });

    console.log(`Updated campaign ${campaignId} origin to ${origin}`);
    return res.status(200).json({
      message: 'Campaign origin updated successfully',
      campaign: updatedCampaign,
    });
  } catch (error) {
    console.error('Error updating campaign origin:', error);
    return res.status(500).json({ message: 'Failed to update campaign origin' });
  }
};

// Check campaign admin entries for the current user
export const checkCampaignAdmin = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('checkCampaignAdmin called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get all campaign admin entries for this user
    const campaignAdminEntries = await prisma.campaignAdmin.findMany({
      where: {
        adminId: userid,
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    console.log(`Found ${campaignAdminEntries.length} campaignAdmin entries for user ${userid}`);

    // For debugging, let's also check if there are any campaigns for the user's company
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    if (user?.client?.companyId) {
      const companyCampaigns = await prisma.campaign.findMany({
        where: {
          companyId: user.client.companyId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
        },
      });

      console.log(`Found ${companyCampaigns.length} campaigns for company ${user.client.companyId}`);
      if (companyCampaigns.length > 0) {
        console.log(
          'Company campaign IDs:',
          companyCampaigns.map((c) => c.id),
        );
        console.log(
          'Company campaign statuses:',
          companyCampaigns.map((c) => c.status),
        );
      }
    }

    return res.status(200).json(campaignAdminEntries);
  } catch (error) {
    console.error('Error checking campaign admin entries:', error);
    return res.status(400).json({ message: 'Error checking campaign admin entries', error });
  }
};

// Add client to campaign admin for all company campaigns
export const addClientToCampaignAdmin = async (req: Request, res: Response) => {
  const { userid } = req.session;

  console.log('addClientToCampaignAdmin called for user ID:', userid);

  // Check if user session exists
  if (!userid) {
    console.log('No user session found');
    return res.status(401).json({ message: 'Unauthorized. No user session found.' });
  }

  try {
    // Get the user first
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        client: true,
      },
    });

    // Make sure user exists and is a client
    if (!user || user.role !== 'client' || !user.client) {
      console.log('User not found or not a client');
      return res.status(403).json({ message: 'Only client users can use this endpoint' });
    }

    // Check if the user has a company
    if (!user.client.companyId) {
      console.log('Client has no company');
      return res.status(400).json({ message: 'Client must be associated with a company' });
    }

    // Find all campaigns for this company
    const companyCampaigns = await prisma.campaign.findMany({
      where: {
        companyId: user.client.companyId,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    console.log(`Found ${companyCampaigns.length} campaigns for company ${user.client.companyId}`);

    // Add the client to the campaignAdmin table for each campaign
    const results = [];
    for (const campaign of companyCampaigns) {
      try {
        // Check if the client is already in the campaignAdmin table
        const existingCampaignAdmin = await prisma.campaignAdmin.findUnique({
          where: {
            adminId_campaignId: {
              adminId: userid,
              campaignId: campaign.id,
            },
          },
        });

        if (existingCampaignAdmin) {
          console.log(`Client ${userid} already in campaignAdmin for campaign ${campaign.id}`);
          results.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: 'already_exists',
          });
          continue;
        }

        // Add the client to the campaignAdmin table
        await prisma.campaignAdmin.create({
          data: {
            adminId: userid,
            campaignId: campaign.id,
          },
        });

        console.log(`Added client ${userid} to campaignAdmin for campaign ${campaign.id}`);
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          status: 'added',
        });
      } catch (error) {
        console.error(`Error adding client ${userid} to campaignAdmin for campaign ${campaign.id}:`, error);
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          status: 'error',
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      message: `Processed ${companyCampaigns.length} campaigns`,
      results,
    });
  } catch (error) {
    console.error('Error adding client to campaign admin:', error);
    return res.status(500).json({ message: 'Error adding client to campaign admin', error });
  }
};

// Add this function after the addClientToCampaignAdmin function
export const fixCampaignTimelines = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Find the campaign
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
        campaignTimeline: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    console.log(`Fixing timelines for campaign ${campaignId} (${campaign.name})`);

    // Check if Open For Pitch timeline exists
    const openForPitchExists = campaign.campaignTimeline.some(
      (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
    );

    if (openForPitchExists) {
      console.log('Campaign already has Open For Pitch timeline');
      return res.status(200).json({
        message: 'Campaign already has required timelines',
        campaign,
      });
    }

    // Get submission types
    const submissionTypes = await prisma.submissionType.findMany();
    if (submissionTypes.length === 0) {
      // Create default submission types if they don't exist
      await prisma.submissionType.createMany({
        data: [
          { type: 'AGREEMENT_FORM', description: 'Agreement Form' },
          { type: 'FIRST_DRAFT', description: 'First Draft' },
          { type: 'FINAL_DRAFT', description: 'Final Draft' },
          { type: 'POSTING', description: 'Posting' },
          { type: 'OTHER', description: 'Other' },
        ],
        skipDuplicates: true,
      });
    }

    const agreementFormType = await prisma.submissionType.findFirst({ where: { type: 'AGREEMENT_FORM' } });
    const firstDraftType = await prisma.submissionType.findFirst({ where: { type: 'FIRST_DRAFT' } });
    const finalDraftType = await prisma.submissionType.findFirst({ where: { type: 'FINAL_DRAFT' } });
    const postingType = await prisma.submissionType.findFirst({ where: { type: 'POSTING' } });

    if (!agreementFormType || !firstDraftType || !finalDraftType || !postingType) {
      return res.status(500).json({ message: 'Required submission types not found' });
    }

    // Calculate timeline dates based on campaign start and end dates
    const startDate = new Date(campaign.campaignBrief?.startDate || new Date());
    const endDate = new Date(campaign.campaignBrief?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Create timelines
    const timelinesToCreate = [
      {
        name: 'Open For Pitch', // This name must exactly match what the frontend is looking for
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: startDate,
        endDate: new Date(startDate.getTime() + Math.max(3, Math.floor(totalDays * 0.2)) * 24 * 60 * 60 * 1000),
        order: 1,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
      },
      {
        name: 'Agreement',
        for: 'creator',
        duration: Math.max(2, Math.floor(totalDays * 0.1)),
        startDate: startDate,
        endDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
        order: 2,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: agreementFormType.id,
      },
      {
        name: 'First Draft',
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: new Date(startDate.getTime() + Math.max(2, Math.floor(totalDays * 0.1)) * 24 * 60 * 60 * 1000),
        endDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) * 24 * 60 * 60 * 1000,
        ),
        order: 3,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: firstDraftType.id,
      },
      {
        name: 'Final Draft',
        for: 'creator',
        duration: Math.max(3, Math.floor(totalDays * 0.2)),
        startDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) + Math.max(3, Math.floor(totalDays * 0.2))) * 24 * 60 * 60 * 1000,
        ),
        endDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) +
              Math.max(3, Math.floor(totalDays * 0.2)) +
              Math.max(3, Math.floor(totalDays * 0.2))) *
              24 *
              60 *
              60 *
              1000,
        ),
        order: 4,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: finalDraftType.id,
      },
      {
        name: 'Posting',
        for: 'creator',
        duration: Math.max(2, Math.floor(totalDays * 0.1)),
        startDate: new Date(
          startDate.getTime() +
            (Math.max(2, Math.floor(totalDays * 0.1)) +
              Math.max(3, Math.floor(totalDays * 0.2)) +
              Math.max(3, Math.floor(totalDays * 0.2))) *
              24 *
              60 *
              60 *
              1000,
        ),
        endDate,
        order: 5,
        status: 'OPEN' as TimelineStatus,
        campaignId: campaign.id,
        submissionTypeId: postingType.id,
      },
    ];

    // Create timelines one by one
    const createdTimelines = [];
    for (const timeline of timelinesToCreate) {
      try {
        const createdTimeline = await prisma.campaignTimeline.create({
          data: timeline,
        });
        createdTimelines.push(createdTimeline);
        console.log(`Created timeline: ${createdTimeline.name}`);
      } catch (error) {
        console.error(`Error creating timeline ${timeline.name}:`, error);
      }
    }

    // Verify the Open For Pitch timeline was created correctly
    const openForPitchTimeline = await prisma.campaignTimeline.findFirst({
      where: {
        campaignId: campaign.id,
        name: 'Open For Pitch',
        status: 'OPEN',
      },
    });

    if (!openForPitchTimeline) {
      return res.status(500).json({
        message: 'Failed to create Open For Pitch timeline',
        createdTimelines,
      });
    }

    // Update the campaign with the latest data
    const updatedCampaign = await prisma.campaign.findUnique({
      where: {
        id: campaign.id,
      },
      include: {
        campaignBrief: true,
        campaignTimeline: true,
      },
    });

    return res.status(200).json({
      message: 'Campaign timelines fixed successfully',
      campaign: updatedCampaign,
      createdTimelines,
    });
  } catch (error) {
    console.error('Error fixing campaign timelines:', error);
    return res.status(500).json({
      message: 'Error fixing campaign timelines',
      error,
    });
  }
};

// Add this function after the fixCampaignTimelines function
export const checkCampaignCreatorVisibility = async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // Find the campaign with all necessary relations
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
        campaignLogs: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Check campaign status
    const isActive = campaign.status === 'ACTIVE';

    // Check if campaign has Open For Pitch timeline with OPEN status
    const hasOpenForPitchTimeline = campaign.campaignTimeline.some(
      (timeline) => timeline.name === 'Open For Pitch' && timeline.status === 'OPEN',
    );

    // Check if campaign has required fields
    const hasBrief = !!campaign.campaignBrief;
    const hasRequirements = !!campaign.campaignRequirement;

    // Check campaign admins
    const admins = campaign.campaignAdmin.map((admin) => ({
      adminId: admin.adminId,
      role: admin.admin?.user?.role || 'unknown',
    }));

    // Check campaign creation logs
    const creationLogs = campaign.campaignLogs
      .filter((log: any) => log.action === 'CREATE_CAMPAIGN')
      .map((log: any) => ({
        userId: log.userId,
        role: log.userRole,
        timestamp: log.createdAt,
      }));

    // Determine if campaign should be visible to creators
    const shouldBeVisibleToCreators = isActive && hasOpenForPitchTimeline;

    // Prepare response with all checks
    const response = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      checks: {
        isActive,
        hasOpenForPitchTimeline,
        hasBrief,
        hasRequirements,
      },
      timelines: campaign.campaignTimeline.map((timeline) => ({
        name: timeline.name,
        status: timeline.status,
        for: timeline.for,
      })),
      admins,
      creationLogs,
      shouldBeVisibleToCreators,
      missingRequirements: [] as string[],
    };

    // Add missing requirements to the response
    if (!isActive) {
      response.missingRequirements.push('Campaign status must be ACTIVE');
    }
    if (!hasOpenForPitchTimeline) {
      response.missingRequirements.push('Campaign must have an "Open For Pitch" timeline with status "OPEN"');
    }
    if (!hasBrief) {
      response.missingRequirements.push('Campaign must have a brief');
    }
    if (!hasRequirements) {
      response.missingRequirements.push('Campaign must have requirements defined');
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error checking campaign visibility:', error);
    return res.status(500).json({
      message: 'Error checking campaign visibility',
      error,
    });
  }
};

// Add this function after the shortlistCreatorV2 function
export const shortlistCreatorV3 = async (req: Request, res: Response) => {
  const { creators, campaignId, adminComments } = req.body;
  const userId = req.session.userid;

  try {
    // Allow superadmin to bypass campaign admin check
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isSuperadmin = currentUser?.role === 'superadmin';
    console.log(`shortlistCreatorV3: Shortlisting creators for campaign ${campaignId} by user ${userId}`);
    console.log(`Creators to shortlist:`, creators);

    // Check if the user has access to this campaign (is admin or client who created it)
    const campaignAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId,
        adminId: userId,
      },
      include: {
        admin: {
          include: {
            user: true,
          },
        },
        campaign: {
          include: {
            campaignLogs: true,
          },
        },
      },
    });

    // Check if user is client who created this campaign
    const isClientCreator = campaignAccess?.admin?.user?.role === 'client';
    // Note: campaignLogs might have different structure, we'll just check if user is a client
    const isClientCreatedCampaign = isClientCreator;

    console.log(`User role: ${campaignAccess?.admin?.user?.role}`);
    console.log(`Is client who created campaign: ${isClientCreator && isClientCreatedCampaign}`);

    // If not authorized, return error
    if (!campaignAccess && !isSuperadmin) {
      return res.status(403).json({ message: 'Not authorized to shortlist creators for this campaign' });
    }

    await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUnique({
        where: {
          id: campaignId,
        },
        include: {
          shortlisted: true,
          thread: true,
          campaignBrief: true,
        },
      });

      if (!campaign) throw new Error('Campaign not found');

      // For V3, we only support client-created campaigns
      if (campaign.origin !== 'CLIENT') {
        throw new Error('V3 shortlisting is only for client-created campaigns');
      }

      const creatorIds = creators.map((c: any) => c.id);

      const creatorData = await tx.user.findMany({
        where: { id: { in: creatorIds } },
        include: { creator: true, paymentForm: true },
      });

      // Check if campaign has a thread
      const threadId = campaign.thread?.id;

      // For client-created campaigns, we'll continue even without a thread
      if (!threadId) {
        console.log('Client-created campaign without thread, continuing anyway');
      }

      // Process each creator
      for (const creator of creators) {
        const user = creatorData.find((u) => u.id === creator.id);
        if (!user) continue;

        console.log(`Processing creator: ${user.name} (${user.id})`);

        // Check if already has a pitch for this campaign
        const existingPitch = await tx.pitch.findFirst({
          where: {
            userId: user.id,
            campaignId: campaign.id,
          },
        });

        if (existingPitch) {
          console.log(`Creator ${user.id} already has a pitch, skipping`);
          continue;
        }

        // Create a pitch record for this creator
        console.log(`Creating pitch for creator ${user.id}`);
        await tx.pitch.create({
          data: {
            userId: user.id,
            campaignId: campaign.id,
            type: 'text', // V3 shortlist pitch type
            status: 'SENT_TO_CLIENT', // Client can immediately approve
            content: `Creator ${user.name} has been shortlisted for campaign "${campaign.name}"`,
            // Set default values for V3 flow
            amount: null, // Will be set when admin approves
            agreementTemplateId: null, // Will be set when admin approves
            ...(typeof adminComments === 'string' && adminComments.trim().length > 0
              ? { adminComments: adminComments.trim(), adminCommentedBy: userId }
              : {}),
          },
        });

        // Add creator to thread if not already added and if thread exists
        if (threadId) {
          try {
            const existingUserThread = await tx.userThread.findUnique({
              where: {
                userId_threadId: {
                  userId: user.id,
                  threadId,
                },
              },
            });

            if (!existingUserThread) {
              await tx.userThread.create({
                data: {
                  userId: user.id,
                  threadId,
                },
              });
              console.log(`Added creator ${user.id} to thread ${threadId}`);
            }
          } catch (error) {
            console.error(`Error adding creator to thread:`, error);
          }
        }

        // Create notification for admin users
        const adminUsers = await tx.campaignAdmin.findMany({
          where: {
            campaignId: campaign.id,
            admin: {
              user: {
                role: { in: ['admin', 'superadmin'] },
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
        });

        for (const adminUser of adminUsers) {
          await tx.notification.create({
            data: {
              title: 'New Creator Shortlisted',
              message: `Creator ${user.name} has been shortlisted for campaign "${campaign.name}". Please review and approve.`,
              entity: 'Pitch',
              campaignId: campaign.id,
              userId: adminUser.admin.userId,
            },
          });
        }
      }
    });

    return res.status(200).json({ message: 'Successfully shortlisted creators for V3 flow' });
  } catch (error) {
    console.error('Error shortlisting creators for V3:', error);
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to shortlist creators',
      error,
    });
  }
};

// V2 Shortlist Creator for Client-Created Campaigns
export const shortlistCreatorV2ForClient = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;

  console.log('shortlistCreatorV2ForClient called with:', { creators, campaignId });

  try {
    await prisma.$transaction(async (tx) => {
      try {
        const campaign = await tx.campaign.findUnique({
          where: {
            id: campaignId,
          },
          include: {
            shortlisted: true,
            thread: true,
            campaignBrief: true,
          },
        });

        if (!campaign) throw new Error('Campaign not found');

        // For client-created campaigns, we don't check campaignCredits as they're managed differently
        if (campaign.origin !== 'CLIENT') {
          throw new Error('This endpoint is only for client-created campaigns');
        }

        const existingCreators = campaign.shortlisted.reduce((acc, creator) => acc + (creator.ugcVideos ?? 0), 0);

        const totalCreditsAssigned = creators.reduce(
          (acc: number, creator: { credits: number }) => acc + creator.credits,
          0,
        );

        // For client campaigns, we can assign credits without strict limits
        // The client manages their own budget

        const creatorIds = creators.map((c: any) => c.id);

        const creatorData = await tx.user.findMany({
          where: { id: { in: creatorIds } },
          include: { creator: true, paymentForm: true },
        });

        // Check if campaign has a thread - for client-created campaigns, we'll continue even without a thread
        const threadId = campaign.thread?.id;

        if (!threadId) {
          console.log('Client-created campaign without thread, continuing anyway');
          // For client campaigns, we can proceed without a thread
        }

        await tx.shortListedCreator.createMany({
          data: creators.map((creator: any) => ({
            userId: creator.id,
            campaignId,
            ugcVideos: creator.credits,
          })),
        });

        const boards = await tx.board.findMany({
          where: { userId: { in: creatorIds } },
          include: { columns: true },
        });

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            campaignId: campaign.id,
            for: 'creator',
            name: { not: 'Open For Pitch' },
          },
          include: { submissionType: true },
          orderBy: { order: 'asc' },
        });

        for (const creator of creatorData) {
          const board = boards.find((b) => b.userId === creator.id);
          if (!board) throw new Error(`Board not found for user ${creator.id}`);

          const columnToDo = board.columns.find((c) => c.name.includes('To Do'));
          const columnInProgress = board.columns.find((c) => c.name.includes('In Progress'));
          if (!columnToDo || !columnInProgress) throw new Error('Columns not found.');

          type SubmissionWithRelations = Submission & {
            submissionType: SubmissionType;
          };

          const submissions: any[] = await Promise.all(
            timelines.map(async (timeline, index) => {
              return await tx.submission.create({
                data: {
                  dueDate: timeline.endDate,
                  campaignId: campaign.id,
                  userId: creator.id as string,
                  status: timeline.submissionType?.type === 'AGREEMENT_FORM' ? 'IN_PROGRESS' : 'NOT_STARTED',
                  submissionTypeId: timeline.submissionTypeId as string,
                  task: {
                    create: {
                      name: timeline.name,
                      position: index,
                      columnId: timeline.submissionType?.type ? columnInProgress.id : (columnToDo?.id as string),
                      priority: '',
                      status: timeline.submissionType?.type ? 'In Progress' : 'To Do',
                    },
                  },
                },
                include: {
                  submissionType: true,
                },
              });
            }),
          );
        }

        // Create notifications for shortlisted creators
        for (const creator of creatorData) {
          await tx.notification.create({
            data: {
              title: 'You have been shortlisted!',
              message: `Congratulations! You have been shortlisted for campaign "${campaign.name}".`,
              entity: 'Campaign',
              campaignId: campaign.id,
              userId: creator.id,
            },
          });

          // Handle thread creation for client campaigns if thread doesn't exist
          if (threadId) {
            const isThreadExist = await tx.userThread.findFirst({
              where: {
                threadId: threadId,
                userId: creator.id as string,
              },
            });

            if (!isThreadExist) {
              await tx.userThread.create({
                data: {
                  threadId: threadId,
                  userId: creator.id as string,
                },
              });
            }
          }
        }

        console.log(`Successfully shortlisted ${creatorData.length} creators for client campaign ${campaignId}`);
      } catch (error) {
        console.error('Error in shortlistCreatorV2ForClient transaction:', error);
        throw error;
      }
    });

    return res.status(200).json({ message: 'Creators shortlisted successfully' });
  } catch (error) {
    console.error('Error shortlisting creators for client campaign:', error);
    return res.status(400).json({ message: error.message || 'Failed to shortlist creators' });
  }
};

export const initialActivateCampaign = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;
    const { campaignId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Check if user is CSL or superadmin
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: { include: { role: true } },
      },
    });

    if (!user) {
      return res.status(403).json({ message: 'User not found' });
    }

    // Only allow CSL or superadmin (god mode) to do initial activation
    const isCSL = user.admin?.role?.name === 'CSL';
    const isSuperAdmin = user.admin?.mode === 'god';

    if (!isCSL && !isSuperAdmin) {
      return res.status(403).json({ message: 'Only CSL or Superadmin users can perform initial campaign activation' });
    }

    console.log('User performing initial activation:', {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      adminMode: user.admin?.mode,
      adminRoleName: user.admin?.role?.name,
    });

    // Parse request data
    let data;
    try {
      data = JSON.parse(req.body.data);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    const { adminManager } = data;

    console.log('Received initial activation data:', { adminManager });

    // Validate required fields
    if (!adminManager || (Array.isArray(adminManager) && adminManager.length === 0)) {
      return res.status(400).json({ message: 'At least one admin manager is required' });
    }

    // Ensure adminManager is always an array
    const adminManagerArray = Array.isArray(adminManager) ? adminManager : [adminManager];

    // Check if campaign exists and is in PENDING_CSM_REVIEW or SCHEDULED status
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        status: {
          in: ['PENDING_CSM_REVIEW', 'SCHEDULED'] as CampaignStatus[],
        },
      },
      include: {
        company: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found or not in pending/scheduled status' });
    }

    // Update campaign status to PENDING_ADMIN_ACTIVATION
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: campaignId,
      },
      data: {
        status: 'PENDING_ADMIN_ACTIVATION',
      },
    });

    // Add admin managers to the campaign
    for (const adminId of adminManagerArray) {
      try {
        // Check if the admin exists
        const admin = await prisma.admin.findFirst({
          where: {
            id: adminId,
          },
        });

        if (!admin) {
          // Try to find admin by userId
          const adminByUserId = await prisma.admin.findFirst({
            where: {
              userId: adminId,
            },
          });

          if (adminByUserId) {
            await prisma.campaignAdmin.create({
              data: {
                adminId: adminByUserId.userId,
                campaignId,
              },
            });
          }
        } else {
          await prisma.campaignAdmin.create({
            data: {
              adminId: adminId,
              campaignId,
            },
          });
        }
      } catch (error) {
        console.error(`Error adding admin ${adminId} to campaign:`, error);
      }
    }

    console.log('Campaign updated for initial activation:', {
      campaignId,
      newStatus: updatedCampaign.status,
      adminManager: adminManagerArray,
    });

    res.status(200).json({
      message: 'Campaign activated and assigned to admin. Waiting for admin to complete setup.',
      campaign: updatedCampaign,
    });
  } catch (error) {
    console.error('Error in initial campaign activation:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Add this function after the shortlistCreatorV3 function
export const assignUGCCreditsV3 = async (req: Request, res: Response) => {
  const { creators, campaignId } = req.body;
  const userId = req.session.userid;

  try {
    // Allow superadmin to bypass campaign admin check
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isSuperadmin = currentUser?.role === 'superadmin';
    console.log(`assignUGCCreditsV3: Assigning UGC credits for campaign ${campaignId} by user ${userId}`);
    console.log(`Creators with credits:`, creators);

    // Check if the user has access to this campaign (is admin or client who created it)
    const campaignAccess = await prisma.campaignAdmin.findFirst({
      where: {
        campaignId,
        adminId: userId,
      },
      include: {
        admin: {
          include: {
            user: true,
          },
        },
        campaign: {
          include: {
            shortlisted: true,
          },
        },
      },
    });

    // If not authorized, return error
    if (!campaignAccess && !isSuperadmin) {
      return res.status(403).json({ message: 'Not authorized to assign UGC credits for this campaign' });
    }

    // campaignAccess may be null for superadmin; fetch campaign directly in that case
    // Always fetch a fresh campaign instance to avoid mixed types from relations
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { shortlisted: true },
    });
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // For V3, we only support client-created campaigns
    if (campaign.origin !== 'CLIENT') {
      throw new Error('V3 UGC credits assignment is only for client-created campaigns');
    }

    // Calculate total credits being assigned
    const totalCreditsToAssign = creators.reduce((acc: number, creator: any) => acc + (creator.credits || 0), 0);

    // Compute already utilized credits from shortlisted creators
    const alreadyUtilized = (campaign.shortlisted || []).reduce(
      (acc, item) => acc + (item.ugcVideos || 0),
      0,
    );

    // Enforce remaining credits check (campaignCredits - alreadyUtilized)
    if (
      campaign.campaignCredits &&
      totalCreditsToAssign > (campaign.campaignCredits - alreadyUtilized)
    ) {
      return res.status(400).json({
        message: `Not enough credits available. Remaining: ${
          campaign.campaignCredits - alreadyUtilized
        }, requested: ${totalCreditsToAssign}`,
      });
    }

    await prisma.$transaction(async (tx) => {
      // Process each creator
      for (const creator of creators) {
        if (!creator.credits || creator.credits <= 0) continue;

        console.log(`Assigning ${creator.credits} UGC credits to creator ${creator.id}`);

        // Check if creator is already shortlisted
        const existingShortlist = await tx.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId: creator.id,
              campaignId: campaign.id,
            },
          },
        });

        if (existingShortlist) {
          // Update existing shortlist with UGC credits
          await tx.shortListedCreator.update({
            where: {
              userId_campaignId: {
                userId: creator.id,
                campaignId: campaign.id,
              },
            },
            data: {
              ugcVideos: creator.credits,
            },
          });
          console.log(`Updated UGC credits for existing shortlisted creator ${creator.id}`);
        } else {
          // Create new shortlist entry with UGC credits
          await tx.shortListedCreator.create({
            data: {
              userId: creator.id,
              campaignId: campaign.id,
              ugcVideos: creator.credits,
              currency: 'MYR', // Default currency for V3
            },
          });
          console.log(`Created new shortlist entry with UGC credits for creator ${creator.id}`);
        }
      }

      // Update campaign credits tracking fields
      // Get all shortlisted creators for this campaign to calculate total utilized credits
      const allShortlistedCreators = await tx.shortListedCreator.findMany({
        where: { campaignId: campaign.id },
        select: { ugcVideos: true },
      });

      const totalUtilizedCredits = allShortlistedCreators.reduce((acc, creator) => acc + (creator.ugcVideos || 0), 0);

      if (campaign.campaignCredits) {
        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            creditsUtilized: totalUtilizedCredits,
            creditsPending: campaign.campaignCredits - totalUtilizedCredits,
          },
        });
        console.log(
          `Updated campaign credits: utilized=${totalUtilizedCredits}, pending=${campaign.campaignCredits - totalUtilizedCredits}`,
        );
      }
    });

    return res.status(200).json({
      message: 'Successfully assigned UGC credits to creators',
      totalCreditsAssigned: totalCreditsToAssign,
    });
  } catch (error) {
    console.error('Error assigning UGC credits for V3:', error);
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'Failed to assign UGC credits',
      error,
    });
  }
};

// 3.1 Shortlisting Non-Platform (Guest) Creators
export const shortlistGuestCreators = async (req: Request, res: Response) => {
  const { campaignId, guestCreators } = req.body;
  const adminId = req.session.userid;

  if (!campaignId || !Array.isArray(guestCreators) || guestCreators.length === 0) {
    return res.status(400).json({ message: 'Campaign ID and a list of guest creators are required.' });
  }

  if (guestCreators.length > 3) {
    return res.status(400).json({ message: 'You can add a maximum of 3 guest creators at a time' });
  }

  try {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });

    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });

    const createdCreators: Array<{ id: string }> = [];
    await prisma.$transaction(async (tx) => {
      for (const guest of guestCreators) {
        // give guest a userId
        const { userId } = await handleGuestForShortListing(guest, tx);

        // Check if guest has already been shortlisted
        const existingShortlist = await tx.shortListedCreator.findUnique({
          where: {
            userId_campaignId: {
              userId,
              campaignId,
            },
          },
        });

        if (existingShortlist) {
          console.log(`Guest creator ${guest.profileLink} is already shortlisted. Skipping.`);
          continue; // Skip and move to the next guest
        }

        await tx.shortListedCreator.create({
          data: {
            userId,
            campaignId,
            adminComments: guest.adminComments || null,
            amount: 0,
            currency: 'SGD',
          },
        });

        // Also create a V3 pitch entry so it appears in the pitches list
        const existingPitch = await tx.pitch.findFirst({
          where: { userId, campaignId },
        });

        if (!existingPitch) {
          await tx.pitch.create({
            data: {
              userId,
              campaignId,
              type: 'text',
              status: 'SENT_TO_CLIENT',
              content: `Non-platform creator has been shortlisted for campaign "${campaign.name}"`,
              amount: null,
              agreementTemplateId: null,
              ...(guest.adminComments && guest.adminComments.trim().length > 0
                ? { adminComments: guest.adminComments.trim(), adminCommentedBy: adminId }
                : {}),
            },
          });
        }

        createdCreators.push({ id: userId });
      }
    });

    const adminLogMessage = `Shortlisted ${guestCreators.length} guest creator(s) for Campaign "${campaign.name}"`;
    logAdminChange(adminLogMessage, adminId, req);

    return res.status(200).json({ message: 'Guest creators successfully shortlisted.', createdCreators });
  } catch (error) {
    console.error('GUEST SHORTLIST ERROR:', error);
    return res.status(400).json({ message: error.message || 'Failed to shortlist guest creators.' });
  }
};

export const getCampaignsForPublic = async (req: Request, res: Response) => {
  const { cursor, take = 10, search, campaignId } = req.query;

  console.log(campaignId);
  console.log(cursor);
  try {
    const campaigns = await prisma.campaign.findMany({
      take: Number(take),
      ...(cursor && {
        skip: 1,
        cursor: {
          id: cursor as string,
        },
      }),
      where: {
        id: campaignId as string,
        status: 'ACTIVE',
        // ...(campaignId && {
        // }),
        // ...(search && {
        //   name: {
        //     contains: search as string,
        //     mode: 'insensitive',
        //   },
        // }),
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: { include: { company: { include: { subscriptions: true } } } },
        company: true,
        pitch: true,
        bookMarkCampaign: true,
        shortlisted: true,
        logistic: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (campaigns?.length === 0) {
      const data = {
        data: {
          campaigns: [],
        },
        metaData: {
          lastCursor: null,
          hasNextPage: false,
        },
      };

      return res.status(200).json(data);
    }

    // campaigns = campaigns.filter(
    //   (campaign) => campaign.campaignTimeline.find((timeline) => timeline.name === 'Open For Pitch')?.status === 'OPEN',
    // );
    const lastCursor = campaigns.length > Number(take) - 1 ? campaigns[Number(take) - 1]?.id : null;

    const data = {
      data: {
        campaigns: campaigns,
      },
      metaData: {
        lastCursor: lastCursor,
        hasNextPage: true,
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};
