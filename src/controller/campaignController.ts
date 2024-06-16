import { Request, Response } from 'express';
import { PrismaClient, Stage } from '@prisma/client';

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

  console.log(req.body);

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

type image = {
  path: string;
  preview: string;
};
type timeline = {
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
};

type Campaign = {
  campaignInterests: string[];
  campaignIndustries: string[];
  campaignBrand: string;
  campaignStartDate: Date;
  campaignEndDate: Date;
  campaignTitle: string;
  campaginObjectives: string;
  campaignDo: any;
  campaignDont: any;
  audienceAge: string;
  audienceGender: string;
  audienceLocation: string;
  audienceLanguage: string;
  audienceCreatorPersona: string;
  audienceUserPersona: string;
  adminManager: string;
  campaignStage: string;
  campaignImages: image[];
  agreementFrom: image;
  defaultTimeline: timeline;
  status: string;
  adminId: string;
};

export const createCampaign = async (req: Request, res: Response) => {
  const {
    campaignInterests,
    campaignIndustries,
    campaignBrand,
    campaignStartDate,
    campaignEndDate,
    campaignTitle,
    campaginObjectives,
    campaignDo,
    campaignDont,
    audienceAge,
    audienceGender,
    audienceLocation,
    audienceLanguage,
    audienceCreatorPersona,
    audienceUserPersona,
    // adminManager,
    campaignStage,
    campaignImages,
    agreementFrom,
    // adminId,
  }: Campaign = req.body;

  try {
  
    const brand = await prisma.brand.findFirst({
      where: {
        name: campaignBrand,
      },
    });

    // const defaultTimelineCampaign = await prisma.defaultTimelineCampaign.findFirst({
    //   where:{
    //     id:defaultTimeline.id
    //   }
    // })

    const campign = await prisma.campaign.create({
      data: {
        stage: campaignStage as Stage,
        brandId: brand?.id as string,
        name: campaignTitle,
        status: 'active',

      },
    });

    const campaignRequirements = await prisma.campaignRequirement.create({
      data: {
        gender: audienceGender,
        age: audienceAge,
        geoLocation: audienceLocation,
        language: audienceLanguage,
        creator_persona: audienceCreatorPersona,
        user_persona: audienceUserPersona,
        campaignId: campign.id,
      },
    });

    const campaignBrief = await prisma.campaignBrief.create({
      data: {
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
        campaignId: campign.id,
      },
    });
    res.status(200).json({ campaignBrief, campaignRequirements, campign });
  } catch (error) {
    console.log(error);
  }
};
