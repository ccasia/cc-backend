import { uploadImage } from '@configs/cloudStorage.config';
import { Bugs, PrismaClient } from '@prisma/client';
import { createNewBugRowData } from '@services/google_sheets/sheets';
import dayjs from 'dayjs';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const createNewBug = async (req: Request, res: Response) => {
  const { stepsToReproduce } = JSON.parse(req.body.data);
  const { userid } = req.session;

  try {
    const data: {
      stepsToReproduce: string;
      attachment?: string;
      userId?: string;
    } = {
      stepsToReproduce,
    };

    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    if ((req.files as any)?.attachment) {
      const image = (req.files as any).attachment;
      const imageUrl = await uploadImage(image.tempFilePath, image.name, 'bugs');
      data.attachment = imageUrl;
    }

    if (req.session.userid) {
      data.userId = req.session.userid;
    }

    const item = await prisma.bugs.create({
      data: data as Bugs,
    });

    await createNewBugRowData({
      spreadSheetId: '129mwFlatr5pMDTi3VxVzgx0hGhkOyUVvq4M_jAWieCc',
      data: {
        email: user?.email,
        name: user?.name || '',
        createdAt: dayjs(item.createdAt).format('LLL'),
        stepsToReproduce: item.stepsToReproduce,
        attachment: item.attachment || '',
      },
    });

    return res.status(200).json({ message: 'Bug is successfully reported.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
