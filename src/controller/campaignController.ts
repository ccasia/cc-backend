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
  }: Campaign = JSON.parse(req.body.data);

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
        const campaign = await tx.campaign.create({
          data: {
            campaignId: campaignId,
            name: campaignTitle,
            campaignType: campaignType,
            description: campaignDescription,
            status: campaignStage as CampaignStatus,
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
                startDate: dayjs(campaignStartDate) as any,
                endDate: dayjs(campaignEndDate) as any,
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
              return res.status(400).json({ message: 'Admin exists' });
            }

            const admins = await tx.campaignAdmin.create({
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
                userId: admins.admin.userId as string,
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
            return admins;
          }),
        );

        logChange('Created the Campaign', campaign.id, req);

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
    return res.status(400).json(error?.message);
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
          },
        },
        id: true,
      },
    });

    if (user?.admin?.mode === 'god' || user?.admin?.mode === 'advanced') {
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
            ugcVideos: true,
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

    let campaigns = await prisma.campaign.findMany({
      take: Number(take),
      ...(cursor && {
        skip: 1,
        cursor: {
          id: cursor as string,
        },
      }),
      where: {
        // status: 'ACTIVE',

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

    campaigns = campaigns.filter(
      (campaign) => campaign.campaignTimeline.find((timeline) => timeline.name === 'Open For Pitch')?.status === 'OPEN',
    );

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

    // const sortedMatchedCampaigns = matchedCampaignWithPercentage.sort((a, b) => b.percentageMatch - a.percentageMatch);
    const sortedMatchedCampaigns = matchedCampaignWithPercentage.sort((a, b) => {
      return dayjs(a.createdAt).isBefore(b.createdAt, 'date') ? 1 : -1;
    });

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
    const isPitchExist = await prisma.pitch.findUnique({
      where: {
        userId_campaignId: {
          userId: id as string,
          campaignId: campaignId,
        },
      },
    });

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
            status: 'undecided',
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
            status: 'undecided',
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
            status: 'undecided',
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
  try {
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

    return res.status(200).json({ pitches });
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

  try {
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

    return res.status(200).json({ pitch });
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

    const message = 'Dos and don’ts updated successfully.';
    logChange(message, campaignId, req);
    const adminId = req.session.userid;
    if (adminId) {
      const adminLogMessage = `Updated do's and don’ts.`;
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

    if (status === 'approved') {
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
            // io.to(socketId).emit('shortlisted', data);
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
              currency: 'SGD',
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
            shortlisted(creator.email, campaign.name, creator.name ?? 'Creator', campaign.id, image?.[0]);

            const socketId = clients.get(creator.id);
            if (socketId) {
              io.to(socketId).emit('notification', notification);

              io.to(socketId).emit('shortlisted', {
                campaignId: campaign.id,
                campaignName: campaign.name,
                message: `Congratulations! You've been shortlisted for the ${campaign.name} campaign.`,
                creatorData: {
                  id: creator.id,
                  name: creator.name,
                  email: creator.email,
                },

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
    const { paymentAmount, currency, user, campaignId, id: agreementId } = JSON.parse(req.body.data);

    console.log('Received update data:', { paymentAmount, currency, campaignId, agreementId });

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

    // Update creator agreement with new data
    const updatedAgreement = await prisma.creatorAgreement.update({
      where: {
        id: agreementId,
      },
      data: {
        userId: creator.id,
        campaignId: campaignId,
        ...(url && { agreementUrl: url }), // Only update URL if new file was uploaded
        updatedAt: dayjs().format(),
        amount: paymentAmount, // Remove parseInt since amount should be string
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
  const { user, id: agreementId, campaignId } = req.body;

  const adminId = req.session.userid;

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
      return res.status(404).json({ message: 'Creator not exist' });
    }

    const agreement = await prisma.creatorAgreement.findUnique({
      where: {
        id: agreementId,
      },
    });

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found.' });
    }

    // update the status of agreement
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

    return res.status(200).json({ message: 'Agreement has been sent.' });
  } catch (error) {
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
  console.log(cursor);

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        admin: {
          select: {
            mode: true,
          },
        },
        id: true,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (user.admin?.mode === 'god' || user.admin?.mode === 'advanced') {
      const campaigns: any = await prisma.campaign.findMany({
        take: Number(limit),
        ...(cursor && {
          skip: 1,
          cursor: { id: cursor as string },
        }),
        where: {
          AND: [
            {
              ...(status && {
                status: status as CampaignStatus,
              }),
            },
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
          {
            ...(status && { status: status as any }),
          },
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
      },
    });

    if (!campaign) return res.status(404).json({ message: 'No campaign found.' });

    const threadId = campaign?.thread?.id;

    await prisma.$transaction(async (tx) => {
      await tx.shortListedCreator.delete({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaign.id,
          },
        },
      });

      await tx.video.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      await tx.photo.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      await tx.rawFootage.deleteMany({
        where: {
          userId: user.id,
          campaignId: campaign.id,
        },
      });

      await tx.submission.deleteMany({
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

      await tx.userThread.delete({
        where: {
          userId_threadId: {
            userId: user.id,
            threadId: threadId!,
          },
        },
      });

      await tx.creatorAgreement.delete({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: campaign.id,
          },
        },
      });

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
      });

      if (invoice) {
        await tx.invoice.delete({
          where: {
            id: invoice.id,
          },
        });
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

    return res.status(200).json({ message: 'Successfully withdraw' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
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
          if (socketId) io.to(socketId).emit('notification', notification);

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
