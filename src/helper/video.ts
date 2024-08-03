/* eslint-disable promise/always-return */
import { ChildProcess } from 'child_process';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import path from 'path';
Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

process.on('message', (payload: { tempFilePath: string; name: string }) => {
  const { tempFilePath, name } = payload;

  const endProcess = (endPayload: { statusCode: number; text: string }) => {
    const { statusCode, text } = endPayload;
    // Remove temp file
    fs.unlink(tempFilePath, (err) => {
      if (err) {
        (process as unknown as ChildProcess).send({ statusCode: 500, text: err.message });
      }
    });

    // Format response so it fits the api response
    (process as unknown as ChildProcess).send({ statusCode, text });
    // End process
    process.exit();
  };

  const getVideoDuration = (inputPath: string) => {
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

  getVideoDuration(tempFilePath)
    .then((duration: any) => {
      Ffmpeg(tempFilePath)
        .fps(30)
        .outputOptions(['-c:v libx264', '-crf 26'])
        .on('start', () => {
          console.log('Starting...');
        })
        .on('progress', (progress) => {
          if (progress.timemark) {
            const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
            const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
            const percentComplete = (timemarkInSeconds / duration) * 100;

            // console.log(`Processing: ${percentComplete.toFixed(2)}% done`);
            (process as unknown as ChildProcess).send({ progress: percentComplete });
          }
        })
        .on('end', () => {
          endProcess({ statusCode: 200, text: 'Success' });
        })
        .on('error', (err) => {
          endProcess({ statusCode: 500, text: err.message });
        })
        .save(path.resolve(`src/upload/${name}`));
    })
    .catch((err) => console.log(err));
});
