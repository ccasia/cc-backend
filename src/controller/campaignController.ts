import { Request, Response } from 'express';
import { PrismaClient, Stage } from '@prisma/client';
import { uploadImage } from 'src/config/cloudStorage.config';

const prisma = new PrismaClient();

export const updateDefaultTimeline = async (req: Request, res: Response) => {
  const {
    id,
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
        id: id || null,
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
    // campaignImages,
    adminManager,
    agreementFrom,
    campaignStage,
    timeline,
  }: Campaign = JSON.parse(req.body.data);

  const images = (req.files as any).campaignImages as [];

  const publicURL = [];
  let campaign: any;

  try {
    for (const item of images as any) {
      const url = await uploadImage(item.tempFilePath, item.name);
      publicURL.push(url);
    }

    const admins = await Promise.all(
      adminManager.map(async (admin) => {
        return await prisma.user.findUnique({
          where: {
            id: (admin as any).id as string,
          },
          include: {
            admin: true,
          },
        });
      }),
    );

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
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: publicURL.map((image) => image) || '',
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
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: publicURL.map((image) => image) || '',
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

            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: publicURL.map((image) => image) || '',
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
            campaignBrief: {
              create: {
                title: campaignTitle,
                objectives: campaginObjectives,
                images: publicURL.map((image) => image) || '',
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

    admins.map(async (admin: any) => {
      await prisma.campaignAdmin.create({
        data: {
          campaignId: (campaign as any).id as any,
          adminId: admin?.id,
        },
      });
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
        customCampaignTimeline: true,
        defaultCampaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        Pitch: {
          include: {
            user: {
              include: {
                creator: true,
              },
            },
          },
        },
        ShortListedCreator: {
          select: {
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
        brand: true,
        company: true,
        customCampaignTimeline: true,
        defaultCampaignTimeline: true,
        campaignBrief: true,
        campaignRequirement: true,
        Pitch: {
          include: {
            user: {
              include: {
                creator: true,
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
        AND: {
          stage: 'publish',
          status: 'active',
        },
      },
      include: {
        campaignBrief: true,
        campaignRequirement: true,
        defaultCampaignTimeline: true,
        customCampaignTimeline: true,
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

    await prisma.pitch.create({
      data: {
        type: 'text',
        campaignId: campaign?.id,
        userId: creator?.id,
        content: content,
      },
    });

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
        status: 'accept',
      },
    });

    await prisma.shortListedCreator.create({
      data: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    });
    return res.status(200).json({ message: 'Successfully shortlisted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
