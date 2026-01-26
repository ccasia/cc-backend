import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

// Get all credit tiers
export const getAllCreditTiers = async (req: Request, res: Response) => {
  try {
    const creditTiers = await prisma.creditTier.findMany({
      orderBy: { minFollowers: 'asc' },
      include: {
        _count: {
          select: {
            creators: true,
          },
        },
      },
    });

    const creditTiersWithCounts = creditTiers.map((tier) => ({
      ...tier,
      creatorsCount: tier._count?.creators ?? 0,
      _count: undefined,
    }));

    return res.status(200).json(creditTiersWithCounts);
  } catch (error) {
    console.error('Error fetching credit tiers:', error);
    return res.status(500).json({ message: 'Error fetching credit tiers' });
  }
};

// Create a new credit tier
export const createCreditTier = async (req: Request, res: Response) => {
  const { name, minFollowers, maxFollowers, creditsPerVideo } = req.body;

  // Validation
  if (!name || minFollowers === undefined || !creditsPerVideo) {
    return res.status(400).json({ message: 'Missing required fields: name, minFollowers, creditsPerVideo' });
  }

  // Validate minFollowers >= 0
  if (minFollowers < 0) {
    return res.status(400).json({ message: 'Minimum followers must be 0 or greater' });
  }

  // Validate maxFollowers > minFollowers (if provided)
  if (maxFollowers !== null && maxFollowers !== undefined && maxFollowers <= minFollowers) {
    return res.status(400).json({ message: 'Maximum followers must be greater than minimum followers' });
  }

  // Validate creditsPerVideo > 0
  if (creditsPerVideo <= 0) {
    return res.status(400).json({ message: 'Credits per video must be a positive number' });
  }

  try {
    // Check if name already exists
    const existingTier = await prisma.creditTier.findUnique({
      where: { name },
    });

    if (existingTier) {
      return res.status(400).json({ message: 'A credit tier with this name already exists' });
    }

    const creditTier = await prisma.creditTier.create({
      data: {
        name,
        minFollowers: Math.floor(minFollowers),
        maxFollowers: maxFollowers ? Math.floor(maxFollowers) : null,
        creditsPerVideo: Math.floor(creditsPerVideo),
        isActive: true,
      },
    });

    return res.status(201).json({ message: 'Credit tier successfully created', data: creditTier });
  } catch (error) {
    console.error('Error creating credit tier:', error);
    return res.status(500).json({ message: 'Error creating credit tier' });
  }
};

// Update a credit tier
export const updateCreditTier = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, minFollowers, maxFollowers, creditsPerVideo, isActive } = req.body;

  try {
    const existingTier = await prisma.creditTier.findUnique({
      where: { id },
    });

    if (!existingTier) {
      return res.status(404).json({ message: 'Credit tier not found' });
    }

    // Validate maxFollowers > minFollowers (if both provided)
    const newMinFollowers = minFollowers !== undefined ? minFollowers : existingTier.minFollowers;
    const newMaxFollowers = maxFollowers !== undefined ? maxFollowers : existingTier.maxFollowers;

    if (newMaxFollowers !== null && newMaxFollowers <= newMinFollowers) {
      return res.status(400).json({ message: 'Maximum followers must be greater than minimum followers' });
    }

    // Check if name already exists (excluding current tier)
    if (name && name !== existingTier.name) {
      const duplicateName = await prisma.creditTier.findUnique({
        where: { name },
      });

      if (duplicateName) {
        return res.status(400).json({ message: 'A credit tier with this name already exists' });
      }
    }

    const updatedTier = await prisma.creditTier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(minFollowers !== undefined && { minFollowers: Math.floor(minFollowers) }),
        ...(maxFollowers !== undefined && { maxFollowers: maxFollowers ? Math.floor(maxFollowers) : null }),
        ...(creditsPerVideo !== undefined && { creditsPerVideo: Math.floor(creditsPerVideo) }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return res.status(200).json({ message: 'Credit tier successfully updated', data: updatedTier });
  } catch (error) {
    console.error('Error updating credit tier:', error);
    return res.status(500).json({ message: 'Error updating credit tier' });
  }
};

// Delete a credit tier
export const deleteCreditTier = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const existingTier = await prisma.creditTier.findUnique({
      where: { id },
      include: {
        creators: { select: { id: true }, take: 1 },
        shortlistedCreators: { select: { id: true }, take: 1 },
      },
    });

    if (!existingTier) {
      return res.status(404).json({ message: 'Credit tier not found' });
    }

    // Check if tier is in use
    if (existingTier.creators.length > 0 || existingTier.shortlistedCreators.length > 0) {
      // Soft delete - just set isActive to false
      await prisma.creditTier.update({
        where: { id },
        data: { isActive: false },
      });
      return res.status(200).json({ message: 'Credit tier deactivated (in use by creators)' });
    }

    // Hard delete if not in use
    await prisma.creditTier.delete({
      where: { id },
    });

    return res.status(200).json({ message: 'Credit tier successfully deleted' });
  } catch (error) {
    console.error('Error deleting credit tier:', error);
    return res.status(500).json({ message: 'Error deleting credit tier' });
  }
};
