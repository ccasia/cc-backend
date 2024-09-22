import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import FfmpegProbe from '@ffprobe-installer/ffprobe';
import path from 'path';
import { clients, io } from 'src/server';

Ffmpeg.setFfmpegPath(FfmpegPath.path);
Ffmpeg.setFfmpegPath(FfmpegProbe.path);

// export const compress = (tempFilePath: string, outputPath: string, progressCallback: any): Promise<string> => {
//   const getVideoDuration = (inputPath: string): Promise<number | undefined> => {
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

//   //   const outputFilePath = path.resolve(`./upload/test.mp4`);

//   return new Promise((resolve, reject) => {
//     Ffmpeg(tempFilePath)
//       .fps(30)
//       .outputOptions(['-c:v libx264', '-crf 26'])
//       .on('start', () => {
//         //console.log('Starting...');
//       })
//       .on('progress', async (progress) => {
//         if (progress.timemark) {
//           const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
//           const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
//           const duration: number | undefined = await getVideoDuration(tempFilePath);
//           if (duration) {
//             const percentComplete = (timemarkInSeconds / duration) * 100;
//             progressCallback(percentComplete);
//           }
//         }
//       })
//       .on('end', () => {
//         //console.log('Processing finished.');
//         resolve(path.resolve(`./upload/${outputPath}`));
//         //   (process as unknown as ChildProcess).send({ progress: 100 });
//       })
//       .on('error', (err) => {
//         console.error('Error processing video:', err.message);
//         fs.unlinkSync(`./upload/${outputPath}`);
//         reject(err);
//       })
//       .save(path.resolve(`./upload/${outputPath}`));
//   });
// };

export const compress = (
  tempFilePath: string,
  outputPath: string,
  progressCallback: (progress: number) => void,
  abortSignal: AbortSignal,
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

  return new Promise<string>((resolve, reject) => {
    const ffmpegProcess = Ffmpeg(tempFilePath)
      .fps(30)
      .outputOptions(['-c:v libx264', '-crf 26'])

      .on('progress', async (progress) => {
        if (progress.timemark) {
          const [hours, minutes, seconds] = progress.timemark.split(':').map(parseFloat);
          const timemarkInSeconds = hours * 3600 + minutes * 60 + seconds;
          const duration = await getVideoDuration(tempFilePath);
          if (duration) {
            const percentComplete = (timemarkInSeconds / duration) * 100;
            progressCallback(percentComplete);
          }
        }
      })
      .on('end', () => {
        //console.log('Processing finished.');
        resolve(path.resolve(__dirname, `../upload/${outputPath}`));
      })
      .on('error', (err) => {
        console.error('Error processing video:', err.message);

        reject(err);
      })
      .save(path.resolve(__dirname, `../upload/${outputPath}`));

    // Handle abort signal
    abortSignal.addEventListener('abort', () => {
      //console.log('Aborting FFmpeg process');
      // FFmpeg does not directly expose a method to abort via Fluent-FFmpeg.
      // Here, we assume you handle it externally by stopping the process.
      ffmpegProcess.kill('SIGTERM'); // Or 'SIGKILL' if 'SIGTERM' doesn't work
    });
  });
};
