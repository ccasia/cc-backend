import { Request, Response } from 'express';
import { generateCampaignAccessService, validateCampaignPasswordService, regenerateCampaignPasswordService } from '@services/publicService';

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
