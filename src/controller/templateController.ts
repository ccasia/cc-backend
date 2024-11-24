import { uploadAgreementTemplate, uploadDigitalSignature } from '@configs/cloudStorage.config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const getAllTemplate = async (req: Request, res: Response) => {
  try {
    const templates = await prisma.agreementTemplate.findMany({
      include: {
        campaign: true,
        user: true,
      },
    });

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
  const uniqueId = randomUUID();

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
      fileName: `${uniqueId}-template.pdf`,
    });

    const signedUrl = await uploadDigitalSignature({
      tempFilePath: signatureImage.tempFilePath,
      folderName: 'digitalSignature',
      fileName: `${uniqueId}-template.png`,
    });

    const data = await prisma.agreementTemplate.create({
      data: {
        url: url,
        signURL: signedUrl,
        adminName: name,
        adminICNumber: icNumber,
        campaign: campaignId && { connect: { id: campaignId } },
        user: { connect: { id: user.id } },
      },
    });

    return res.status(200).json({ message: 'Successfully created.', templateURL: url, agreementTemplate: data });
  } catch (error) {
    return res.status(400).json(error);
  }
};
