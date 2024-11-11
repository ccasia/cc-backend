import amqplib from 'amqplib';
import { compress } from './compression';
import { clients, io } from '../server';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import Ffmpeg from 'fluent-ffmpeg';
import { uploadPitchVideo } from '@configs/cloudStorage.config';
import fs from 'fs';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const processVideo = async (
  inputPath: string,
  outputPath: string,
  progressCallback: (progress: number) => void,
  userId: string,
  campaignId: string,
  fileName: string,
) => {
  const getVideoDuration = (inputPath: string): Promise<number | undefined> => {
    return new Promise((resolve, reject) => {
      Ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  };

  return new Promise<void>((resolve, reject) => {
    const command = Ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-crf 26',
        '-pix_fmt yuv420p',
        '-map 0:v:0', // Select the first video stream
        '-map 0:a:0?',
      ])
      .save(outputPath)
      .on('progress', async (progress: any) => {
        if (progress.timemark) {
          const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
          const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
          const duration = await getVideoDuration(inputPath);
          if (duration) {
            const percentComplete = (timemarkInSeconds / duration) * 100;
            progressCallback(percentComplete);
          }
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

        const a = await uploadPitchVideo(
          outputPath,
          fileName,
          'pitchVideo',
          (data: number) => {
            io.to(clients.get(userId)).emit('video-upload', { campaignId: campaignId, progress: data });
          },
          size as number,
        );

        io.to(clients.get(userId)).emit('video-upload-done', { campaignId: campaignId, video: a, size });

        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};

(async () => {
  try {
    const conn = await amqplib.connect(process.env.RABBIT_MQ as string);
    const channel = await conn.createChannel();
    await channel.assertQueue('pitch', { durable: true });
    await channel.purgeQueue('pitch');

    console.log('Video Pitch Queue starting...');
    await channel.consume(
      'pitch',
      async (msg) => {
        if (msg !== null) {
          try {
            const secs = msg.content.toString().split('.').length - 1;
            const { outputPath, tempPath, userId, campaignId, fileName } = JSON.parse(msg.content.toString());

            await processVideo(
              tempPath,
              outputPath,
              (data: number) => {
                io.to(clients.get(userId)).emit('video-upload', { campaignId: campaignId, progress: data });
              },
              userId,
              campaignId,
              fileName,
            );

            channel.ack(msg);
          } catch (error) {
            console.log(error);
          }
        }
      },
      {
        noAck: false,
      },
    );
  } catch (error) {
    throw new Error(error);
  }
})();
