import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import Ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { uploadImage } from '@configs/cloudStorage.config';

const systemFfmpegPath = '/usr/bin/ffmpeg';
Ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH ?? (fs.existsSync(systemFfmpegPath) ? systemFfmpegPath : ffmpegPath.path));

const THUMBNAIL_TIMEOUT_MS = 30_000;

export const createVideoOfTheMonthThumbnail = async (videoUrl: string, featuredVideoId: string): Promise<string> => {
  const outputPath = path.join(os.tmpdir(), `featured-video-${randomUUID()}.jpg`);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const command = Ffmpeg(videoUrl)
        .seekInput(1)
        .outputOptions(['-frames:v 1', '-vf scale=466:782:force_original_aspect_ratio=decrease', '-q:v 3']);

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      const timeout = setTimeout(() => {
        command.kill('SIGKILL');
        finish(new Error('Video thumbnail generation timed out'));
      }, THUMBNAIL_TIMEOUT_MS);

      command
        .on('end', () => finish())
        .on('error', (error) => finish(error))
        .save(outputPath);
    });

    return await uploadImage(outputPath, `${featuredVideoId}.jpg`, 'videoOfTheMonthThumbnails');
  } finally {
    await fs.promises.unlink(outputPath).catch(() => undefined);
  }
};
