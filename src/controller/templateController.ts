import { PrismaClient } from '@prisma/client';
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
