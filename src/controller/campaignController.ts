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
  campaignIndustries: string[];
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
    campaignIndustries,
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
    agreementFrom,
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
                  startDate: campaignStartDate,
                  endDate: campaignEndDate,
                  interests: campaignInterests,
                  industries: campaignIndustries,
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
              CampaignTimeline: {
                create: timeline.map((item: any) => ({
                  name: item.timeline_type?.name,
                  for: item?.for,
                  duration: parseInt(item.duration),
                  startDate: dayjs(item.startDate),
                  endDate: dayjs(item.endDate),
                })),
              },
            },
            include: {
              CampaignTimeline: true,
            },
          });

          campaign?.CampaignTimeline.forEach(async (item: any, index: any) => {
            if (index !== 0) {
              await prisma.campaignTimelineDependency.create({
                data: {
                  campaignTimelineId: campaign.CampaignTimeline[index - 1]?.id,
                  dependsOnCampaignTimelineId: item?.id,
                },
              });
            }
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
            // status: CampaignStatus.active,
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
                startDate: campaignStartDate,
                endDate: campaignEndDate,
                interests: campaignInterests,
                industries: campaignIndustries,
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
            CampaignTimeline: {
              create: timeline.map((item: any) => ({
                name: item.timeline_type?.name,
                for: item?.for,
                duration: parseInt(item.duration),
                startDate: dayjs(item.startDate),
                endDate: dayjs(item.endDate),
              })),
            },
          },
          include: {
            CampaignTimeline: true,
          },
        });

        campaign?.CampaignTimeline.forEach(async (item: any, index: any) => {
          if (index !== 0) {
            await prisma.campaignTimelineDependency.create({
              data: {
                campaignTimelineId: campaign.CampaignTimeline[index - 1]?.id,
                dependsOnCampaignTimelineId: item?.id,
              },
            });
          }
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
        campaign?.CampaignTimeline.filter((elem: any) => elem.for === 'admin').forEach(
          async (item: any, index: any) => {
            await assignTask(admin?.id, campaign?.id, item.id);
          },
        );
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
        CampaignAdmin: {
          some: {
            adminId: admin?.id,
          },
        },
      },
      include: {
        brand: true,
        company: true,
        CampaignTimeline: {
          include: {
            campaignTimelineDependency: true,
          },
        },
        campaignBrief: true,
        campaignRequirement: true,
        Pitch: {
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
        ShortListedCreator: {
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
        FinalDraft: true,
        FirstDraft: true,
        brand: true,
        company: true,
        CampaignTimeline: {
          include: {
            dependsOnCampaignTimeline: {
              include: {
                campaignTimeline: true,
              },
            },
          },
        },

        campaignBrief: true,
        campaignRequirement: true,
        Pitch: {
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
        CampaignAdmin: {
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
        ShortListedCreator: {
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

        CampaignTimeline: true,
        brand: true,
        company: true,
        Pitch: true,
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
        Pitch: true,
        CampaignAdmin: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'No campaign found.' });
    }

    if (campaign.Pitch.some((item) => item.userId.includes(id as any))) {
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

    const admins = campaign.CampaignAdmin;

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

export const approvePitch = async (req: Request, res: Response) => {
  const { creatorId, campaignId, pitchId } = req.body;
  try {
    const creator = await prisma.user.findUnique({
      where: {
        id: creatorId,
      },
    });

    const pitch = await prisma.shortListedCreator.findFirst({
      where: {
        AND: {
          campaignId: campaignId,
          creatorId: creator?.id,
        },
      },
    });

    if (pitch) {
      return res.status(404).json({ message: 'Creator has been shortlisted' });
    }

    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        status: 'approved',
      },
    });

    await prisma.shortListedCreator.create({
      data: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    });

    // const timelines = await prisma.campaign.findUnique({
    //   where: {
    //     id: campaignId,
    //   },
    //   include: {
    //     campaignTimeline: true,
    //   },
    // });

    // for (const item of timelines as any) {
    // }

    return res.status(200).json({ message: 'Successfully shortlisted' });
  } catch (error) {
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
            CampaignTimeline: {
              include: {
                dependsOnCampaignTimeline: {
                  include: {
                    campaignTimeline: true,
                  },
                },
              },
            },
            CampaignAdmin: true,
          },
        });

        const tasks = await prisma.campaignTimelineTask.findMany({
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

export const filterPitch = async (req: Request, res: Response) => {
  const { pitchId } = req.body;

  try {
    await prisma.pitch.update({
      where: {
        id: pitchId,
      },
      data: {
        status: 'filtered',
      },
    });

    return res.status(200).json({ message: 'Successfully filtered.' });
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
        CampaignAdmin: true,
      },
    });

    if (campaign?.status === 'ACTIVE') {
      campaign.CampaignAdmin.forEach(async (admin) => {
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
        CampaignAdmin: true,
      },
    });
    campaign.CampaignAdmin.forEach(async (item) => {
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
    logChange(message, id, getAdminId(req));
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
    logChange(message, updatedCampaign.id, getAdminId(req));
    return res.status(200).json({ message: message, ...updatedCampaign });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignDosAndDonts = async (req: Request, res: Response) => {
  const {
    id,
    campaignDo,
    campaignDont,
  } = req.body;

  try {
    const updatedCampaignBrief = await prisma.campaignBrief.update({
      where: {
        campaignId: id,
      },
      data: {
        campaigns_do: campaignDo,
        campaigns_dont: campaignDont,
      },
    });

    const message = "Updated dos and don'ts";
    logChange(message, id, getAdminId(req));
    return res.status(200).json({ message: message, ...updatedCampaignBrief });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignRequirements = async (req: Request, res: Response) => {
  const {
    // ID of campaign, not of campaign requirements
    id,
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
        campaignId: id,
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
    logChange(message, id, getAdminId(req));
    return res.status(200).json({ message: message, ...updatedCampaignRequirement });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const editCampaignTimeline = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { timeline, campaignStartDate, campaignEndDate } = req.body;
  const timelines: { id: any }[] = [];

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: id,
      },
      include: {
        CampaignTimeline: true,
        campaignBrief: true,
        CampaignAdmin: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    await prisma.campaignTimeline.deleteMany({
      where: {
        campaignId: campaign?.id,
      },
    });

    for (const item of timeline) {
      const a = await prisma.campaignTimeline.create({
        data: {
          name: item.timeline_type?.name,
          for: item?.for,
          duration: parseInt(item.duration),
          startDate: dayjs(item?.startDate) as any,
          endDate: dayjs(item?.endDate) as any,
          campaignId: campaign?.id,
        },
      });
      timelines.push(a);
    }

    timelines.forEach(async (item: any, index: any) => {
      if (index !== 0) {
        await prisma.campaignTimelineDependency.create({
          data: {
            campaignTimelineId: timelines[index - 1].id,
            dependsOnCampaignTimelineId: item?.id,
          },
        });
      }
    });

    await prisma.campaignBrief.update({
      where: {
        campaignId: campaign.id,
      },
      data: {
        startDate: dayjs(campaignStartDate).format(),
        endDate: dayjs(campaignEndDate).format(),
      },
    });

    campaign?.CampaignAdmin?.forEach((admin: any) => {
      timelines
        .filter((elem: any) => elem.for === 'admin')
        .forEach(async (item: any) => {
          console.log(item);
          await assignTask(admin?.adminId, campaign?.id, item?.id);
        });
    });

    const message = 'Updated timeline';
    logChange(message, id, getAdminId(req));
    return res.status(200).json({ message: message });
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
      console.log('SDSADSAD', socketId);

      if (socketId) {
        io.to(socketId).emit('notification', data);
      } else {
        console.log(`User with ID ${pitch.userId} is not connected.`);
      }

      const timelines = await prisma.campaignTimeline.findMany({
        where: {
          campaignId: pitch?.campaignId,
        },
        include: {
          dependsOnCampaignTimeline: {
            include: {
              campaignTimeline: true,
            },
          },
        },
      });

      timelines
        .filter((item: any) => item.for === 'creator' && item.name !== 'Open For Pitch')
        .forEach(async (item: any, index: number) => {
          await prisma.campaignTimelineTask.create({
            data: {
              userId: pitch?.userId,
              task: item?.name,
              campaignTimelineId: item?.id,
              campaignId: pitch?.campaignId,
              startDate: item?.startDate,
              endDate: item?.endDate,
              status: index === 0 ? ('IN_PROGRESS' as any) : 'NOT_STARTED',
            },
          });
        });
    } else {
      await prisma.shortListedCreator.delete({
        where: {
          creatorId_campaignId: {
            creatorId: pitch?.userId,
            campaignId: pitch?.campaignId,
          },
        },
      });
      await prisma.campaignTimelineTask.deleteMany({
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
        CampaignAdmin: {
          include: {
            admin: {
              include: {
                user: true,
              },
            },
          },
        },
        CampaignTimeline: {
          include: {
            dependsOnCampaignTimeline: {
              include: {
                campaignTimeline: true,
              },
            },
          },
        },
        campaignBrief: true,
        campaignRequirement: true,
        campaignTimelineTask: {
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
            CampaignAdmin: true,
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

export const editCampaign = async (req: Request, res: Response) => {
  const { id, name, desc, brief, admin } = req.body;
  try {
    const updatedCampaign = await prisma.campaign.update({
      where: { id: id },
      data: {
        name: name,
        description: desc,
        campaignBrief: brief,
        CampaignAdmin: admin,
      },
    });
    return res.status(200).json({ message: 'Succesfully updated', ...updatedCampaign });
  } catch (error) {
    return res.status(400).json(error);
  }
};
