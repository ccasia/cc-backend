import { Storage } from '@google-cloud/storage';

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const pathToJSONKey = `src/config/test-cs.json`;

export const storage = new Storage({
  keyFilename: pathToJSONKey,
});

const bucket = storage.bucket(process.env.BUCKET_NAME!);

export async function generateResumableSessionUrl(objectPath: string, contentType: string) {
  const file = bucket.file(objectPath);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'resumable',
    expires: Date.now() + 15 * 60 * 1000, // 15 min — just needs to cover the initiation handshake
    contentType,
  });

  return signedUrl;
}

export async function downloadFromGCS(objectPath: string): Promise<string> {
  const fileName = path.basename(objectPath);
  const localPath = path.join(os.tmpdir(), `raw-${Date.now()}-${fileName}`);

  await bucket.file(objectPath).download({ destination: localPath });

  return localPath;
}

export async function uploadToGCS(localPath: string, objectPath: string): Promise<void> {
  await bucket.upload(localPath, {
    destination: objectPath,
    metadata: {
      contentType: 'video/mp4', // compressed output is always mp4 from your ffmpeg step
    },
  });
}

export function buildPublicUrl(objectPath: string): string {
  // adjust based on how your bucket serves files — public bucket, CDN domain, or signed read URL
  return `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${objectPath}`;
}

export async function deleteFile(objectPath: string): Promise<void> {
  await bucket.file(objectPath).delete();
}
