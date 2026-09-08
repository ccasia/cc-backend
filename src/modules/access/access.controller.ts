import { Request, Response } from 'express';
import { Entity, Invoice, PrismaClient, FeedbackType } from '@prisma/client';
import {
  generateCampaignAccessService,
  validateCampaignPasswordService,
  regenerateCampaignPasswordService,
} from '@services/publicService';

const prisma = new PrismaClient();

// Generate campaign access
export const generateCampaignAccess = async (req: Request, res: Response) => {
  const { campaignId, expiryInDays } = req.body;

  try {
    // Ensure expiryInDays is provided, default to 7 days if not
    const result = await generateCampaignAccessService(campaignId, expiryInDays || 7);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

// Validate campaign password
export const validateCampaignPassword = async (req: Request, res: Response) => {
  const { campaignId, inputPassword } = req.body;

  try {
    const isValid = await validateCampaignPasswordService(campaignId, inputPassword);
    return res.status(200).json({ success: isValid });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

// Regenerate campaign password
export const regenerateCampaignPassword = async (req: Request, res: Response) => {
  const { campaignId, expiryInMinutes } = req.body;

  try {
    const result = await regenerateCampaignPasswordService(campaignId, expiryInMinutes);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

export const publicSubmitFeedback = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons, userId } = req.body;

  try {
    console.log('Received feedback submission request:', { submissionId, feedback, type, reasons, userId });

    // Ensure submission exists
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        publicFeedback: true,
      },
    });

    if (!submission) {
      console.log(`Submission with ID ${submissionId} not found.`);
      return res.status(404).json({ message: 'Submission not found' });
    }

    console.log('Submission found:', submission);

    // Validate the feedback type
    // if (!Object.values(FeedbackType).includes(type)) {
    //   console.log(`Invalid feedback type received: ${type}`);
    //   return res.status(400).json({ message: 'Invalid feedback type' });
    // }

    // Prepare feedback data
    const feedbackData = {
      content: feedback,
      type: FeedbackType.REQUEST,
      reasons: reasons || [], // Default to empty array if no reasons provided
      submissionId: submissionId,
    };

    console.log('Feedback data prepared:', feedbackData);

    // Create the public feedback in the database
    const newPublicFeedback = await prisma.publicFeedback.create({
      data: feedbackData,
    });

    console.log('New public feedback created:', newPublicFeedback);

    return res.status(200).json({
      message: 'Feedback submitted successfully.',
      feedback: newPublicFeedback, // Optionally return the feedback object
    });
  } catch (error) {
    console.error('Error occurred while submitting feedback:', error);
    return res.status(400).json({ error: 'An error occurred while submitting feedback.' });
  }
};
