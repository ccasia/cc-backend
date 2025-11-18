import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const checkCampaignAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return res.status(400).json({ message: 'Campaign ID is required in the URL or request body.' });
    }

    const { userid } = req.session as any;

    const user = await prisma.user.findUnique({
      where: { id: userid },
      select: {
        id: true,
        role: true,
        client: {
          select: { companyId: true },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ message: 'Authentication error: User not found.' });
    }

    if (user.role === 'admin' || user.role === 'superadmin') {
      return next();
    }

    if (user.role === 'client') {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { companyId: true },
      });

      if (!campaign) {
        return res.status(404).json({ message: 'Campaign not found.' });
      }

      if (campaign.companyId === user.client?.companyId) {
        return next();
      }

      return res.status(403).json({ message: 'Forbidden: You do not have permission to access this campaign.' });
    }
  } catch (error) {
    console.error('Error in checkCampaignAccess middleware:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
