import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const getAllRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: {
        permissions: true,
        admin: {
          include: {
            user: true,
          },
        },
      },
    });
    return res.status(200).json(roles);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const getSpecificRole = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const role = await prisma.role.findUnique({
      where: {
        id: id as string,
      },
      include: {
        admin: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!role) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    return res.status(200).json(role);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateRole = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role: roleName } = req.body;

  try {
    const role = await prisma.role.findUnique({
      where: {
        id: id,
      },
    });

    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    await prisma.role.update({
      where: {
        id: role.id,
      },
      data: {
        name: roleName,
      },
    });

    return res.status(200).json({ message: 'Role Update Success' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createRole = async (req: Request, res: Response) => {
  const { role } = req.body;
  try {
    const data = await prisma.role.create({
      data: {
        name: role,
      },
    });

    return res.status(200).json({ data, message: 'Successfully created' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
