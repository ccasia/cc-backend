import { Request, Response } from 'express';
import { CampaignStatus, CampaignSubmissionRequirement, CampaignTimeline, Entity, PrismaClient } from '@prisma/client';

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
        const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
        publicURL.push(url);
      }
    }

    let agreementFormURL = '';

    if (req.files && req.files.agreementForm) {
      const form = (req.files as any).agreementForm;
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
      const submissionTypes = await prisma.submissionType.findMany({
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
      await Promise.all(
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

      admins.map(async (admin: any) => {
        const existing = await prisma.campaignAdmin.findUnique({
          where: {
            adminId_campaignId: {
              adminId: admin?.id,
              campaignId: campaign?.id,
            },
          },
        });

        if (existing) {
          return res.status(400).json({ message: 'Admin  exists' });
        }

        await prisma.campaignAdmin.create({
          data: {
            campaignId: (campaign as any).id as any,
            adminId: admin?.id,
          },
        });
        const data = await saveNotification(
          admin.id,
          Title.Create,
          `You've been assign to Campaign ${campaign.name}.`,
          Entity.Campaign,
        );

        io.to(clients.get(admin.id)).emit('notification', data);
      });

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
        campaignLogs: true,
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
  const { campaignId, content } = req.body;
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

    if (req.files && req.files.pitchVideo) {
      const { pitchVideo } = req.files as any;

      const job = {
        tempFilePath: pitchVideo.tempFilePath,
        name: `${user?.id}-${campaign?.id}-pitch.mp4`,
      };

      const childProcess = fork(path.resolve('src/helper/video.ts'));

      childProcess.send(job);

      childProcess.on('message', async (data: any) => {
        io.to(clients.get(user?.id)).emit('pitch-loading', { progress: data.progress, campaignId: campaignId });
        if (data.statusCode === 200) {
          const publicURL = await uploadPitchVideo(path.resolve(`src/upload/${job.name}`), job.name, 'pitchVideo');
          fs.unlinkSync(path.resolve(`src/upload/${job.name}`));
          await prisma.pitch.create({
            data: {
              type: 'video',
              content: publicURL,
              userId: id as string,
              campaignId: campaignId,
              status: 'undecided',
            },
          });
          io.to(clients.get(user?.id)).emit('pitch-uploaded', {
            name: 'Uploading pitch video is complete.',
            campaignId: campaign?.id,
          });
        }
      });

      childProcess.on('error', () => {
        fs.unlinkSync(path.resolve(`src/upload/${job.name}`));
        console.log('There is error when uploading file');
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

  // try {
  //   const campaign = await prisma.campaign.findUnique({
  //     where: {
  //       id: campaignId,
  //     },
  //     include: {
  //       pitch: true,
  //       campaignAdmin: true,
  //     },
  //   });

  //   if (!campaign) {
  //     return res.status(404).json({ message: 'No campaign found.' });
  //   }

  //   if (campaign.pitch.some((item) => item.userId.includes(id as any))) {
  //     return res.status(404).json({ message: 'You have make a pitch for this campaign.' });
  //   }

  //   const creator = await prisma.user.findUnique({
  //     where: {
  //       id: id,
  //     },
  //   });

  //   if (!creator) {
  //     return res.status(404).json({ message: 'Creator not found.' });
  //   }

  //   if (req.files && req.files.pitchVideo) {
  //     const { pitchVideo } = req.files as any;
  //     const job = {
  //       tempFilePath: pitchVideo.tempFilePath,
  //       name: pitchVideo.name,
  //     };
  //     channel.assertQueue('videoQueue');

  //     channel.sendToQueue('videoQueue', Buffer.from(JSON.stringify(job)));
  //     return res.status(200).json({ message: 'Successfully Pitch !' });
  //     // send to compress queue

  //     // RABBITMQ
  //     // const conn = await amqplib.connect(`${process.env.RABBIT_MQ}`);
  //     // const channel = await conn.createChannel();
  //     // channel.assertQueue('uploadVideo', {
  //     //   durable: true,
  //     // });

  //     // const publicURL = await uploadPitchVideo(pitchVideo.tempFilePath, pitchVideo.name, 'pitchVideo');

  //     // const pitch = await prisma.pitch.create({
  //     //   data: {
  //     //     type: 'video',
  //     //     campaignId: campaign?.id,
  //     //     userId: creator?.id,
  //     //     content: '',
  //     //     status: 'undecided',
  //     //   },
  //     // });

  //     // channel.sendToQueue(
  //     //   'uploadVideo',
  //     //   Buffer.from(
  //     //     JSON.stringify({
  //     //       content: pitchVideo,
  //     //       pitchId: pitch.id,
  //     //     }),
  //     //   ),
  //     // );
  //   } else {
  //     await prisma.pitch.create({
  //       data: {
  //         type: 'text',
  //         campaignId: campaign?.id,
  //         userId: creator?.id,
  //         content: content,
  //       },
  //     });
  //   }

  //   const newPitch = await saveNotification(
  //     creator.id,
  //     Title.Create,
  //     `Your pitch has been successfully sent.`,
  //     Entity.Pitch,
  //   );

  //   io.to(clients.get(creator.id)).emit('notification', newPitch);

  //   const admins = campaign.campaignAdmin;

  //   const notifications = admins.map(async ({ adminId }) => {
  //     const notification = await saveNotification(
  //       adminId,
  //       Title.Create,
  //       `New Pitch By ${creator.name} for campaign ${campaign.name}`,
  //       Entity.Pitch,
  //     );
  //     io.to(clients.get(adminId)).emit('notification', notification);
  //   });

  //   await Promise.all(notifications);

  //   return res.status(200).json({ message: 'Successfully Pitch !' });
  // } catch (error) {
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
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

        const tasks = await prisma.campaignTask.findMany({
          where: {
            AND: [
              {
                userId: userid,
              },
              {
                campaignId: campaign?.id,
              },
            ],
          },
        });
        return { ...campaign, tasks };
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

  // try {
  //   const campaign = await prisma.campaign.findUnique({
  //     where: {
  //       id: id,
  //     },
  //     include: {
  //       campaignTimeline: true,
  //       campaignBrief: true,
  //       campaignAdmin: true,
  //       campaignTasks: true,
  //     },
  //   });

  //   if (!campaign) {
  //     return res.status(404).json({ message: 'Campaign not found' });
  //   }

  //   const data = await Promise.all(
  //     timeline.map(async (item: any, index: number) => {
  //       const result = await prisma.campaignTimeline.upsert({
  //         where: {
  //           id: item?.id || item?.timeline_type.id,
  //         },
  //         update: {
  //           name: item?.timeline_type.name,
  //           for: item?.for,
  //           duration: parseInt(item.duration),
  //           startDate: dayjs(item?.startDate) as any,
  //           endDate: dayjs(item?.endDate) as any,
  //           campaignId: campaign?.id,
  //           order: index + 1,
  //         },
  //         create: {
  //           name: item?.timeline_type.name,
  //           for: item?.for,
  //           duration: parseInt(item.duration),
  //           startDate: dayjs(item?.startDate) as any,
  //           endDate: dayjs(item?.endDate) as any,
  //           campaignId: campaign?.id,
  //           order: index + 1,
  //         },
  //         include: {
  //           campaignTasks: true,
  //         },
  //       });
  //       return result;
  //     }),
  //   );

  //   // await Promise.all(
  //   //   data.map(async (item: any) => {
  //   //     // console.log(item);
  //   //     const isExist = await prisma.campaignTask.findUnique({
  //   //       where: {
  //   //         id: item.campaignTasks.id,
  //   //       },
  //   //     });

  //   //     if (isExist) {
  //   //       await prisma.campaignTask.update({
  //   //         where: {
  //   //           id: item.campaignTasks.id,
  //   //         },
  //   //         data: {
  //   //           startDate: dayjs(item.startDate) as any,
  //   //           endDate: dayjs(item.endDate) as any,
  //   //         },
  //   //       });
  //   //     }
  //   //   }),
  //   // );

  //   await prisma.campaignBrief.update({
  //     where: {
  //       campaignId: campaign.id,
  //     },
  //     data: {
  //       startDate: dayjs(campaignStartDate).format(),
  //       endDate: dayjs(campaignEndDate).format(),
  //     },
  //   });

  //   // Promise.all(
  //   //   data.map(async (item: any) => {
  //   //     await prisma.campaignTask.update({
  //   //       where: {
  //   //         campaignTimelineId: item.id,
  //   //       },
  //   //       data: {
  //   //         startDate: dayjs(item.startDate) as any,
  //   //         endDate: dayjs(item.endDate) as any,
  //   //       },
  //   //     });
  //   //   }),
  //   // );

  //   // for (const item of timeline) {
  //   //   const a = await prisma.campaignTimeline.update({
  //   //     where: {
  //   //       id: item.id,
  //   //     },
  //   //     data: {
  //   //       name: item.timeline_type?.name,
  //   //       for: item?.for,
  //   //       duration: parseInt(item.duration),
  //   //       startDate: dayjs(item?.startDate) as any,
  //   //       endDate: dayjs(item?.endDate) as any,
  //   //       campaignId: campaign?.id,
  //   //       order: index + 1,
  //   //     },
  //   //   });
  //   // }

  //   // campaign?.campaignAdmin?.forEach((admin: any) => {
  //   //   timelines
  //   //     .filter((elem: any) => elem.for === 'admin')
  //   //     .forEach(async (item: any) => {
  //   //       await assignTask(admin?.adminId, campaign?.id, item?.id);
  //   //     });
  //   // });

  //   const message = 'Updated timeline';
  //   logChange(message, id, req);
  //   return res.status(200).json({ message: message });
  // } catch (error) {
  //   console.log(error);
  //   return res.status(400).json(error);
  // }
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
      await prisma.shortListedCreator.create({
        data: {
          userId: pitch?.userId,
          campaignId: pitch?.campaignId,
        },
      });
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

      const campaign = await prisma.campaign.findUnique({
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

      await prisma.userThread.create({
        data: {
          threadId: campaign.thread.id,
          userId: pitch.userId,
        },
      });

      // const timelines = await prisma.campaignTimeline.findMany({
      //   where: {
      //     campaignId: pitch?.campaignId,
      //   },
      // });

      // timelines
      //   .filter((item: any) => item.for === 'creator' && item.name !== 'Open For Pitch')
      //   .forEach(async (item: any, index: number) => {
      //     await prisma.campaignTask.create({
      //       data: {
      //         userId: pitch?.userId,
      //         task: item?.name,
      //         campaignTimelineId: item?.id,
      //         campaignId: pitch?.campaignId,
      //         startDate: item?.startDate,
      //         endDate: item?.endDate,
      //         status: item.name === 'Agreement' ? ('IN_PROGRESS' as any) : 'NOT_STARTED',
      //       },
      //     });
      //   });
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
      await prisma.campaignTask.deleteMany({
        where: {
          AND: [
            {
              userId: pitch?.userId,
            },
            {
              campaignId: pitch?.campaignId,
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
        campaignTasks: {
          where: {
            userId: userid,
          },
        },
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
