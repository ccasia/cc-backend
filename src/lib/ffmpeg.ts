// import ffmpeg from 'fluent-ffmpeg';
// import ffmpegPath from '@ffmpeg-installer/ffmpeg';
// import ffprobePath from '@ffprobe-installer/ffprobe';
// import * as os from 'os';
// import * as path from 'path';

// if (ffmpegPath) {
//   ffmpeg.setFfmpegPath(ffmpegPath.path);
// }
// ffmpeg.setFfprobePath(ffprobePath.path);

// export async function runFfmpegCompression(
//   inputPath: string,
//   onProgress?: (number: number | undefined) => void,
// ): Promise<string> {
//   const outputPath = path.join(os.tmpdir(), `compressed-${Date.now()}.mp4`);

//   return new Promise((resolve, reject) => {
//     ffmpeg(inputPath)
//       .videoCodec('libx264')
//       .audioCodec('aac')
//       .outputOptions([
//         '-c:v libx264',
//         '-crf 26',
//         '-pix_fmt yuv420p',
//         '-preset veryfast',
//         '-map 0:v:0',
//         '-map 0:v:0',
//         '-map 0:a:0?',
//         '-threads 4',
//       ])
//       .audioBitrate('128k')
//       .on('progress', (data) => {
//         onProgress?.(data.percent ?? 0);
//       })
//       .on('end', () => resolve(outputPath))
//       .on('error', (err) => reject(new Error(`ffmpeg compression failed: ${err.message}`)))
//       .save(outputPath);
//   });
// }

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';

export interface ProgressUpdate {
  percent: number;
  speed: string;
  etaSeconds: number | null;
}

function timemarkToSeconds(timemark: string): number {
  // "00:00:12.34" -> 12.34
  const [h, m, s] = timemark.split(':');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

function getDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 0);
    });
  });
}

export async function runFfmpegCompression(
  inputPath: string,
  onProgress?: (update: ProgressUpdate) => void,
): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `compressed-${Date.now()}.mp4`);
  const totalDuration = await getDuration(inputPath);
  const startTime = Date.now();

  const speedBuffer: number[] = [];
  const BUFFER_SIZE = 8;
  let lastProcessedSeconds = 0;
  let lastUpdateTime = startTime;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-c:v libx264',
        '-crf 26',
        '-pix_fmt yuv420p',
        '-preset veryfast',
        '-map 0:v:0',
        '-map 0:a:0?',
        '-threads 4',
      ])
      .audioBitrate('128k')
      .on('progress', (data) => {
        if (!data.timemark) return;

        const processedSeconds = timemarkToSeconds(data.timemark);
        const now = Date.now();

        // instantaneous speed = video-seconds processed / wall-clock-seconds elapsed, since the last update
        const wallElapsed = (now - lastUpdateTime) / 1000;
        const videoElapsed = processedSeconds - lastProcessedSeconds;
        const instantSpeed = wallElapsed > 0 ? videoElapsed / wallElapsed : 0;

        if (instantSpeed > 0) {
          speedBuffer.push(instantSpeed);
          if (speedBuffer.length > BUFFER_SIZE) speedBuffer.shift();
        }

        const avgSpeed = speedBuffer.length ? speedBuffer.reduce((a, b) => a + b, 0) / speedBuffer.length : 0;

        const percent = totalDuration > 0 ? Math.min(100, Math.round((processedSeconds / totalDuration) * 100)) : 0;

        const remainingVideoSeconds = Math.max(0, totalDuration - processedSeconds);
        const etaSeconds = avgSpeed > 0 ? Math.round(remainingVideoSeconds / avgSpeed) : null;

        onProgress?.({
          percent,
          speed: avgSpeed.toFixed(2) + 'x',
          etaSeconds,
        });

        lastProcessedSeconds = processedSeconds;
        lastUpdateTime = now;
      })
      .on('end', () => {
        onProgress?.({ percent: 100, speed: '–', etaSeconds: 0 });
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`ffmpeg compression failed: ${err.message}`)))
      .save(outputPath);
  });
}
