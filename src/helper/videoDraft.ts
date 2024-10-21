/* eslint-disable promise/always-return */

import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import { uploadPitchVideo } from '@configs/cloudStorage.config';
import amqplib from 'amqplib';
import { activeProcesses, clients, io } from '../server';
import { Entity, PrismaClient } from '@prisma/client';
import { saveNotification } from '@controllers/notificationController';

import dayjs from 'dayjs';
import { notificationDraft } from './notification';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

const processVideo = async (
  videoData: any,
  socket: any,
  inputPath: string,
  outputPath: string,
  submissionId: string,
  fileName: string,
  folder: string,
  caption: string,
) => {
  return new Promise<void>((resolve, reject) => {
    const userid = videoData.userid;

    const command = Ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-crf 26',
        '-pix_fmt yuv420p',
        '-map 0:v:0', // Select the first video stream
        '-map 0:a:0?',
      ])
      .save(outputPath)
      .on('progress', (progress: any) => {
        activeProcesses.set(submissionId, command);
        const percentage = Math.round(progress.percent);
        if (socket) {
          socket
            .to(clients.get(userid))
            .emit('progress', { progress: percentage, submissionId: submissionId, name: 'Compression Start' });
        }
      })
      .on('end', async () => {
        const size = await new Promise((resolve, reject) => {
          fs.stat(outputPath, (err, data) => {
            if (err) {
              reject();
            }
            resolve(data.size);
          });
        });

        const publicURL = await uploadPitchVideo(
          outputPath,
          fileName,
          folder,
          (data: number) => {
            if (socket) {
              socket
                .to(clients.get(userid))
                .emit('progress', { progress: data, submissionId: submissionId, name: 'Uploading Start' });
            }
          },
          size as number,
        );

        const data = await prisma.submission.update({
          where: {
            id: submissionId,
          },
          data: {
            content: publicURL,
            caption: caption,
            status: 'PENDING_REVIEW',
            submissionDate: dayjs().format(),
          },
          include: {
            submissionType: true,
            campaign: {
              include: {
                campaignAdmin: true,
              },
            },
            user: true,
          },
        });

        const { title, message } = notificationDraft(data.campaign.name, 'Creator');

        const notification = await saveNotification({
          userId: data.userId,
          message: message,
          title: title,
          entity: 'Draft',
          entityId: data.campaign.id,
        });

        if (socket) {
          socket.to(clients.get(data.userId)).emit('notification', notification);
        }

        const { title: adminTitle, message: adminMessage } = notificationDraft(
          data.campaign.name,
          'Admin',
          data.user.name as string,
        );

        for (const item of data.campaign.campaignAdmin) {
          const notification = await saveNotification({
            userId: item.adminId,
            message: adminMessage,
            creatorId: userid,
            title: adminTitle,
            entity: 'Draft',
            entityId: data.campaignId,
          });

          if (socket) {
            socket.to(clients.get(item.adminId)).emit('notification', notification);
          }
        }

        activeProcesses.delete(submissionId);
        if (socket) {
          socket.to(clients.get(userid)).emit('progress', { submissionId, progress: 100 });
        }
        fs.unlinkSync(inputPath);
        resolve();
      })
      .on('error', (err) => {
        if (err.message.includes('ffmpeg was killed')) {
          // Handle known errors
          resolve();
        } else {
          console.error('Error processing video:', err);
          activeProcesses.delete(submissionId); // Clean up the map
          reject(err); // Reject for non-cancellation errors
        }

        fs.unlinkSync(inputPath);
      });
  });
};

(async () => {
  try {
    const conn = await amqplib.connect(process.env.RABBIT_MQ as string);
    const channel = await conn.createChannel();
    await channel.assertQueue('draft', { durable: true });
    await channel.purgeQueue('draft');
    console.log('Video Draft Queue starting...');
    await channel.consume('draft', async (msg) => {
      if (msg !== null) {
        const content = JSON.parse(msg.content.toString());
        await processVideo(
          content,
          io,
          content.inputPath,
          content.outputPath,
          content.submissionId,
          content.fileName,
          content.folder,
          content.caption,
        );

        channel.ack(msg);
      }
    });
  } catch (error) {
    throw new Error(error);
  }
})();
