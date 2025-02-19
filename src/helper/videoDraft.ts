/* eslint-disable promise/always-return */

import workerpool from 'workerpool';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import { uploadPitchVideo } from '@configs/cloudStorage.config';
import amqplib from 'amqplib';
import { activeProcesses, clients, io } from '../server';
import { Entity, PrismaClient } from '@prisma/client';
import { saveNotification } from '@controllers/notificationController';
import { spawn } from 'child_process';

import dayjs from 'dayjs';
import { notificationDraft } from './notification';
import { createNewTask, getTaskId, updateTask } from '@services/kanbanService';
import { createNewRowData } from '@services/google_sheets/sheets';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();
const pool = workerpool.pool();

const processVideo = async (
  videoData: any,
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
        '-preset ultrafast',
        '-map 0:v:0', // Select the first video stream
        '-map 0:a:0?',
        '-threads 4',
      ])
      .save(outputPath)
      .on('progress', (progress: any) => {
        activeProcesses.set(submissionId, command);
        const percentage = Math.round(progress.percent);
        if (io) {
          io.to(clients.get(userid)).emit('progress', {
            progress: percentage,
            submissionId: submissionId,
            name: 'Compression Start',
          });
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
            if (io) {
              io.to(clients.get(userid)).emit('progress', {
                progress: data,
                submissionId: submissionId,
                name: 'Uploading Start',
              });
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
                campaignAdmin: {
                  select: {
                    adminId: true,
                    admin: {
                      select: {
                        user: {
                          select: {
                            Board: {
                              include: {
                                columns: true,
                              },
                            },
                            id: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            user: {
              include: {
                creator: true,
              },
            },
          },
        });

        if (data.campaign.spreadSheetURL) {
          const spreadSheetId = data.campaign.spreadSheetURL.split('/d/')[1].split('/')[0];

          await createNewRowData({
            creatorInfo: {
              name: data.user.name,
              username: data.user.creator?.instagram,
              postingDate: dayjs().format('LL'),
              caption: caption,
              videoLink: `https://storage.googleapis.com/${process.env.BUCKET_NAME as string}/${data?.submissionType.type}/${`${data?.id}_draft.mp4`}?v=${dayjs().format()}`,
            } as any,
            spreadSheetId: spreadSheetId,
          });
        }

        const { title, message } = notificationDraft(data.campaign.name, 'Creator');

        const notification = await saveNotification({
          userId: data.userId,
          message: message,
          title: title,
          entity: 'Draft',
          entityId: data.campaign.id,
        });

        if (io) {
          io.to(clients.get(data.userId)).emit('notification', notification);
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

          if (item.admin.user.Board) {
            const actionNeededColumn = item.admin.user.Board.columns.find((item) => item.name === 'Actions Needed');

            const taskInDone = await getTaskId({
              boardId: item.admin.user.Board.id,
              submissionId: data.id,
              columnName: 'Done',
            });

            if (actionNeededColumn) {
              if (taskInDone) {
                await updateTask({
                  taskId: taskInDone.id,
                  toColumnId: actionNeededColumn.id,
                  userId: item.admin.user.id,
                });
              } else {
                await createNewTask({
                  submissionId: data.id,
                  name: 'Draft Submission',
                  userId: item.admin.user.id,
                  position: 1,
                  columnId: actionNeededColumn.id,
                });
              }
            }
          }

          if (io) {
            io.to(clients.get(item.adminId)).emit('notification', notification);
          }
        }

        activeProcesses.delete(submissionId);

        if (io) {
          io.to(clients.get(userid)).emit('progress', { submissionId, progress: 100 });
        }

        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        resolve();
      })
      .on('error', (err) => {
        console.log(err);
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

    // await channel.prefetch(1);
    console.log('Consumer 2 Starting...');

    const startUsage = process.cpuUsage();

    await channel.consume('draft', async (msg) => {
      if (msg !== null) {
        const content: any = JSON.parse(msg.content.toString());

        await processVideo(
          content,
          content.inputPath,
          content.outputPath,
          content.submissionId,
          content.fileName,
          content.folder,
          content.caption,
        );

        channel.ack(msg);

        const endUsage = process.cpuUsage(startUsage);

        console.log(`CPU Usage: ${endUsage.user} microseconds (user) / ${endUsage.system} microseconds (system)`);

        for (const item of content.admins) {
          io.to(clients.get(item.admin.user.id)).emit('newSubmission');
        }

        const allSuperadmins = await prisma.user.findMany({
          where: {
            role: 'superadmin',
          },
        });

        for (const admin of allSuperadmins) {
          io.to(clients.get(admin.id)).emit('newSubmission');
        }
      }
    });
  } catch (error) {
    throw new Error(error);
  }
})();
