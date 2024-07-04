import { Request, Response } from 'express';
import { PrismaClient, Stage } from '@prisma/client';
import { createNotification } from '../service/notificationService';
const prisma = new PrismaClient();



export const updateDefaultTimeline = async (req: Request, res: Response) => {
  const {
    id = '1',
    openForPitch,
    shortlistCreator,
    firstDraft,
    finalDraft,
    feedBackFirstDraft,
    feedBackFinalDraft,
    filterPitch,
    agreementSign,
    qc,
    posting,
  } = req.body;

  try {
    const newDefaultTimeline = await prisma.defaultTimelineCampaign.upsert({
      where: {
        id: id,
      },
      update: {
        openForPitch,
        shortlistCreator,
        firstDraft,
        finalDraft,
        feedBackFirstDraft,
        feedBackFinalDraft,
        filterPitch,
        agreementSign,
        qc,
        posting,
      },
      create: {
        openForPitch,
        shortlistCreator,
        firstDraft,
        finalDraft,
        feedBackFirstDraft,
        feedBackFinalDraft,
        filterPitch,
        agreementSign,
        qc,
        posting,
      },
    });

    return res.status(200).json({ message: 'Successfully updated default timeline', newDefaultTimeline });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

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
  campaginObjectives: string;
  campaignDo: any;
  campaignDont: any;
  campaignDescription: string;
  audienceAge: string;
  audienceGender: string;
  audienceLocation: string;
  audienceLanguage: string;
  audienceCreatorPersona: string;
  audienceUserPersona: string;
  adminManager: {
    id: string;
  };
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
    campaignIndustries,
    campaginObjectives,
    campaignDescription,
    audienceGender,
    audienceAge,
    audienceLocation,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    campaignDo,
    campaignDont,
    campaignImages,
    adminManager,
    agreementFrom,
    campaignStage,
    timeline,
    // adminTest,
  }: Campaign = req.body;

  try {
    let campaign;

    // const admins = adminTest.map(async (elem: any) => {
    //   await prisma.user.findFirst(elem.id);
    // });

    const admin = await prisma.user.findFirst({
      where: {
        id: adminManager.id as string,
      },
      include: {
        admin: true,
      },
    });

    let brand: any = await prisma.brand.findUnique({
      where: {
        id: campaignBrand.id,
      },
    });

    if (!brand) {
      brand = await prisma.company.findUnique({
        where: {
          id: campaignBrand.id,
        },
      });

      if (timeline?.id) {
        campaign = await prisma.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            status: 'active',
            stage: campaignStage as Stage,
            company: {
              connect: {
                id: brand?.id,
              },
            },
            admin: {
              connect: {
                id: admin?.admin?.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                // objectives: campaginObjectives,
                images: campaignImages.map((image) => image.path),
                agreementFrom: agreementFrom.path,
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
            defaultCampaignTimeline: {
              connect: {
                id: timeline?.id,
              },
            },
          },
        });
      } else {
        const customTimeline = await prisma.customTimelineCampaign.create({
          data: {
            openForPitch: timeline?.openForPitch,
            shortlistCreator: timeline?.shortlistCreator,
            firstDraft: timeline?.firstDraft,
            finalDraft: timeline?.finalDraft,
            feedBackFirstDraft: timeline?.feedBackFirstDraft,
            feedBackFinalDraft: timeline?.feedBackFinalDraft,
            filterPitch: timeline?.filterPitch,
            agreementSign: timeline?.agreementSign,
            qc: timeline?.qc,
            posting: timeline?.posting,
          },
        });

        campaign = await prisma.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            status: 'active',
            stage: campaignStage as Stage,
            company: {
              connect: {
                id: brand?.id,
              },
            },
            admin: {
              connect: {
                id: admin?.admin?.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                // objectives: campaginObjectives,
                images: campaignImages.map((image) => image.path),
                agreementFrom: agreementFrom.path,
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
            customCampaignTimeline: {
              connect: {
                id: customTimeline?.id,
              },
            },
          },
        });
      }
    } else {
      if (timeline?.id) {
        campaign = await prisma.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            status: 'active',
            stage: campaignStage as Stage,
            brand: {
              connect: {
                id: brand?.id,
              },
            },
            admin: {
              connect: {
                id: admin?.admin?.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: campaignImages.map((image) => image.path),
                agreementFrom: agreementFrom.path,
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
            defaultCampaignTimeline: {
              connect: {
                id: timeline?.id,
              },
            },
          },
        });
      } else {
        const customTimeline = await prisma.customTimelineCampaign.create({
          data: {
            openForPitch: timeline?.openForPitch,
            shortlistCreator: timeline?.shortlistCreator,
            firstDraft: timeline?.firstDraft,
            finalDraft: timeline?.finalDraft,
            feedBackFirstDraft: timeline?.feedBackFirstDraft,
            feedBackFinalDraft: timeline?.feedBackFinalDraft,
            filterPitch: timeline?.filterPitch,
            agreementSign: timeline?.agreementSign,
            qc: timeline?.qc,
            posting: timeline?.posting,
          },
        });

        campaign = await prisma.campaign.create({
          data: {
            name: campaignTitle,
            description: campaignDescription,
            status: 'active',
            stage: campaignStage as Stage,
            brand: {
              connect: {
                id: brand?.id,
              },
            },
            admin: {
              connect: {
                id: admin?.admin?.id,
              },
            },
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: campaignImages.map((image) => image.path),
                agreementFrom: agreementFrom.path,
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
            customCampaignTimeline: {
              connect: {
                id: customTimeline?.id,
              },
            },
          },
        });
      }
    }
    await createNotification({
      receiver_id: admin?.id as string,
      title: 'Your assigned to a new campaign',
      type: 'normal',
      category: 'campaign',
      created_at: new Date(),
    });
    return res.status(200).json({ campaign, message: 'Successfully created campaign' });
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
      select: {
        admin: {
          select: {
            id: true,
          },
        },
      },
    });

    const campaigns = await prisma.campaign.findMany({
      where: {
        adminId: admin?.admin?.id,
      },
      include: {
        brand: true,
        company: true,
        customCampaignTimeline: true,
        defaultCampaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
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
        customCampaignTimeline: true,
        defaultCampaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
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
    });
    return res.status(200).json(campaign);
  } catch (error) {
    return res.status(400).json(error);
  }
};
