import { uploadAgreementTemplate, uploadDigitalSignature } from '@configs/cloudStorage.config';
import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const getAllTemplate = async (req: Request, res: Response) => {
  try {
    const templates = await prisma.agreementTemplate.findMany();

    return res.status(200).json(templates);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getTemplatebyId = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
      include: {
        agreementTemplate: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Admin Not Found.' });
    }

    if (!user.agreementTemplate) {
      return res.status(404).json({ message: "Template doesn't exist." });
    }

    return res.status(200).json({ template: user.agreementTemplate });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createNewTemplate = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { signedAgreement, signatureImage } = req.files as any;
  const { name, icNumber, campaignId } = JSON.parse(req.body.data);

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: id,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User Not Found.' });
    }

    if (!signedAgreement) {
      return res.status(404).json({ message: 'Agreement Template Not Found.' });
    }

    const url = await uploadAgreementTemplate({
      tempFilePath: signedAgreement.tempFilePath,
      folderName: 'agreementTemplate',
      fileName: `${user.name}-template.pdf`,
    });

    const signedUrl = await uploadDigitalSignature({
      tempFilePath: signatureImage.tempFilePath,
      folderName: 'digitalSignature',
      fileName: `${name}-template.png`,
    });

    await prisma.agreementTemplate.upsert({
      where: {
        userId: user.id,
      },
      update: {
        url: url,
        signURL: signedUrl,
        adminName: name,
        adminICNumber: icNumber,
      },
      create: {
        userId: user.id,
        url: url,
        signURL: signedUrl,
        adminName: name,
        adminICNumber: icNumber,
      },
    });

    if (campaignId) {
      await prisma.campaignBrief.update({
        where: {
          campaignId: campaignId,
        },
        data: {
          agreementFrom: url,
        },
      });
    }

    return res.status(200).json({ message: 'Successfully created.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};
