import { Request, Response } from 'express';

import { PrismaClient } from '@prisma/client';
import { uploadAgreementForm } from 'src/config/cloudStorage.config';

const prisma = new PrismaClient();

export const agreementSubmission = async (req: Request, res: Response) => {
  const { campaignId, submissionTypeId } = JSON.parse(req.body.data);

  try {
    if (req.files && req.files.agreementForm) {
      const url = await uploadAgreementForm(
        (req.files as any).agreementForm.tempFilePath,
        (req.files as any).agreementForm.name,
        'agreement',
      );

      await prisma.submission.create({
        data: {
          userId: req.session.userid as string,
          campaignId: campaignId as string,
          submissionTypeId: submissionTypeId as string,
          status: 'PENDING_REVIEW',
          content: url as string,
        },
      });
    }
    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};
