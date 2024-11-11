import { Request, Response } from 'express';
import {
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

import { uploadAgreementForm, uploadImage, uploadPitchVideo } from '@configs/cloudStorage.config';
import dayjs from 'dayjs';
import { logChange } from '@services/campaignServices';
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
import { createNewSheetWithHeaderRows } from '@services/google_sheets/sheets';

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

interface Campaign {
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
  agreementFrom: image;
  defaultTimeline: timeline;
  status: string;
  adminId: string;
  timeline: any;
  adminTest: [];
  brandTone: string;
  productName: string;
  socialMediaPlatform: string[];
  videoAngle: string[];
  agreementForm: string;
}

const MAPPING: Record<string, string> = {
  AGREEMENT_FORM: 'Agreement',
  FIRST_DRAFT: 'First Draft',
  FINAL_DRAFT: 'Final Draft',
  POSTING: 'Posting',
};

const generateAgreement = async (creator: any, campaign: any) => {
  try {
    const agreementsPath = await agreementInput({
      date: dayjs().format('ddd LL'),
      creatorName: creator.name as string,
      icNumber: creator?.paymentForm.icNumber,
      address: creator.creator.address,
      agreement_endDate: dayjs().add(1, 'M').format('ddd LL'),
      now_date: dayjs().format('ddd LL'),
      creatorAccNumber: creator?.paymentForm.bankAccountNumber,
      creatorBankName: creator?.paymentForm?.bankName,
      agreementFormUrl: campaign?.campaignBrief?.agreementFrom,
      version: 1,
    });

    console.log(agreementsPath);

    // const pdfPath = await pdfConverter(
    //   agreementsPath,
    //   path.resolve(__dirname, `../form/pdf/${creator.name.split(' ').join('_')}.pdf`),
    // );

    // const url = await uploadAgreementForm(
    //   pdfPath,
    //   `${creator.name.split(' ').join('_')}-${campaign.name}.pdf`,
    //   'creatorAgreements',
    // );

    // await fs.promises.unlink(pdfPath);

    // return url;
  } catch (error) {
    throw new Error(error);
  }
};

export const createCampaign = async (req: Request, res: Response) => {
  const {
    campaignTitle,
    campaignBrand,
    hasBrand,
    client,
    campaignStartDate,
    campaignEndDate,
    campaignInterests,
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
    agreementForm,
  }: Campaign = JSON.parse(req.body.data);

  try {
    const publicURL: any = [];

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

    // let agreementFormURL = '';

    // Handle Campaign Agreement
    // if (req.files && req.files.agreementForm) {
    //   const form = (req.files as any).agreementForm;
    //   agreementFormURL = await uploadAgreementForm(form.tempFilePath, form.name, 'agreementForm');
    // }
    // Handle All processes
    await prisma.$transaction(
      async (tx) => {
        // Find All Admins
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

        // // Find Brand
        // const brand: any = await tx.brand.findUnique({
        //   where: {
        //     id: campaignBrand.id,
        //   },
        // });

        // Create sheet in google sheet
        const data = await createNewSheetWithHeaderRows({
          title: campaignTitle,
          rows: ['Creator name', 'Creator Email', 'Video Link', 'Feedback Form'],
        });

        // Create Campaign
        const campaign = await tx.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            status: campaignStage as CampaignStatus,
            brandTone: brandTone,
            productName: productName,
            sheetId: data.sheetId.toString(),
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaignObjectives,
                images: publicURL.map((image: any) => image) || '',
                agreementFrom: agreementForm,
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
          },
          include: {
            campaignBrief: true,
          },
        });

        // Create submission requirement
        const submissionTypes = await tx.submissionType.findMany({
          where: {
            NOT: {
              type: 'OTHER',
            },
          },
        });

        const defaultRequirements = submissionTypes.map((item) => ({
          submissionTypeId: item.id,
          order:
            item.type === 'AGREEMENT_FORM' ? 1 : item.type === 'FIRST_DRAFT' ? 2 : item.type === 'FINAL_DRAFT' ? 3 : 4,
          campaignId: campaign.id,
          startDate:
            item.type === 'AGREEMENT_FORM'
              ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'First Draft').startDate).toDate()
              : item.type === 'FIRST_DRAFT'
                ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'Agreement').startDate).toDate()
                : item.type === 'FINAL_DRAFT'
                  ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'Final Draft').startDate).toDate()
                  : dayjs(timeline.find((item: any) => item.timeline_type.name === 'Posting').startDate).toDate(),
          endDate:
            item.type === 'AGREEMENT_FORM'
              ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'First Draft').endDate).toDate()
              : item.type === 'FIRST_DRAFT'
                ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'Agreement').endDate).toDate()
                : item.type === 'FINAL_DRAFT'
                  ? dayjs(timeline.find((item: any) => item.timeline_type.name === 'Final Draft').endDate).toDate()
                  : dayjs(timeline.find((item: any) => item.timeline_type.name === 'Posting').endDate).toDate(),
        }));

        defaultRequirements.forEach(async (item) => {
          await tx.campaignSubmissionRequirement.create({
            data: {
              campaignId: campaign.id,
              submissionTypeId: item.submissionTypeId,
              startDate: item.startDate,
              endDate: item.endDate,
              order: item.order,
            },
          });
        });

        // Create Campaign Timeline
        const timelines: CampaignTimeline[] = await Promise.all(
          timeline.map(async (item: any, index: number) => {
            const submission = await tx.submissionType.findFirst({
              where: {
                type:
                  item.timeline_type.name === 'First Draft'
                    ? 'FIRST_DRAFT'
                    : item.timeline_type.name === 'Agreement'
                      ? 'AGREEMENT_FORM'
                      : item.timeline_type.name === 'Final Draft'
                        ? 'FINAL_DRAFT'
                        : item.timeline_type.name === 'Posting'
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
        if (hasBrand) {
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

        // if (!brand) {
        //   const company = await tx.company.findUnique({
        //     where: {
        //       id: campaignBrand.id,
        //     },
        //   });
        //   await tx.campaign.update({
        //     where: {
        //       id: campaign.id,
        //     },
        //     data: {
        //       company: { connect: { id: company?.id } },
        //     },
        //   });
        // } else {
        //   await tx.campaign.update({
        //     where: {
        //       id: campaign.id,
        //     },
        //     data: {
        //       brand: { connect: { id: campaignBrand.id } },
        //     },
        //   });
        // }

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

        const filterTimelines = timelines.filter((timeline) => timeline.for === 'admin');

        const test = await Promise.all(
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

        await Promise.all(
          filterTimelines.map((item) =>
            tx.campaignTask.create({
              data: {
                campaignTimelineId: item.id,
                campaignId: item.campaignId,
                task: item.name,
                status: 'IN_PROGRESS',
                dueDate: dayjs(item.endDate).format(),
                campaignTaskAdmin: {
                  create: test.map((admin: any) => ({
                    userId: admin.adminId,
                  })),
                },
              },
            }),
          ),
        );

        logChange('Created', campaign.id, req);
        return res.status(200).json({ campaign, message: 'Campaign created successfully.' });
      },
      {
        timeout: 500000,
      },
    );
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
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

    if (user?.admin?.mode === 'god') {
      campaigns = await prisma.campaign.findMany({
        include: {
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: true,
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
                  user: true,
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
                  // creatorAgreement: true,
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
          logistic: true,
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
          submission: {
            include: {
              submissionType: true,
              dependencies: true,
            },
          },
          brand: true,
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
                  user: true,
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
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        brand: true,
        company: true,
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
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
        campaignAdmin: {
          select: {
            admin: {
              select: {
                user: {
                  select: {
                    id: true,
                    name: true,
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
        campaignSubmissionRequirement: {
          include: {
            submissionType: {
              select: {
                type: true,
              },
            },
          },
        },
        submission: {
          include: {
            submissionType: true,
            dependencies: true,
            dependentOn: true,
          },
        },
        logistic: true,
      },
    });
    return res.status(200).json(campaign);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const matchCampaignWithCreator = async (req: Request, res: Response) => {
  const { userid } = req.session;

  try {
    let campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimeline: true,
        brand: true,
        company: true,
        pitch: true,
        bookMarkCampaign: true,
        shortlisted: true,
        logistic: true,
      },
    });

    campaigns = campaigns.filter(
      (campaign) => campaign.campaignTimeline.find((timeline) => timeline.name === 'Open For Pitch')?.status === 'OPEN',
    );

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

    const matchCampaign = (user: any, campaign: any) => {
      const lang2 = user?.creator?.languages.includes('Chinese')
        ? // eslint-disable-next-line no-unsafe-optional-chaining
          [...user?.creator?.languages, 'Chinese']
        : // eslint-disable-next-line no-unsafe-optional-chaining
          [...user?.creator?.languages];
      let newGender2 = '';
      if (user?.creator.pronounce === 'he/him') {
        newGender2 = 'male';
      } else if (user?.creator.pronounce === 'she/her') {
        newGender2 = 'female';
      } else {
        newGender2 = 'nonbinary';
      }

      const match = {
        languages: false,
        interests: false,
        gender: false,
        age: false,
      };

      function hasCommonElement(arr1: string[], arr2: string[]): boolean {
        return arr1?.some((value) => arr2.includes(value));
      }

      const languagesMatch = hasCommonElement(campaign?.campaignRequirement?.language || [], lang2);

      if (languagesMatch) {
        match.languages = true;
      }

      if (campaign?.campaignRequirement?.gender.includes(newGender2)) {
        match.gender = true;
      }

      // age
      const birthDate = new Date(user?.creator?.birthDate);
      const today = new Date();

      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDifference = today.getMonth() - birthDate.getMonth();

      if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      function isAgeInRange(age: number, ranges: string[]): boolean {
        return ranges?.some((range) => {
          const [min, max] = range.split('-').map(Number);
          return age >= min && age <= max;
        });
      }
      const finalAge = isAgeInRange(age, campaign?.campaignRequirement?.age);

      if (finalAge) {
        match.age = true;
      }

      const interestArr = user?.creator?.interests.map((item: any) => item.name.toLowerCase());
      function hasCommonElement2(arr1: string[], arr2: string[]): boolean {
        return arr1.some((value) => arr2.includes(value));
      }

      const interestsMatch = hasCommonElement2(campaign?.campaignRequirement?.creator_persona || [], interestArr);

      if (interestsMatch) {
        match.interests = true;
      }

      function allMatchTrue(match: any): boolean {
        return Object.values(match).every((value) => value === true);
      }

      const finalMatch = allMatchTrue(match);
      return finalMatch;
    };

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
      interestWeight = 0.8,
      requirementWeight = 0.2,
    ) => {
      return interestMatch * interestWeight + requirementMatch * requirementWeight;
    };

    // const getPercentageMatch = (user: any, campaign: any) => {
    //   const creatorInterest = user?.creator?.interests.map((item: any) => item.name.toLowerCase());
    //   const campInterest = campaign?.campaignBrief?.interests.map((e: string) => e.toLowerCase());

    //   function getMatchingElements(arr1: string[], arr2: string[]): string[] {
    //     return arr1.filter((value) => arr2.includes(value));
    //   }

    //   const matchedInterests = getMatchingElements(creatorInterest, campInterest);
    //   const percantage = (matchedInterests.length / campInterest.length) * 100;

    //   return percantage;
    // };

    // const matchedCampaign = campaigns?.filter((item) => matchCampaign(user, item));

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

    const sortedMatchedCampaigns = matchedCampaignWithPercentage.sort((a, b) => b.percentageMatch - a.percentageMatch);

    return res.status(200).json(sortedMatchedCampaigns);
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
        brand: true,
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
        brand: true,
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
            brand: true,
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

  try {
    const campaign = await prisma.campaign.update({
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

    if (campaign?.shortlisted.length && campaign?.status === 'PAUSED') {
      campaign?.shortlisted?.map(async (value) => {
        const { title, message } = notificationMaintenance(campaign.name);

        const data = await saveNotification({
          userId: value.userId as string,
          title: title,
          message: message,
          entity: 'Status',
          entityId: campaign.id,
        });
        io.to(clients.get(value.userId)).emit('notification', data);
      });
    }

    if (campaign?.status === 'ACTIVE') {
      for (const admin of campaign.campaignAdmin) {
        const { title, message } = notificationCampaignLive(campaign.name);

        const data = await saveNotification({
          userId: admin.adminId,
          title: title,
          message: message,
          entity: 'Status',
          entityId: campaign.id,
        });

        io.to(clients.get(admin.adminId)).emit('notification', data);
      }
    }

    io.emit('campaignStatus', campaign);

    return res.status(200).json({ message: 'Campaign stage changed successfully.', status: campaign?.status });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const closeCampaign = async (req: Request, res: Response) => {
  const { id } = req.params;

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
  const { id, name, description, campaignInterests, campaignIndustries } = req.body;

  try {
    const updatedCampaign = await prisma.campaign.update({
      where: {
        id: id,
      },
      data: {
        name: name,
        description: description,
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

    const message = 'Updated campaign info';
    logChange(message, id, req);
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
    });

    const message = 'Campaign requirements updated successfully.';
    logChange(message, campaignId, req);
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
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const data = await Promise.all(
      timeline.map(async (item: any, index: number) => {
        const result = await prisma.campaignTimeline.upsert({
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
          },
          create: {
            name: item?.timeline_type.name,
            for: item?.for,
            duration: parseInt(item.duration),
            startDate: dayjs(item?.startDate) as any,
            endDate: dayjs(item?.endDate) as any,
            campaignId: campaign?.id,
            order: index + 1,
          },
          include: {
            campaignTasks: true,
          },
        });
        return result;
      }),
    );

    // await Promise.all(
    //   data.map(async (item: any) => {
    //     // //console.log(item);
    //     const isExist = await prisma.campaignTask.findUnique({
    //       where: {
    //         id: item.campaignTasks.id,
    //       },
    //     });

    //     if (isExist) {
    //       await prisma.campaignTask.update({
    //         where: {
    //           id: item.campaignTasks.id,
    //         },
    //         data: {
    //           startDate: dayjs(item.startDate) as any,
    //           endDate: dayjs(item.endDate) as any,
    //         },
    //       });
    //     }
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

    // Promise.all(
    //   data.map(async (item: any) => {
    //     await prisma.campaignTask.update({
    //       where: {
    //         campaignTimelineId: item.id,
    //       },
    //       data: {
    //         startDate: dayjs(item.startDate) as any,
    //         endDate: dayjs(item.endDate) as any,
    //       },
    //     });
    //   }),
    // );

    // for (const item of timeline) {
    //   const a = await prisma.campaignTimeline.update({
    //     where: {
    //       id: item.id,
    //     },
    //     data: {
    //       name: item.timeline_type?.name,
    //       for: item?.for,
    //       duration: parseInt(item.duration),
    //       startDate: dayjs(item?.startDate) as any,
    //       endDate: dayjs(item?.endDate) as any,
    //       campaignId: campaign?.id,
    //       order: index + 1,
    //     },
    //   });
    // }

    // campaign?.campaignAdmin?.forEach((admin: any) => {
    //   timelines
    //     .filter((elem: any) => elem.for === 'admin')
    //     .forEach(async (item: any) => {
    //       await assignTask(admin?.adminId, campaign?.id, item?.id);
    //     });
    // });

    const message = 'Updated timeline';
    logChange(message, id, req);
    return res.status(200).json({ message: message });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

// Get First Draft by user id and campaign id
export const getFirstDraft = async (req: Request, res: Response) => {
  // const { creatorId, campaignId } = req.query;
  // try {
  //   const firstDraft = await prisma.firstDraft.findMany({
  //     where: {
  //       creatorId: creatorId as any,
  //       campaignId: campaignId as any,
  //     },
  //   });
  //   return res.status(200).json(firstDraft);
  // } catch (error) {
  //   //console.log(error);
  //   return res.status(400).json(error);
  // }
};

export const changePitchStatus = async (req: Request, res: Response) => {
  const { status, pitchId } = req.body;

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

    if (status === 'approved') {
      await prisma.$transaction(
        async (tx) => {
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

          shortlisted(user.email, campaignName, creatorName ?? 'Creator', campaignId);

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
            io.to(socketId).emit('shortlisted', { message: 'shortlisted' });
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
          timeout: 10000,
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

      for (const submission of submissions) {
        await prisma.task.delete({
          where: {
            id: submission.task?.id,
          },
        });
      }

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
    }

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
        brand: true,
        company: true,
        pitch: true,
        shortlisted: true,
        invoice: true,
        submission: true,
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

    const adjustedData = {
      ...campaign,
      totalCompletion:
        (campaign.submission.filter((submission) => submission.userId === userid && submission.status === 'APPROVED')
          .length /
          campaign.submission.filter((submission) => submission.userId === userid).length) *
          100 || null,
    };

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
            brand: true,
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

  const fileName = `${userid}_pitch.mp4`;

  try {
    if (!(req.files as any).pitchVideo) {
      return res.status(404).json({ message: 'Pitch Video not found.' });
    }

    const file = (req.files as any).pitchVideo;

    const filePath = `/tmp/${fileName}`;
    const compressedFilePath = `/tmp/${userid}_compressed.mp4`;

    await file.mv(filePath);

    const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
    const channel = await amqp.createChannel();
    await channel.assertQueue('pitch');

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
      {
        persistent: true,
      },
    );

    await channel.close();
    await amqp.close();

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
        campaign: true,
      },
    });

    console.log('Tracking', logistic);

    //Email for tracking logistics
    tracking(
      logistic.user.email,
      logistic.campaign.name,
      logistic.user.name ?? 'Creator',
      logistic.trackingNumber,
      logistic.campaignId,
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
          },
        },
      },
    });

    if (status === 'Product_has_been_received') {
      // Call deliveryConfirmation function
      deliveryConfirmation(
        updated.user.email,
        updated.campaign.name,
        updated.user.name ?? 'Creator',
        updated.campaignId,
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

    return res.status(200).json({ message: 'Logistic status updated successfully.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const shortlistCreator = async (req: Request, res: Response) => {
  const { newVal: creators, campaignId } = req.body;

  try {
    await prisma.$transaction(
      async (tx) => {
        const campaign = await tx.campaign.findUnique({
          where: {
            id: campaignId,
          },
          include: {
            thread: true,
            campaignBrief: true,
          },
        });

        if (!campaign) {
          return res.status(404).json({ message: 'Campaign not found.' });
        }

        const timelines = await tx.campaignTimeline.findMany({
          where: {
            AND: [
              {
                campaignId: campaign.id,
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

        // Find creator information by creator id
        const data = await Promise.all(
          creators.map((creator: Creator) =>
            tx.user.findUnique({
              where: {
                id: creator.id,
              },
              include: {
                creator: true,
                paymentForm: true,
              },
            }),
          ),
        );

        // Generating a pdf with creator information
        for (const creator of data) {
          // const url = await generateAgreement(creator, campaignInfo);

          // Create creator agreement
          await tx.creatorAgreement.create({
            data: {
              userId: creator.id as string,
              campaignId: campaign?.id as any,
              agreementUrl: '',
            },
          });
        }

        // Create a shortlisted creator data
        const shortlistedCreators = await Promise.all(
          creators.map(async (creator: any) => {
            return await tx.shortListedCreator.create({
              data: {
                userId: creator.id,
                campaignId: campaignId,
              },
              include: {
                user: true,
              },
            });
          }),
        );
        // Create submissions for creator
        for (const creator of shortlistedCreators) {
          const board = await tx.board.findUnique({
            where: {
              userId: creator.userId,
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
                  userId: creator.userId as string,
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

          const agreement = submissions.find((submission) => submission?.submissionType.type === 'AGREEMENT_FORM');
          const draft = submissions.find((submission) => submission?.submissionType.type === 'FIRST_DRAFT');
          const finalDraft = submissions.find((submission) => submission?.submissionType.type === 'FINAL_DRAFT');
          const posting = submissions.find((submission) => submission?.submissionType.type === 'POSTING');

          const dependencies = [
            { submissionId: draft?.id, dependentSubmissionId: agreement?.id },
            { submissionId: finalDraft?.id, dependentSubmissionId: draft?.id },
            { submissionId: posting?.id, dependentSubmissionId: finalDraft?.id },
          ];

          const filteredDependencies = dependencies.filter((dep) => dep.submissionId && dep.dependentSubmissionId);

          await tx.submissionDependency.createMany({
            data: filteredDependencies,
          });
        }

        const admins = await tx.campaignAdmin.findMany({
          where: {
            campaignId: campaignId,
          },
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        });

        await Promise.all(
          shortlistedCreators.map(async (creator: any) => {
            const data = await saveNotification({
              userId: creator.userId as string,
              entityId: campaignId as string,
              message: `Congratulations! You've been shortlisted for the ${campaign?.name} campaign.`,
              entity: 'Shortlist',
            });
            const socketId = clients.get(creator.userId);
            if (socketId) {
              io.to(socketId).emit('notification', data);
            } else {
              console.log(`User with ID ${creator.userId} is not connected.`);
            }

            if (!campaign || !campaign.thread) {
              return res.status(404).json({ message: 'Campaign or thread not found' });
            }

            const isThreadExist = await tx.userThread.findFirst({
              where: {
                threadId: campaign.thread.id,
                userId: creator.userId as string,
              },
            });

            if (!isThreadExist) {
              await tx.userThread.create({
                data: {
                  threadId: campaign.thread.id,
                  userId: creator.userId as string,
                },
              });
            }
          }),
        );
      },
      {
        timeout: 10000,
      },
    );

    return res.status(200).json({ message: 'Successfully shortlisted' });
  } catch (error) {
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
  const { paymentAmount, user, campaignId, id: agreementId } = JSON.parse(req.body.data);

  let agreementForm;

  try {
    if (req?.files && (req?.files as any)?.agreementForm) agreementForm = (req?.files as any)?.agreementForm;

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

    const agreement = await prisma.creatorAgreement.findUnique({
      where: {
        id: agreementId,
      },
    });

    if (!agreement) {
      return res.status(404).json({ message: 'Agreement not found.' });
    }

    // const version = agreement?.version ? agreement?.version + 1 : 1;

    // const agreementsPath = await agreementInput({
    //   date: dayjs().format('ddd LL'),
    //   creatorName: creator.name as string,
    //   icNumber: creator.paymentForm?.icNumber as string,
    //   address: creator.creator?.address as string,
    //   agreement_endDate: dayjs().add(1, 'M').format('ddd LL'),
    //   now_date: dayjs().format('ddd LL'),
    //   creatorAccNumber: creator.paymentForm?.bankAccountNumber as string,
    //   creatorBankName: creator.paymentForm?.bankName as string,
    //   paymentAmount: paymentAmount,
    //   agreementFormUrl: campaign?.campaignBrief?.agreementFrom as string,
    //   version: version,
    // });

    // const pdfPath = await pdfConverter(
    //   agreementsPath,
    //   path.resolve(__dirname, `../form/pdf/${creator.name?.split(' ').join('_')}.pdf`),
    // );

    const url = await uploadAgreementForm(
      agreementForm.tempFilePath,
      `${creator.id?.split(' ').join('_')}-${campaign.name}.pdf`,
      'creatorAgreements',
    );

    // Create creator agreement
    await prisma.creatorAgreement.update({
      where: {
        id: agreementId,
      },
      data: {
        userId: creator.id,
        campaignId: campaign.id,
        agreementUrl: url,
        updatedAt: dayjs().format(),
        amount: paymentAmount,
      },
    });

    // await fs.promises.unlink(pdfPath);

    return res.status(200).json({ message: 'Payment amount Updated.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const sendAgreement = async (req: Request, res: Response) => {
  const { user, id: agreementId, agreementUrl, campaignId } = req.body;
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
      },
    });

    console.log('Update Agreement', agreement);

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
    }

    return res.status(200).json({ message: 'Agreement has been sent.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignImages = async (req: Request, res: Response) => {
  const { campaignImages, campaignId } = req.body;
  const newImages: string[] = [];
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
      console.log('NEW', newImages);
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [newImages].flat(),
        },
      });
    } else {
      console.log('OLD', campaignImages);
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign?.campaignId,
        },
        data: {
          images: [campaignImages].flat(),
        },
      });
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

    return res.status(200).json({ message: 'Pitch has been draft.' });
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
      include: {
        logistic: true,
        brand: true,
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

    const adjustedCampaigns = campaigns
      .filter(
        (item) =>
          item.shortlisted.some((val) => val.userId === user.id) || item.pitch.some((val) => val.userId === user.id),
      )
      .map((campaign) => ({
        ...campaign,
        pitch: campaign.pitch.find((pitch) => pitch.userId === user.id) ?? null,
        shortlisted: campaign.shortlisted.find((shortlisted) => shortlisted.userId === user.id) ?? null,
        creatorAgreement: campaign.creatorAgreement.find((agreement) => agreement.userId === user.id) ?? null,
        submission: campaign.submission.filter((submission) => submission.userId === user.id) ?? null,
        totalCompletion:
          (campaign.submission.filter((submission) => submission.userId === user.id && submission.status === 'APPROVED')
            .length /
            campaign.submission.filter((submission) => submission.userId === user.id).length) *
            100 || null,
      }));

    return res.status(200).json(adjustedCampaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};