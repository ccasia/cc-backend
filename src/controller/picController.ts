import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Create a new PIC for a company
 */
export const createPIC = async (req: Request, res: Response) => {
  try {
    const { name, email, designation, companyId } = req.body;

    if (!name || !designation || !companyId) {
      return res.status(400).json({ message: 'Name, designation, and company ID are required' });
    }

    // Check if company exists
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Create the PIC
    const newPIC = await prisma.pic.create({
      data: {
        name,
        email: email?.toLowerCase() || null,
        designation,
        companyId,
      },
    });

    return res.status(201).json({
      message: 'PIC created successfully',
      pic: newPIC,
    });
  } catch (error: any) {
    console.error('Error creating PIC:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while creating PIC',
    });
  }
};

/**
 * Get user by email
 * Used by frontend to fetch user status for PIC
 */
export const getUserByEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Normalize email to lowercase for case-insensitive matching
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error: any) {
    console.error('Error fetching user by email:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while fetching user',
    });
  }
};

/**
 * Update PIC information
 * Also updates the associated User record if the PIC has a user account
 */
export const updatePIC = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, designation, companyId } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'PIC ID is required' });
    }

    // Get the current PIC data
    const currentPIC = await prisma.pic.findUnique({
      where: { id },
    });

    if (!currentPIC) {
      return res.status(404).json({ message: 'PIC not found' });
    }

    // Normalize email to lowercase for consistent matching with User records
    const normalizedEmail = email?.toLowerCase();

    // Check if email is changing and if it's already in use by another PIC
    if (normalizedEmail && normalizedEmail !== currentPIC.email?.toLowerCase()) {
      const existingPIC = await prisma.pic.findFirst({
        where: {
          email: normalizedEmail,
          id: { not: id },
        },
      });

      if (existingPIC) {
        return res.status(400).json({ message: 'Email is already in use by another PIC' });
      }
    }

    // Update the PIC record
    const updatedPIC = await prisma.pic.update({
      where: { id },
      data: {
        name: name || currentPIC.name,
        email: normalizedEmail || currentPIC.email,
        designation: designation || currentPIC.designation,
      },
    });

    // If the PIC has an associated user (client), update the user record as well
    if (currentPIC.email) {
      // User emails are stored lowercase, so normalize for lookup
      const associatedUser = await prisma.user.findUnique({
        where: { email: currentPIC.email.toLowerCase() },
      });

      if (associatedUser) {
        await prisma.user.update({
          where: { id: associatedUser.id },
          data: {
            name: name || associatedUser.name,
            email: normalizedEmail || associatedUser.email,
          },
        });
      }
    }

    return res.status(200).json({
      message: 'PIC updated successfully',
      pic: updatedPIC,
    });
  } catch (error: any) {
    console.error('Error updating PIC:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while updating PIC',
    });
  }
};

/**
 * Get PIC by ID
 */
export const getPICById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: 'PIC ID is required' });
    }

    const pic = await prisma.pic.findUnique({
      where: { id },
      include: {
        company: true,
        brand: true,
      },
    });

    if (!pic) {
      return res.status(404).json({ message: 'PIC not found' });
    }

    return res.status(200).json(pic);
  } catch (error: any) {
    console.error('Error fetching PIC:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while fetching PIC',
    });
  }
};

/**
 * Get all PICs for a company
 */
export const getPICsByCompanyId = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID is required' });
    }

    const pics = await prisma.pic.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json(pics);
  } catch (error: any) {
    console.error('Error fetching PICs:', error);
    return res.status(500).json({
      message: error.message || 'Internal server error while fetching PICs',
    });
  }
};
