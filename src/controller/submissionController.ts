import e, { Request, Response } from 'express';

import { Entity, PrismaClient, SubmissionStatus } from '@prisma/client';
import { uploadAgreementForm, uploadPitchVideo } from '@configs/cloudStorage.config';
import { saveNotification } from './notificationController';
import { clients, io } from '../server';
import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import amqplib from 'amqplib';
import dayjs from 'dayjs';
import { MAP_TIMELINE } from '@constants/map-timeline';

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

      const submission = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'PENDING_REVIEW',
          content: url as string,
          submissionDate: dayjs().format(),
        },
        include: {
          user: true,
          campaign: {
            include: {
              campaignAdmin: true,
            },
          },
        },
      });

      submission.campaign.campaignAdmin.forEach(async (item) => {
        const notification = await saveNotification(
          item.adminId,
          `${submission.user.name} has submitted their agreement for campaign ${submission.campaign.name}. Please review it.`,
          Entity.Agreement,
        );

        io.to(clients.get(item.adminId)).emit('notification', notification);
      });
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

      const notification = await saveNotification(userId, `First Draft is open for submission`, Entity.Campaign);
      io.to(clients.get(userId)).emit('notification', notification);
    } else if (data.status === 'reject') {
      const { feedback, campaignTaskId, submissionId, userId } = data;

      await prisma.feedback.create({
        data: {
          content: feedback,
          submissionId: submissionId,
          adminId: req.session.userid as string,
        },
      });
      const notification = await saveNotification(
        userId,
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

export const getSubmissionByCampaignCreatorId = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.query;

  try {
    const data = await prisma.submission.findMany({
      where: {
        userId: creatorId as string,
        campaignId: campaignId as string,
      },
      include: {
        submissionType: {
          select: {
            id: true,
            type: true,
          },
        },
        feedback: true,
        dependentOn: true,
        dependencies: true,
      },
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const draftSubmission = async (req: Request, res: Response) => {
  const { submissionId, caption } = JSON.parse(req.body.data);
  const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
  const channel = await amqp.createChannel();
  await channel.assertQueue('draft');
  const userid = req.session.userid;

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

    channel.sendToQueue(
      'draft',
      Buffer.from(
        JSON.stringify({
          ...file,
          userid,
          inputPath: filePath,
          outputPath: compressedFilePath,
          submissionId: submission?.id,
          fileName: `${submission?.id}_draft.mp4`,
          folder: submission?.submissionType.type,
          caption,
        }),
      ),
      {
        persistent: true,
      },
    );
    console.log(`Sent video processing task to queue: draft`);

    await channel.close();
    await amqp.close();

    // const child = fork(path.resolve('./helper/videoDraft.ts'), { signal: controller.signal });

    // child.on('message', (data) => {
    //   console.log('MESSAGE', data);
    // });

    // child.send({ tempFilePath: filePath, name: file.name, outputPath: compressedFilePath });

    // await new Promise<void>((resolve, reject) => {
    //   Ffmpeg(filePath)
    //     .outputOptions(['-c:v libx264', '-crf 23'])
    //     .on('start', () => {
    //       console.log('Compression Starting...');
    //     })
    //     .on('error', () => {
    //       console.log('Error processing');
    //       fs.unlinkSync(filePath);
    //       reject();
    //     })
    //     .on('end', () => {
    //       fs.unlinkSync(filePath);
    //       resolve();
    //     })
    //     .save(compressedFilePath);
    // });

    // const size: any = await new Promise((resolve, reject) => {
    //   fs.stat(compressedFilePath, (err, data) => {
    //     if (err) {
    //       reject();
    //     }
    //     resolve(data.size);
    //   });
    // });

    // const publicUrl = await uploadPitchVideo(
    //   compressedFilePath,
    //   `${submissionId}.mp4`,
    //   `${submission?.submissionType.type}`,
    //   size,
    //   (data: any) => {
    //     console.log(data);
    //   },
    // );

    // fs.unlinkSync(compressedFilePath);

    // const a = await prisma.submission.update({
    //   where: {
    //     id: submissionId,
    //   },
    //   data: {
    //     content: publicUrl,
    //     caption: caption,
    //     status: 'PENDING_REVIEW',
    //   },
    //   include: {
    //     submissionType: true,
    //   },
    // });

    // await saveNotification(a.userId, `Successfully submitted ${a.submissionType.type}`, Entity.Draft);

    return res.status(200).json({ message: 'Video start processing' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManageDraft = async (req: Request, res: Response) => {
  const { submissionId, feedback, type, reasons } = req.body;

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        feedback: true,
      },
    });

    if (type === 'approve') {
      const sub = await prisma.submission.update({
        where: {
          id: submission?.id,
        },
        data: {
          status: 'APPROVED',
          isReview: true,
          feedback: feedback && {
            upsert: {
              where: {
                id: submission?.feedback?.id,
              },
              update: {
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
              create: {
                type: 'COMMENT',
                content: feedback,
                adminId: req.session.userid as string,
              },
            },
          },
        },
        include: {
          user: true,
          submissionType: true,
        },
      });

      const notification = await saveNotification(
        sub.userId,
        `Your ${MAP_TIMELINE[sub.submissionType.type]} has been approved.`,
        'Draft',
      );

      io.to(sub.userId).emit('notification', notification);

      return res.status(200).json({ message: 'Succesfully submitted.' });
    } else {
      const sub = await prisma.submission.update({
        where: {
          id: submissionId,
        },
        data: {
          status: 'CHANGES_REQUIRED',
          isReview: true,
          feedback: {
            upsert: {
              where: {
                id: submission?.feedback?.id,
              },
              update: {
                reasons: reasons,
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
              create: {
                type: 'REASON',
                reasons: reasons,
                content: feedback,
                admin: {
                  connect: { id: req.session.userid },
                },
              },
            },
          },
        },
        include: {
          user: true,
          submissionType: true,
        },
      });

      const notification = await saveNotification(
        sub.userId,
        `Your ${MAP_TIMELINE[sub.submissionType.type]} is required for changes.`,
        'Draft',
      );

      io.to(sub.userId).emit('notification', notification);

      return res.status(200).json({ message: 'Succesfully submitted.' });
    }
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const postingSubmission = async (req: Request, res: Response) => {
  const { submissionId, postingLink } = req.body;
  try {
    const submission = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        content: postingLink,
        status: 'PENDING_REVIEW',
        submissionDate: dayjs().format(),
      },
      include: {
        campaign: {
          include: {
            campaignAdmin: true,
          },
        },
        user: true,
      },
    });

    for (const admin of submission.campaign.campaignAdmin) {
      const notification = await saveNotification(
        admin.adminId,
        `${submission.user.name} submitted a new post link for campaign ${submission?.campaign?.name}`,
        Entity.Post,
      );

      io.to(clients.get(admin.adminId)).emit('notification', notification);
    }

    const notification = await saveNotification(
      submission.userId,
      `Successfully submitted post link for campaign ${submission.campaign.name}`,
      Entity.Post,
    );

    io.to(clients.get(submission.userId)).emit('notification', notification);

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const adminManagePosting = async (req: Request, res: Response) => {
  const { status, submissionId } = req.body;
  try {
    const data = await prisma.submission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: status as SubmissionStatus,
        isReview: true,
      },
      include: {
        user: true,
        campaign: true,
      },
    });

    const notification = await saveNotification(
      data.userId,
      `Your posting has been approved for campaign ${data.campaign.name}`,
      Entity.Post,
    );

    io.to(clients.get(data.userId)).emit('notification', notification);

    return res.status(200).json({ message: 'Successfully submitted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};
