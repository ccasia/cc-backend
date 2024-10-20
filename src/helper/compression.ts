import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import FfmpegProbe from '@ffprobe-installer/ffprobe';
import path from 'path';
import { clients, io } from 'src/server';

Ffmpeg.setFfmpegPath(FfmpegPath.path);
Ffmpeg.setFfmpegPath(FfmpegProbe.path);

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
      .outputOptions(['-c:v libx264', '-crf 26', '-pix_fmt yuv420p', '-map 0:v:0', '-map 0:a:0?'])
      .toFormat('mp4')
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
        resolve(outputPath);
        // resolve(path.resolve(__dirname, `../upload/${outputPath}`));
      })
      .on('error', (err) => {
        console.error('Error processing video:', err.message);
        reject(err);
      })
      .save(
        outputPath,
        // path.resolve(__dirname, `../upload/${outputPath}`)
      );

    // Handle abort signal
    abortSignal.addEventListener('abort', () => {
      //console.log('Aborting FFmpeg process');
      // FFmpeg does not directly expose a method to abort via Fluent-FFmpeg.
      // Here, we assume you handle it externally by stopping the process.
      ffmpegProcess.kill('SIGTERM'); // Or 'SIGKILL' if 'SIGTERM' doesn't work
    });
  });
};
