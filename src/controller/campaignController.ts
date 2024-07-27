import { Request, Response } from 'express';
import { CampaignStatus, Entity, PrismaClient } from '@prisma/client';

import { uploadAgreementForm, uploadImage, uploadPitchVideo } from 'src/config/cloudStorage.config';
import dayjs from 'dayjs';
import { assignTask, logChange } from 'src/service/campaignServices';
import { Title, saveNotification } from './notificationController';
import { clients, io } from 'src/server';
import amqplib from 'amqplib';

const prisma = new PrismaClient();

// export const updateDefaultTimeline = async (req: Request, res: Response) => {
//   const {
//     id,
//     openForPitch,
//     shortlistCreator,
//     firstDraft,
//     finalDraft,
//     feedBackFirstDraft,
//     feedBackFinalDraft,
//     filterPitch,
//     agreementSign,
//     qc,
//     posting,
//   } = req.body;

//   try {
//     let newDefaultTimeline;

//     if (!id) {
//       newDefaultTimeline = await prisma.defaultTimelineCampaign.create({
//         data: {
//           openForPitch,
//           shortlistCreator,
//           firstDraft,
//           finalDraft,
//           feedBackFirstDraft,
//           feedBackFinalDraft,
//           filterPitch,
//           agreementSign,
//           qc,
//           posting,
//         },
//       });
//       return res.status(200).json({ message: 'Successfully updated default timeline', newDefaultTimeline });
//     } else {
//       newDefaultTimeline = await prisma.defaultTimelineCampaign.update({
//         where: {
//           id: id,
//         },
//         data: {
//           openForPitch,
//           shortlistCreator,
//           firstDraft,
//           finalDraft,
//           feedBackFirstDraft,
//           feedBackFinalDraft,
//           filterPitch,
//           agreementSign,
//           qc,
//           posting,
//         },
//       });
//       return res.status(200).json({ message: 'Successfully updated default timeline', newDefaultTimeline });
//     }
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// };
export const updateDefaultTimeline = async (req: Request, res: Response) => {
  // const { timeline } = req.body;
  // console.log(timeline);
  // try {
  //   const timelines = await prisma.defaultTimelineCampaign.findMany();
  //   const timelineId = timelines.map((elem) => elem.id);
  //   const defaultTimelineId = defaultTimeline?.map((elem: any) => elem.id);
  //   const missingIds = timelineId.filter((id) => !defaultTimelineId.includes(id));
  //   if (missingIds.length) {
  //     for (const item of missingIds) {
  //       await prisma.defaultTimelineCampaign.delete({
  //         where: {
  //           id: item,
  //         },
  //       });
  //     }
  //   }
  //   for (const item of defaultTimeline) {
  //     if (item.id) {
  //       await prisma.defaultTimelineCampaign.update({
  //         where: {
  //           id: item.id,
  //         },
  //         data: {
  //           timeline_type: item.timeline_type
  //             .split(' ')
  //             .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
  //             .join(' '),
  //           for: item.for,
  //           days: item.days.toString(),
  //         },
  //       });
  //     } else {
  //       await prisma.defaultTimelineCampaign.create({
  //         data: {
  //           timeline_type: item.timeline_type
  //             .split(' ')
  //             .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
  //             .join(' '),
  //           for: item.for,
  //           days: item.days.toString(),
  //         },
  //       });
  //     }
  //   }
  //   return res.status(200).json({ message: 'Successfully updated!' });
  // } catch (error) {
  //   return res.status(400).json({ error });
  // }
};

// export const updateTimeLineType = async (req: Request, res: Response) => {
//   const { timeline } = req.body;

//   console.log(timeline);

//   try {
//     const timelines = await prisma.timelineType.findMany();

//     // ExistingTimelineId
//     const timelineId = timelines.map((elem) => elem.id);
//     // Timeline from client
//     const defaultTimelineId = timeline?.map((elem: any) => elem.id);

//     const missingIds = timelineId.filter((id) => !defaultTimelineId.includes(id));

//     if (missingIds.length) {
//       for (const item of missingIds) {
//         await prisma.timelineType.delete({
//           where: {
//             id: item,
//           },
//         });
//       }
//     }

//     for (const item of timeline) {
//       if (item.id) {
//         const timeline = await prisma.timelineType.update({
//           where: {
//             id: item.id,
//           },
//           data: {
//             name: item.timeline_type
//               .split(' ')
//               .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
//               .join(' '),
//             for: item.for,
//           },
//         });
//       } else {
//         const timeline = await prisma.timelineType.create({
//           data: {
//             name: item.timeline_type
//               .split(' ')
//               .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
//               .join(' '),
//             for: item.for,
//           },
//         });

//         // const dependsOnTimeline = await prisma.timelineType.findFirst({
//         //   where: {
//         //     name: {
//         //       contains: item?.dependsOn,
//         //     },
//         //   },
//         // });

//         // if (dependsOnTimeline) {
//         //   await prisma.timelineTypeDependency.create({
//         //     data: {
//         //       timeline_id: timeline?.id,
//         //       dependsOnTimelineId: dependsOnTimeline?.id,
//         //     },
//         //   });
//         // }
//       }
//     }
//     return res.status(200).json({ message: 'Successfully Updated Timeline Type' });
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// };

// export const updateTimeLineType = async (req: Request, res: Response) => {
//   const { timeline } = req.body;

//   try {
//     const timelineLowerCase = timeline.map((item: any) => item.timeline_type.toLowerCase());
//     const duplicates = timeline.filter(
//       (item: any, index: number) => timelineLowerCase.indexOf(item.timeline_type.toLowerCase()) !== index,
//     );

//     if (duplicates.length) {
//       return res.status(404).json({ message: "There's a duplication of timeline type" });
//     }

//     for (const item of timeline) {
//       // Find existing timeline
//       if (item.id) {
//         const timeline = await prisma.timelineType.update({
//           where: {
//             id: item.id,
//           },
//           data: {
//             name: item.timeline_type
//               .split(' ')
//               .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
//               .join(' '),
//             for: item.for,
//           },
//         });

//         if (item.dependsOn !== 'startDate') {
//           const existingTimeline = await prisma.timelineType.findFirst({
//             where: {
//               name: {
//                 contains: item.dependsOn,
//               },
//             },
//           });

//           if (existingTimeline) {
//             if (item.dependenciesId) {
//               await prisma.timelineTypeDependency.update({
//                 where: {
//                   id: item.dependenciesId,
//                 },
//                 data: {
//                   timeline_id: timeline.id,
//                   dependsOnTimelineId: existingTimeline.id,
//                 },
//               });
//             } else {
//               await prisma.timelineTypeDependency.create({
//                 data: {
//                   timeline_id: timeline.id,
//                   dependsOnTimelineId: existingTimeline.id,
//                 },
//               });
//             }
//           }
//         }
//       } else {
//         const timeline = await prisma.timelineType.create({
//           data: {
//             name: item.timeline_type
//               .split(' ')
//               .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
//               .join(' '),
//             for: item.for,
//           },
//         });

//         if (item.dependsOn !== 'startDate') {
//           const existingTimeline = await prisma.timelineType.findFirst({
//             where: {
//               name: {
//                 contains: item.dependsOn,
//               },
//             },
//           });

//           if (existingTimeline) {
//             await prisma.timelineTypeDependency.create({
//               data: {
//                 timeline_id: timeline.id,
//                 dependsOnTimelineId: existingTimeline.id,
//               },
//             });
//           }
//         }
//       }
//     }
//     return res.status(200).json({ message: 'Successfully Updated Timeline Type' });
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// };

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
  // campaignIndustries: string[];
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

// A helper function for calls to `logChange`
// We can't directly pass `req.session.userid` to the `adminId` parameter because the former is a `string | undefined`
// TODO: If all arguments for `adminId` is `getAdminId(req)`, then consider merging this with `logChange`
const getAdminId = (req: Request): string => {
  const adminId = req.session.userid;
  if (adminId === undefined) {
    throw new Error('Admin ID is undefined');
  }
  return adminId;
};

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

  let campaign: any;

  try {
    const publicURL: any = [];
    let agreementFormURL = '';

    if (req.files && req.files.campaignImages) {
      const images = (req.files as any).campaignImages as [];

      for (const item of images as any) {
        const url = await uploadImage(item.tempFilePath, item.name, 'campaign');
        publicURL.push(url);
      }
    }

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

      let brand: any = await tx.brand.findUnique({
        where: {
          id: campaignBrand.id,
        },
      });

      if (!brand) {
        // eslint-disable-next-line no-useless-catch
        try {
          brand = await tx.company.findUnique({
            where: {
              id: campaignBrand.id,
            },
          });

          campaign = await tx.campaign.create({
            data: {
              name: campaignTitle,
              description: campaignDescription,
              // TODO BUG: This causes a type error
              status: campaignStage as CampaignStatus,
              company: {
                connect: {
                  id: brand?.id,
                },
              },
              campaignBrief: {
                create: {
                  title: campaignTitle,
                  objectives: campaignObjectives,
                  // TODO: We have no storage permissions
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
              campaignTimeline: {
                create: timeline.map((item: any, index: number) => ({
                  name: item.timeline_type?.name,
                  for: item?.for,
                  duration: parseInt(item.duration),
                  startDate: dayjs(item.startDate),
                  endDate: dayjs(item.endDate),
                  order: index + 1,
                })),
              },
            },
            include: {
              campaignTimeline: true,
            },
          });
        } catch (error) {
          throw error;
        }
      } else {
        campaign = await tx.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            // TODO BUG: This causes a type error
            status: campaignStage as CampaignStatus,
            brand: {
              connect: {
                id: brand?.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaignObjectives,
                // TODO: We have no storage permissions
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
            campaignTimeline: {
              create: timeline.map((item: any, index: number) => ({
                name: item.timeline_type?.name,
                for: item?.for,
                duration: parseInt(item.duration),
                startDate: dayjs(item.startDate),
                endDate: dayjs(item.endDate),
                order: index + 1,
              })),
            },
          },
          include: {
            campaignTimeline: true,
          },
        });
      }

      admins.map(async (admin: any) => {
        // TODO: "Foreign key constraint failed on the field: `CampaignAdmin_campaignId_fkey (index)`"
        await prisma.campaignAdmin.create({
          data: {
            campaignId: (campaign as any).id as any,
            adminId: admin?.id,
          },
        });
        // campaign?.CampaignTimeline.filter((elem: any) => elem.for === 'admin').forEach(
        //   async (item: any, index: any) => {
        //     await assignTask(admin?.id, campaign?.id, item.id);
        //   },
        // );
        const data = await saveNotification(
          admin.id,
          Title.Create,
          `You've been assign to Campaign ${campaign.name}.`,
          Entity.Campaign,
        );

        io.to(clients.get(admin.id)).emit('notification', data);
      });

      logChange('Created', campaign.id, getAdminId(req));
      return res.status(200).json({ campaign, message: 'Successfully created campaign' });
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

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
        shortlistCreator: {
          select: {
            creator: {
              include: {
                creator: true,
              },
            },
            creatorId: true,
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
        finalDraft: true,
        firstDraft: true,
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
        shortlistCreator: {
          select: {
            creatorId: true,
            creator: {
              include: {
                creator: true,
              },
            },
          },
        },
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

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
      include: {
        pitch: true,
        campaignAdmin: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'No campaign found.' });
    }

    if (campaign.pitch.some((item) => item.userId.includes(id as any))) {
      return res.status(404).json({ message: 'You have make a pitch for this campaign.' });
    }

    const creator = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    if (!creator) {
      return res.status(404).json({ message: 'Creator not found.' });
    }

    if (req.files && req.files.pitchVideo) {
      const { pitchVideo } = req.files as any;
      const conn = await amqplib.connect('amqp://host.docker.internal');
      const channel = await conn.createChannel();
      channel.assertQueue('uploadVideo', {
        durable: false,
      });

      const pitch = await prisma.pitch.create({
        data: {
          type: 'video',
          campaignId: campaign?.id,
          userId: creator?.id,
          content: '',
        },
      });

      channel.sendToQueue(
        'uploadVideo',
        Buffer.from(
          JSON.stringify({
            content: pitchVideo,
            pitchId: pitch.id,
          }),
        ),
      );
    } else {
      await prisma.pitch.create({
        data: {
          type: 'text',
          campaignId: campaign?.id,
          userId: creator?.id,
          content: content,
        },
      });
    }

    const newPitch = await saveNotification(
      creator.id,
      Title.Create,
      `Your pitch has been successfully sent.`,
      Entity.Pitch,
    );
    console.log('IDDDDDDD', creator.id);
    io.to(clients.get(creator.id)).emit('notification', newPitch);
    console.log('Status done');

    const admins = campaign.campaignAdmin;

    const notifications = admins.map(async ({ adminId }) => {
      const notification = await saveNotification(
        adminId,
        Title.Create,
        `New Pitch By ${creator.name} for campaign ${campaign.name}`,
        Entity.Pitch,
      );
      io.to(clients.get(adminId)).emit('notification', notification);
    });

    await Promise.all(notifications);

    return res.status(200).json({ message: 'Successfully Pitch !' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getCampaignsByCreatorId = async (req: Request, res: Response) => {
  const { userid } = req.session;
  try {
    const shortlisted = await prisma.shortListedCreator.findMany({
      where: {
        creatorId: userid,
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
      },
    });

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

    await prisma.campaignBrief.update({
      where: {
        campaignId: id,
      },
      data: {
        interests: campaignInterests,
        industries: campaignIndustries,
      },
    });

    const message = 'Updated campaign info';
    logChange(message, id, getAdminId(req));
    return res.status(200).json({ message: message, ...updatedCampaign });
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
    const brand = await prisma.brand.findUnique({ where: { id: campaignBrand.id } });
    const updatedCampaign = await prisma.campaign.update({
      where: { id: id },
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
    logChange(message, updatedCampaign.id, getAdminId(req));
    return res.status(200).json({ message: message, ...updatedCampaign });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateCampaignTimeline = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { timeline, campaignStartDate, campaignEndDate } = req.body;
  // const timelines: { id: any }[] = [];

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        campaignTimeline: true,
        campaignBrief: true,
        campaignAdmin: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const newTimeline = timeline.map((timeline: any, index: number) => ({
      name: timeline.timeline_type.name,
      for: timeline?.for,
      duration: parseInt(timeline.duration),
      startDate: dayjs(timeline?.startDate) as any,
      endDate: dayjs(timeline?.endDate) as any,
      campaignId: campaign?.id,
      order: index + 1,
    }));

    // await prisma.campaignTimeline.deleteMany({
    //   where: {
    //     campaignId: campaign?.id,
    //   },
    // });

    await Promise.all([
      timeline.forEach(async (item: any, index: number) => {
        await prisma.campaignTimeline.update({
          where: {
            id: item.id,
          },
          data: {
            name: item.timeline_type?.name,
            for: item?.for,
            duration: parseInt(item.duration),
            startDate: dayjs(item?.startDate) as any,
            endDate: dayjs(item?.endDate) as any,
            campaignId: campaign?.id,
            order: index + 1,
          },
        });
      }),
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaign.id,
        },
        data: {
          startDate: dayjs(campaignStartDate).format(),
          endDate: dayjs(campaignEndDate).format(),
        },
      }),
    ]);

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

    return res.status(200).json({ message: 'Updated timeline' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// Get First Draft by user id and campaign id
export const getFirstDraft = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.query;
  try {
    const firstDraft = await prisma.firstDraft.findMany({
      where: {
        creatorId: creatorId as any,
        campaignId: campaignId as any,
      },
    });

    return res.status(200).json(firstDraft);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
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
          creatorId: pitch?.userId,
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

      // const timelines = await prisma.campaignTimeline.findMany({
      //   where: {
      //     campaignId: pitch?.campaignId,
      //   },
      //   include: {
      //     dependsOnCampaignTimeline: {
      //       include: {
      //         campaignTimeline: true,
      //       },
      //     },
      //   },
      // });

      // timelines
      //   .filter((item: any) => item.for === 'creator' && item.name !== 'Open For Pitch')
      //   .forEach(async (item: any, index: number) => {
      //     await prisma.campaignTimelineTask.create({
      //       data: {
      //         userId: pitch?.userId,
      //         task: item?.name,
      //         campaignTimelineId: item?.id,
      //         campaignId: pitch?.campaignId,
      //         startDate: item?.startDate,
      //         endDate: item?.endDate,
      //         status: index === 0 ? ('IN_PROGRESS' as any) : 'NOT_STARTED',
      //       },
      //     });
      //   });
    } else {
      const isExist = await prisma.shortListedCreator.findUnique({
        where: {
          creatorId_campaignId: {
            creatorId: pitch?.userId,
            campaignId: pitch?.campaignId,
          },
        },
      });

      if (isExist) {
        await prisma.shortListedCreator.delete({
          where: {
            creatorId_campaignId: {
              creatorId: pitch?.userId,
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
        campaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        campaignTasks: {
          where: {
            userId: userid,
          },
        },
        brand: true,
        company: true,
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
              },
            },
          },
        },
      },
    });
    return res.status(200).json(campaings);
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

export const editRequirement = async (req: Request, res: Response) => {
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
    const requirement = await prisma.campaignRequirement.update({
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
    return res.status(200).json({ message: 'Successfully updated', newRequirement: requirement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editDosandDonts = async (req: Request, res: Response) => {
  const { campaignId, campaignDo, campaignDont } = req.body;

  try {
    await prisma.campaignBrief.update({
      where: {
        campaignId: campaignId,
      },
      data: {
        campaigns_do: campaignDo,
        campaigns_dont: campaignDont,
      },
    });
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
