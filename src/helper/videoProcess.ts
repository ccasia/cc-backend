import rabbitMQ from 'amqplib';
import fs from 'fs-extra';
import { PrismaClient } from '@prisma/client';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { clients, io } from 'src/server';
import { uploadPitchVideo } from '@configs/cloudStorage.config';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

const processVideo = (inputPath: string, outputPath: string, userId: string, videoID: string) => {
  const writeStrem = fs.createWriteStream(outputPath);
  return new Promise<void | string>((resolve, reject) => {
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
      .on('progress', (data) => {
        const percentage = Math.round(data.percent as number);
        const socketId = clients.get(userId);
        io.to(socketId).emit('draft-processing', { progress: percentage, id: videoID, status: 'Processing' });
      })
      .on('end', () => {
        fs.unlinkSync(inputPath);
        resolve(outputPath);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

(async () => {
  try {
    const amqp = await rabbitMQ.connect(process.env.RABBIT_MQ as string);
    const channel = await amqp.createChannel();
    console.log('Listening to draft video...');

    await channel.assertQueue('testingDraft', { durable: true });
    await channel.purgeQueue('testingDraft');

    // await channel.prefetch(1);

    await channel.consume(
      'testingDraft',
      async (msg) => {
        if (msg !== null) {
          const data = JSON.parse(msg.content.toString());

          try {
            const path: string | any = await processVideo(
              data.video.tempFilePath,
              `/tmp/compress-${data.video.name}`,
              data.submission.userId,
              data.video.socketId,
            );

            const size = (await fs.stat(path)).size;

            const url = await uploadPitchVideo(
              path,
              `${data.submission.id}-${data.video.name}`,
              'drafts',
              (progress: number) => {
                io.to(clients.get(data.submission.userId)).emit('draft-processing', {
                  id: data.video.socketId,
                  progress: progress,
                  status: 'Uploading',
                });
              },
              size,
            );

            fs.unlinkSync(path);

            await prisma.video.update({
              where: {
                id: data.video.id,
              },
              data: {
                status: 'Uploaded',
                url: url,
              },
            });

            const submission = await prisma.submission.update({
              where: {
                id: data.submission.id,
              },
              data: {
                status: 'PENDING_REVIEW',
              },
              include: {
                video: true,
              },
            });

            io.to(clients.get(data.submission.userId)).emit('draft-processing', {
              id: data.video.socketId,
              status: 'Done',
            });

            if (submission.video.every((item) => item.status === 'Uploaded')) {
              io.to(clients.get(data.submission.userId)).emit('draft-uploaded', {
                status: 'uploaded',
              });
            }

            channel.ack(msg);
          } catch (error) {
            throw new Error(error);
          }
        }
      },
      {
        noAck: false,
      },
    );
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
})();
