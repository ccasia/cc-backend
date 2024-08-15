import { Request, Response } from 'express';
import {
  CampaignAdmin,
  CampaignRequirement,
  CampaignStatus,
  CampaignSubmissionRequirement,
  CampaignTask,
  CampaignTimeline,
  Creator,
  Entity,
  Interest,
  PrismaClient,
  Submission,
} from '@prisma/client';

import { uploadAgreementForm, uploadImage, uploadPitchVideo } from 'src/config/cloudStorage.config';
import dayjs from 'dayjs';
import { logChange } from 'src/service/campaignServices';
import { Title, saveNotification } from './notificationController';
import { clients, io } from 'src/server';
import amqplib from 'amqplib';
import fs from 'fs';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { fork } from 'child_process';
import path from 'path';
import { compress } from 'src/helper/compression';
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
  campaignBrand: {
    id: string;
  };
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
}

export const createCampaign = async (req: Request, res: Response) => {
  const {
    campaignTitle,
    campaignBrand,
    campaignStartDate,
    campaignEndDate,
    campaignInterests,
    campaignObjectives,
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
    timeline,
  }: Campaign = JSON.parse(req.body.data);

  try {
    const publicURL: any = [];

    if (req.files && req.files.campaignImages) {
      const images = (req.files as any).campaignImages as [];
      for (const item of images as any) {
        // TODO TEMP: "Error uploading file: ENOENT: no such file or directory, open '/app/src/config/test-cs.json'"
        const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
        publicURL.push(url);
      }
    }

    let agreementFormURL = '';

    if (req.files && req.files.agreementForm) {
      const form = (req.files as any).agreementForm;
      // TODO TEMP: "Error uploading file: ENOENT: no such file or directory, open '/app/src/config/test-cs.json'"
      agreementFormURL = await uploadAgreementForm(form.tempFilePath, form.name, 'agreementForm');
    }

    await prisma.$transaction(async (tx) => {
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

      const brand: any = await tx.brand.findUnique({
        where: {
          id: campaignBrand.id,
        },
      });

      // Create Campaign
      const campaign = await tx.campaign.create({
        data: {
          name: campaignTitle,
          description: campaignDescription,
          status: campaignStage as CampaignStatus,
          campaignBrief: {
            create: {
              title: campaignTitle,
              objectives: campaignObjectives,
              images: publicURL.map((image: any) => image) || '',
              agreementFrom: agreementFormURL,
              startDate: dayjs(campaignStartDate) as any,
              endDate: dayjs(campaignEndDate) as any,
              interests: campaignInterests,
              campaigns_do: campaignDo,
              campaigns_dont: campaignDont,
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
          console.log(submission);

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
      if (!brand) {
        const company = await tx.company.findUnique({
          where: {
            id: campaignBrand.id,
          },
        });
        await tx.campaign.update({
          where: {
            id: campaign.id,
          },
          data: {
            company: { connect: { id: company?.id } },
          },
        });
      } else {
        await tx.campaign.update({
          where: {
            id: campaign.id,
          },
          data: {
            company: { connect: { id: campaignBrand.id } },
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
          });

          if (existing) {
            return res.status(400).json({ message: 'Admin exists' });
          }

          const a = await tx.campaignAdmin.create({
            data: {
              adminId: admin?.id,
              campaignId: campaign.id,
            },
          });

          const data = await saveNotification(
            admin.id,
            Title.Create,
            `You've been assign to Campaign ${campaign.name}.`,
            Entity.Campaign,
          );

          io.to(clients.get(admin.id)).emit('notification', data);
          return a;
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
      return res.status(200).json({ campaign, message: 'Successfully created campaign' });
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};
// Campaign Info for Admin
export const getAllCampaigns = async (req: Request, res: Response) => {
  const id = req.session.userid;
  try {
    const admin = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    const campaigns = await prisma.campaign.findMany({
      where: {
        campaignAdmin: {
          some: {
            adminId: admin?.id,
          },
        },
      },
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
                    industries: true,
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
                    industries: true,
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
        submission: true,
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
      },
    });

    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
      include: {
        creator: {
          include: {
            interests: true,
            industries: true,
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

      const interestArr = user?.creator?.interests.map((item: any) => item.name);
      function hasCommonElement2(arr1: string[], arr2: string[]): boolean {
        return arr1.some((value) => arr2.includes(value));
      }

      const interestsMatch = hasCommonElement2(campaign?.campaignBrief?.interests || [], interestArr);

      if (interestsMatch) {
        match.interests = true;
      }

      function allMatchTrue(match: any): boolean {
        return Object.values(match).every((value) => value === true);
      }

      const finalMatch = allMatchTrue(match);
      return finalMatch;
    };

    const calculateInterestMatchingPercentage = (creatorInterests: Interest[], campaignInterests: []) => {
      const totalInterests = campaignInterests.length;

      const matchingInterests = creatorInterests.filter((interest) =>
        campaignInterests.includes(interest?.name as never),
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

    const getPercentageMatch = (user: any, campaign: any) => {
      const creatorInterest = user?.creator?.interests.map((item: any) => item.name.toLowerCase());
      const campInterest = campaign?.campaignBrief?.interests.map((e: string) => e.toLowerCase());

      function getMatchingElements(arr1: string[], arr2: string[]): string[] {
        return arr1.filter((value) => arr2.includes(value));
      }

      const matchedInterests = getMatchingElements(creatorInterest, campInterest);
      const percantage = (matchedInterests.length / campInterest.length) * 100;

      return percantage;
    };

    const matchedCampaign = campaigns?.filter((item) => matchCampaign(user, item));

    const matchedCampaignWithPercentage = matchedCampaign.map((item) => {
      const interestPercentage = calculateInterestMatchingPercentage(
        user?.creator?.interests as never,
        item.campaignBrief?.interests as any,
      );

      const requirementPercentage = calculateRequirementMatchingPercentage(
        user?.creator as Creator,
        item.campaignRequirement as CampaignRequirement,
      );

      const overallMatchingPercentage = calculateOverallMatchingPercentage(interestPercentage, requirementPercentage);
      return {
        ...item,
        // percentageMatch: getPercentageMatch(user, item),
        percentageMatch: overallMatchingPercentage,
      };
    });

    console.log('ASDSAD', matchedCampaignWithPercentage);

    return res.status(200).json(matchedCampaignWithPercentage);
  } catch (error) {
    console.log(error);
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
      },
    });

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const creatorMakePitch = async (req: Request, res: Response) => {
  const { campaignId, content, type } = req.body;
  const id = req.session.userid;

  // const conn = await amqplib.connect('amqp://host.docker.internal');
  // const channel = await conn.createChannel();
  // channel.assertQueue('videoQueue');

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
      return res.status(400).json({ message: 'You have make a pitch for this campaign.' });
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

    if (type === 'video') {
      await prisma.pitch.create({
        data: {
          type: 'video',
          content: content,
          userId: id as string,
          campaignId: campaignId,
          status: 'undecided',
        },
      });
    } else {
      const pitch = await prisma.pitch.create({
        data: {
          type: 'text',
          content: content,
          userId: id as string,
          campaignId: campaignId,
          status: 'undecided',
        },
      });
    }

    const newPitch = await saveNotification(
      user?.id as string,
      Title.Create,
      `Your pitch has been successfully sent.`,
      Entity.Pitch,
    );

    io.to(clients.get(user?.id)).emit('notification', newPitch);

    const admins = campaign?.campaignAdmin;

    admins?.map(async ({ adminId }) => {
      const notification = await saveNotification(
        adminId,
        Title.Create,
        `New Pitch By ${user?.name} for campaign ${campaign?.name}`,
        Entity.Pitch,
      );
      io.to(clients.get(adminId)).emit('notification', notification);
    });

    // channel.assertQueue('videoQueue');

    // channel.sendToQueue('videoQueue', Buffer.from(JSON.stringify(job)));
    // return res.status(202).json({ message: 'Successfully Pitch !' });
    return res.status(202).json({ message: 'Successfully Pitch !' });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: 'Error' });
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
            campaignBrief: true,
            campaignRequirement: true,
            campaignTimeline: true,
            campaignAdmin: true,
          },
        });

        return { ...campaign };
      }),
    );

    return res.status(200).json({ campaigns });
  } catch (error) {
    console.log(error);
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
        const data = await saveNotification(
          value.userId as string,
          Title.Update,
          `Campaign ${campaign.name} is down for maintenance`,
          Entity.Campaign,
        );
        io.to(clients.get(value.userId)).emit('notification', data);
      });
    }

    if (campaign?.status === 'ACTIVE') {
      campaign.campaignAdmin.forEach(async (admin) => {
        const data = await saveNotification(
          admin.adminId,
          Title.Update,
          `${campaign.name} is up live !`,
          Entity.Campaign,
        );
        io.to(clients.get(admin.adminId)).emit('notification', data);
      });
    }

    io.emit('campaignStatus', campaign);

    return res.status(200).json({ message: 'Successfully changed stage', status: campaign?.status });
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
      const data = await saveNotification(
        item.adminId,
        Title.Update,
        `${campaign.name} is close on ${dayjs().format('ddd LL')}`,
        Entity.Campaign,
      );
      io.to(clients.get(item.adminId)).emit('notification', data);
    });

    return res.status(200).json({ message: 'Campaign is successfully closed.' });
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
                industries: true,
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
        interests: campaignInterests,
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

    const message = "Updated dos and don'ts";
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

    const message = 'Updated requirements';
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
      return res.status(404).json({ message: 'Campaign not found' });
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
    //     // console.log(item);
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
    console.log(error);
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
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
};

export const changePitchStatus = async (req: Request, res: Response) => {
  const { status, pitchId } = req.body;

  try {
    const pitch = await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        status: status,
      },
      include: {
        campaign: true,
      },
    });

    if (pitch.status === 'approved') {
      prisma.$transaction(async (tx) => {
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
          orderBy: {
            order: 'asc',
          },
        });

        const submissions: Submission[] = await Promise.all(
          timelines.map(async (timeline) => {
            return await tx.submission.create({
              data: {
                dueDate: timeline.endDate,
                campaignId: timeline.campaignId,
                userId: pitch.userId as string,
                submissionTypeId: timeline.submissionTypeId as string,
              },
            });
          }),
        );

        await Promise.all(
          submissions.map(async (item, i) => {
            // Skip the first submission as it has no dependency
            if (i > 0) {
              await tx.submissionDependency.create({
                data: {
                  submissionId: submissions[i].id,
                  dependentSubmissionId: submissions[i - 1].id,
                },
              });
            }
          }),
        );

        const data = await saveNotification(
          pitch.userId,
          Title.Create,
          `Congratulations! You've been shortlisted for the ${pitch.campaign.name} campaign.`,
          Entity.Shortlist,
        );

        const socketId = clients.get(pitch.userId);

        if (socketId) {
          io.to(socketId).emit('notification', data);
        } else {
          console.log(`User with ID ${pitch.userId} is not connected.`);
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
          return res.status(404).json({ message: 'Campaign or thread not found' });
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
      });
    } else {
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
    }

    return res.status(200).json({ message: 'Successfully changed' });
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
        campaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
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
      },
    });
    return res.status(200).json(campaign);
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

    console.log(submission);
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
  console.log('=== BEGIN getCampaignLog ===');
  console.log(req.params);
  console.log('=== END getCampaignLog ===');

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
    console.log('=== BEGIN getCampaignLog error ===');
    console.log(error);
    console.log('=== END getCampaignLog error ===');
  }
};

export const uploadVideoTest = async (req: Request, res: Response) => {
  const abortController = new AbortController();
  const { campaignId } = req.body;
  const { userid } = req.session;
  const outputPath = `${campaignId}-${userid}-pitch.mp4`;
  let cancel = false;

  res.on('close', () => {
    console.log('ABORTING....');
    cancel = true;
    fs.unlinkSync(path.resolve(`src/upload/${outputPath}`));
    abortController.abort();
  });

  try {
    if (!cancel) {
      console.log('COMPRESSION START');
      const path: any = await compress(
        (req.files as any).pitchVideo.tempFilePath,
        outputPath,
        (data: number) => {
          io.to(clients.get(req.session.userid)).emit('video-upload', { campaignId: campaignId, progress: data });
        },
        abortController.signal,
      );

      const size = await new Promise((resolve, reject) => {
        fs.stat(path, (err, data) => {
          if (err) {
            reject();
          }
          resolve(data.size);
        });
      });

      console.log('UPLOADING START');
      const a = await uploadPitchVideo(
        path,
        outputPath,
        'pitchVideo',
        size as number,
        (data: number) => {
          io.to(clients.get(req.session.userid)).emit('video-upload', { campaignId: campaignId, progress: data });
        },
        abortController.signal,
      );

      // fs.unlinkSync(path);

      io.to(clients.get(req.session.userid)).emit('video-upload-done', { campaignId: campaignId });

      return res.status(200).json({ publicUrl: a, message: 'Succesfully uploaded' });
    }
  } catch (error) {
    return res.status(400).json(error);
  }
};
