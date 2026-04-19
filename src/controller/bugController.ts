import { uploadImage } from '@configs/cloudStorage.config';
import { PrismaClient } from '@prisma/client';
import { createNewBugRowData } from '@services/google_sheets/sheets';
import dayjs from 'dayjs';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

export const createNewBug = async (req: Request, res: Response) => {
  const { stepsToReproduce, campaignName } = JSON.parse(req.body.data);
  const { userid } = req.session;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Normalize uploaded files to always be an array (express-fileupload returns single object or array)
    const rawFiles = (req.files as any)?.attachments;
    const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
    const cappedFiles = fileList.slice(0, 5);

    // Upload all files to GCS in parallel
    const uploadedUrls = await Promise.all(
      cappedFiles.map((f: any, i: number) => uploadImage(f.tempFilePath, `${Date.now()}-${i}-${f.name}`, 'bugs')),
    );

    const item = await prisma.bugs.create({
      data: {
        stepsToReproduce,
        attachments: uploadedUrls,
        campaignName: campaignName || undefined,
        userId: req.session.userid || undefined,
      },
    });

    await createNewBugRowData({
      spreadSheetId: '129mwFlatr5pMDTi3VxVzgx0hGhkOyUVvq4M_jAWieCc',
      sheetByTitle: user.role === 'creator' ? 'Platform Creator Bugs' : 'Platform Admin Bugs',
      data: {
        email: user?.email,
        name: user?.name || '',
        campaignName: campaignName || '',
        createdAt: dayjs(item.createdAt).format('LLL'),
        stepsToReproduce: item.stepsToReproduce,
        attachment: item.attachments.join('\n\n'),
      },
    });

    return res.status(200).json({ message: 'Bug is successfully reported.' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};
