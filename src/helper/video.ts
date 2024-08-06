/* eslint-disable promise/always-return */
import { ChildProcess } from 'child_process';
import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import path from 'path';
import { uploadPitchVideo } from 'src/config/cloudStorage.config';
Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

process.on('message', (payload: { tempFilePath: string; name: string }) => {
  const { tempFilePath, name } = payload;

  const endProcess = (endPayload: { statusCode: number; text: string; publicUrl?: string }) => {
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

  (async () => {
    try {
      const duration: any = await getVideoDuration(tempFilePath);

      // Create the output file path
      const outputFilePath = path.resolve(`src/upload/${name}`);

      // Create a promise that resolves when the ffmpeg processing is complete
      const processPromise = new Promise<void>((resolve, reject) => {
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
              (process as unknown as ChildProcess).send({ progress: percentComplete });
            }
          })
          .on('end', () => {
            console.log('Processing finished.');
            resolve();
            (process as unknown as ChildProcess).send({ progress: 100 });
          })
          .on('error', (err) => {
            console.error('Error processing video:', err.message);
            reject(err);
          })
          .save(outputFilePath);
      });

      // Wait for the ffmpeg processing to complete
      await processPromise;

      let publicURL: any = '';

      while (!publicURL) {
        (process as unknown as ChildProcess).send({ progress: 100 });
      }
      // Upload the processed video to Google Cloud Storage
      publicURL = await uploadPitchVideo(outputFilePath, name, 'pitchVideo', 123);

      // End process with success
      (process as unknown as ChildProcess).send({ statusCode: 200, text: 'Success', publicUrl: publicURL });
    } catch (error) {
      console.error('Error during video processing and upload:', error);
      (process as unknown as ChildProcess).send({ statusCode: 500, text: `Error: ${error.message}` });
    }
  })();

  // getVideoDuration(tempFilePath)
  //   .then((duration: any) => {
  //     Ffmpeg(tempFilePath)
  //       .fps(30)
  //       .outputOptions(['-c:v libx264', '-crf 26'])
  //       .on('start', () => {
  //         console.log('Starting...');
  //       })
  //       .on('progress', (progress) => {
  //         if (progress.timemark) {
  //           const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
  //           const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
  //           const percentComplete = (timemarkInSeconds / duration) * 100;

  //           // console.log(`Processing: ${percentComplete.toFixed(2)}% done`);
  //           (process as unknown as ChildProcess).send({ progress: percentComplete });
  //         }
  //       })
  //       .on('end', (data) => {
  //         endProcess({ statusCode: 200, text: 'Success' });
  //       })
  //       .on('error', (err) => {
  //         endProcess({ statusCode: 500, text: err.message });
  //       })
  //       .save(path.resolve(`src/upload/${name}`));
  //   })
  //   .catch((err) => console.log(err));
});
