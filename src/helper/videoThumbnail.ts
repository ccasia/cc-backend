import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import Ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { uploadImage } from '@configs/cloudStorage.config';

// The bundled static ffmpeg can't resolve DNS on Alpine, so prefer the system binary.
// fluent-ffmpeg keeps one global path that other modules overwrite, so it's set per command below.
const systemFfmpegPath = '/usr/bin/ffmpeg';
const thumbnailFfmpegPath =
  process.env.FFMPEG_PATH || (fs.existsSync(systemFfmpegPath) ? systemFfmpegPath : ffmpegPath.path);

const THUMBNAIL_TIMEOUT_MS = 30_000;

interface ThumbnailOptions {
  name: string;
  folder: string;
  width: number;
  height: number;
}

export const createVideoThumbnail = async (
  videoUrl: string,
  { name, folder, width, height }: ThumbnailOptions,
): Promise<string> => {
  const outputPath = path.join(os.tmpdir(), `video-thumbnail-${randomUUID()}.jpg`);
  const encodedVideoUrl = new URL(videoUrl).toString();

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const command = Ffmpeg(encodedVideoUrl)
        .setFfmpegPath(thumbnailFfmpegPath)
        .seekInput(1)
        .outputOptions([
          '-frames:v 1',
          '-update 1',
          `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          '-q:v 3',
        ]);

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

    return await uploadImage(outputPath, `${name}.jpg`, folder);
  } finally {
    await fs.promises.unlink(outputPath).catch(() => undefined);
  }
};

export const createVideoOfTheMonthThumbnail = (videoUrl: string, featuredVideoId: string) =>
  createVideoThumbnail(videoUrl, {
    name: featuredVideoId,
    folder: 'videoOfTheMonthThumbnails',
    width: 466,
    height: 782,
  });
