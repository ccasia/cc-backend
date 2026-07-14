import ffmpeg from 'fluent-ffmpeg';
import * as os from 'os';
import * as path from 'path';

export async function runFfmpegCompression(
  inputPath: string,
  onProgress?: (number: number | undefined) => void,
): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `compressed-${Date.now()}.mp4`);

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
        '-map 0:v:0',
        '-map 0:a:0?',
        '-threads 4',
      ])
      .audioBitrate('128k')
      .on('progress', (data) => {
        onProgress?.(data.percent ?? 0);
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`ffmpeg compression failed: ${err.message}`)))
      .save(outputPath);
  });
}
