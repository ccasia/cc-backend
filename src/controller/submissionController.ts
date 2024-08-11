import { Request, Response } from 'express';

import { Entity, PrismaClient } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from 'src/config/cloudStorage.config';
import { Title, saveNotification } from './notificationController';
import { clients, io } from 'src/server';
import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import FfmpegProbe from '@ffprobe-installer/ffprobe';
import fs from 'fs';

Ffmpeg.setFfmpegPath(FfmpegPath.path);
// Ffmpeg.setFfmpegPath(FfmpegProbe.path);

const prisma = new PrismaClient();

export const agreementSubmission = async (req: Request, res: Response) => {
  const { campaignId, submissionTypeId, submissionId } = JSON.parse(req.body.data);

  try {
    if (req.files && req.files.agreementForm) {
      const url = await uploadAgreementForm(
        (req.files as any).agreementForm.tempFilePath,
        (req.files as any).agreementForm.name,
        'agreement',
      );

      await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'PENDING_REVIEW',
          content: url as string,
        },
      });

      // await prisma.submission.create({
      //   data: {
      //     userId: req.session.userid as string,
      //     campaignId: campaignId as string,
      //     submissionTypeId: submissionTypeId as string,
      //     status: 'PENDING_REVIEW',
      //     content: url as string,
      //     submissionDate: dayjs().format(),
      //   },
      // });
    }
    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const adminManageAgreementSubmission = async (req: Request, res: Response) => {
  const data = req.body;

  const { campaignId, userId, status, submissionId } = data;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: {
        id: campaignId,
      },
    });

    if (status === 'approve') {
      await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
        },
      });

      const notification = await saveNotification(
        userId,
        Title.Create,
        `First Draft is open for submission`,
        Entity.Campaign,
      );
      io.to(clients.get(userId)).emit('notification', notification);
    } else if (data.status === 'reject') {
      const { feedback, campaignTaskId, submissionId, userId } = data;
      await prisma.campaignTask.update({
        where: {
          id: campaignTaskId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
        },
      });
      await prisma.feedback.create({
        data: {
          content: feedback,
          submissionId: submissionId,
          adminId: req.session.userid as string,
        },
      });
      const notification = await saveNotification(
        userId,
        Title.Create,
        `Please Resubmit Your Agreement Form for ${campaign?.name}`,
        Entity.Campaign,
      );
      io.to(clients.get(userId)).emit('notification', notification);
    }

    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  const { submissionId, caption } = JSON.parse(req.body.data);

  try {
    if (!(req.files as any).draftVideo) {
      return res.status(404).json({ message: 'Video not found.' });
    }

    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        submissionType: true,
      },
    });

    const file = (req.files as any).draftVideo;

    const filePath = `/tmp/${submissionId}`;
    const compressedFilePath = `/tmp/${submissionId}_compressed.mp4`;

    await file.mv(filePath);

    await new Promise<void>((resolve, reject) => {
      Ffmpeg(filePath)
        .outputOptions(['-c:v libx264', '-crf 23'])
        .on('start', () => {
          console.log('Compression Starting...');
        })
        .on('error', () => {
          console.log('Error processing');
          fs.unlinkSync(filePath);
          reject();
        })
        .on('end', () => {
          fs.unlinkSync(filePath);
          resolve();
        })
        .save(compressedFilePath);
    });

    const size: any = await new Promise((resolve, reject) => {
      fs.stat(compressedFilePath, (err, data) => {
        if (err) {
          reject();
        }
        resolve(data.size);
      });
    });

    const publicUrl = await uploadPitchVideo(
      compressedFilePath,
      `${submissionId}.mp4`,
      `${submission?.submissionType.type}`,
      size,
      (data: any) => {
        console.log(data);
      },
    );

    fs.unlinkSync(compressedFilePath);

    await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        content: publicUrl,
        caption: caption,
        status: 'PENDING_REVIEW',
      },
    });

    return res.status(200).json({ message: 'Successfully submitted' });
    // await prisma.
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type } = req.body;
  console.log(req.body);

  try {
    if (type === 'approve') {
      await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
          feedback: feedback && {
            create: {
              type: 'COMMENT',
              content: feedback,
              adminId: req.session.userid as string,
            },
          },
        },
      });
    } else {
      await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
          feedback: {
            create: {
              type: 'REASON',
              content: feedback,
              admin: {
                connect: { id: req.session.userid },
              },
            },
          },
        },
      });
    }

    return res.status(200).json({ message: 'Succesfully submitted.' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
