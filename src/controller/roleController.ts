import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const getAllRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        permissions: true,
      },
    });
    return res.status(200).json(roles);
  } catch (error) {
    return res.status(400).json(error);
  }
};
