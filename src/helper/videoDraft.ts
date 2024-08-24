/* eslint-disable promise/always-return */

import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import { uploadPitchVideo } from 'src/config/cloudStorage.config';
import amqplib from 'amqplib';
import { activeProcesses, clients, io } from 'src/server';
import { Entity, PrismaClient } from '@prisma/client';
import { saveNotification } from 'src/controller/notificationController';
import child from 'child_process';
import dayjs from 'dayjs';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

// process.on('message', (payload: { tempFilePath: string; name: string; outputPath: string }) => {
//   const { tempFilePath, name, outputPath } = payload;

//   const endProcess = (endPayload: { statusCode: number; text: string; publicUrl?: string }) => {
//     const { statusCode, text } = endPayload;
//     // Remove temp file
//     fs.unlink(tempFilePath, (err) => {
//       if (err) {
//         (process as unknown as ChildProcess).send({ statusCode: 500, text: err.message });
//       }
//     });

//     // Format response so it fits the api response
//     (process as unknown as ChildProcess).send({ statusCode, text });
//     // End process
//     process.exit();
//   };

//   const getVideoDuration = (inputPath: string) => {
//     return new Promise((resolve, reject) => {
//       Ffmpeg.ffprobe(inputPath, (err, metadata) => {
//         if (err) {
//           reject(err);
//         } else {
//           resolve(metadata.format.duration);
//         }
//       });
//     });
//   };

//   (async () => {
//     try {
//       const duration: any = await getVideoDuration(tempFilePath);

//       // Create the output file path
//       // const outputFilePath = path.resolve(`src/upload/${name}`);

//       // Create a promise that resolves when the ffmpeg processing is complete
//       const processPromise = new Promise<void>((resolve, reject) => {
//         Ffmpeg(tempFilePath)
//           .fps(30)
//           .outputOptions(['-c:v libx264', '-crf 26'])
//           .on('start', () => {
//             console.log('Starting...');
//           })
//           .on('progress', (progress) => {
//             if (progress.timemark) {
//               const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
//               const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
//               const percentComplete = (timemarkInSeconds / duration) * 100;
//               (process as unknown as ChildProcess).send({ progress: percentComplete });
//             }
//           })
//           .on('end', () => {
//             console.log('Processing finished.');
//             resolve();
//             (process as unknown as ChildProcess).send({ progress: 100 });
//           })
//           .on('error', (err) => {
//             console.error('Error processing video:', err.message);
//             reject(err);
//           })
//           .save(outputPath);
//       });

//       // Wait for the ffmpeg processing to complete
//       await processPromise;

//       const publicURL: any = '';

//       while (!publicURL) {
//         (process as unknown as ChildProcess).send({ progress: 100 });
//       }
//       // Upload the processed video to Google Cloud Storage
//       // publicURL = await uploadPitchVideo(outputFilePath, name, 'pitchVideo', 123);

//       // End process with success
//       // (process as unknown as ChildProcess).send({ statusCode: 200, text: 'Success', publicUrl: publicURL });
//     } catch (error) {
//       console.error('Error during video processing and upload:', error);
//       (process as unknown as ChildProcess).send({ statusCode: 500, text: `Error: ${error.message}` });
//     }
//   })();

//   // getVideoDuration(tempFilePath)
//   //   .then((duration: any) => {
//   //     Ffmpeg(tempFilePath)
//   //       .fps(30)
//   //       .outputOptions(['-c:v libx264', '-crf 26'])
//   //       .on('start', () => {
//   //         console.log('Starting...');
//   //       })
//   //       .on('progress', (progress) => {
//   //         if (progress.timemark) {
//   //           const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
//   //           const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
//   //           const percentComplete = (timemarkInSeconds / duration) * 100;

//   //           // console.log(`Processing: ${percentComplete.toFixed(2)}% done`);
//   //           (process as unknown as ChildProcess).send({ progress: percentComplete });
//   //         }
//   //       })
//   //       .on('end', (data) => {
//   //         endProcess({ statusCode: 200, text: 'Success' });
//   //       })
//   //       .on('error', (err) => {
//   //         endProcess({ statusCode: 500, text: err.message });
//   //       })
//   //       .save(path.resolve(`src/upload/${name}`));
//   //   })
//   //   .catch((err) => console.log(err));
// });

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
      .outputOptions(['-c:v libx264', '-crf 23'])
      .save(outputPath)
      .on('progress', (progress: any) => {
        activeProcesses.set(submissionId, command);
        const percentage = Math.round(progress.percent);
        if (socket) {
          socket.to(clients.get(userid)).emit('progress', { progress: percentage, submissionId: submissionId });
        }
      })
      .on('end', async () => {
        const publicURL = await uploadPitchVideo(outputPath, fileName, folder);
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
        await saveNotification(data.userId, `Successfully submitted ${data.submissionType.type}`, Entity.Draft);
        data.campaign.campaignAdmin.forEach(async (item) => {
          await saveNotification(
            item.adminId,
            `New draft from ${data.user.name} for campaign ${data.campaign.name}`,
            Entity.Draft,
          );
        });
        console.log('Video processing completed for:', videoData.fileName);
        activeProcesses.delete(submissionId);
        if (socket) {
          socket.to(clients.get(userid)).emit('progress', { submissionId, progress: 100 });
        }
        fs.unlinkSync(inputPath);
        resolve();
      })
      .on('error', (err) => {
        if (err.message.includes('ffmpeg was killed with signal SIGKILL')) {
          console.log(`Processing for video ${submissionId} was cancelled.`);
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
    // await channel.prefetch(2);

    console.log('Waiting for messages in queue:', 'draft');

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
    console.log('Error rabbitmq');
  }
})();
