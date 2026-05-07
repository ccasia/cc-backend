import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

import { ReportSection } from '../types/index';

const prisma = new PrismaClient();

interface AISettingsRequest extends Request {
  body: {
    apiKey: string;
    temperature: number;
    maxTokens: number;
    sectionPrompts: Record<ReportSection, string>;
  };
}

export const aiSettings = async (req: Request, res: Response) => {
  const userId = req.userId;
  try {
    const aiModel = await prisma.aiModel.findFirst({
      where: {
        userId: userId,
      },
    });

    return res.status(200).json(aiModel);
  } catch (error) {
    return res.status(500).json(error);
  }
};

export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: {
          in: ['ACTIVE', 'COMPLETED'],
        },
      },
      include: {
        company: true,
        brand: true,
      },
    });

    return res.status(200).json(campaigns);
  } catch (error) {
    return res.status(500).json(error);
  }
};

export const updateAiSettings = async (req: AISettingsRequest, res: Response) => {
  const { apiKey, temperature, maxTokens, sectionPrompts } = req.body;
  const userId = req.userId;

  try {
    const existingAiSetting = await prisma.aiModel.findFirst({
      where: {
        userId: userId,
      },
    });

    if (!existingAiSetting) {
      await prisma.aiModel.create({
        data: {
          apiKey,
          model: 'gemini-2.5-flash',
          temperature,
          maxOutputTokens: maxTokens,
          systemPrompt: sectionPrompts,
          userId: userId,
        },
      });
    } else {
      await prisma.aiModel.update({
        where: {
          id: existingAiSetting.id,
        },
        data: {
          apiKey,
          model: 'gemini-2.5-flash',
          temperature,
          maxOutputTokens: maxTokens,
          systemPrompt: sectionPrompts,
        },
      });
    }

    return res.status(200).json({ message: 'Successfully updated AI Configuration.' });
  } catch (error) {
    return res.status(500).json(error);
  }
};
