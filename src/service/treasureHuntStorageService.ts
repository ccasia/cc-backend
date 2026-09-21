import { createHash } from 'crypto';

import { storage } from '../config/cloudStorage.config';
import { captureImageProcessor } from './treasureHuntImageProcessor';
import { StoredTreasureHuntCapture } from './treasureHuntService';

export const TREASURE_HUNT_CAPTURE_BUCKET = 'app-test-cult-cretive';

interface CaptureImageProcessor {
  process(input: { data: Buffer; contentType: string }): Promise<{
    data: Buffer;
    contentType: 'image/jpeg';
    width: number;
    height: number;
  }>;
}

export const createTreasureHuntStorageService = ({
  bucket,
  imageProcessor,
  now = () => new Date(),
}: {
  bucket: any;
  imageProcessor: CaptureImageProcessor;
  now?: () => Date;
}) => ({
  async getCaptureUrl(objectPath: string): Promise<string> {
    const [url] = await bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: new Date(now().getTime() + 60_000),
      responseDisposition: 'inline',
    });
    return url;
  },
  async deleteCapture(objectPath: string): Promise<void> {
    await bucket.file(objectPath).delete({ ignoreNotFound: true });
  },

  async storeCapture(input: {
    claimId: string;
    userId: string;
    locationId: string;
    data: Buffer;
    contentType: string;
  }): Promise<StoredTreasureHuntCapture> {
    const processed = await imageProcessor.process({
      data: input.data,
      contentType: input.contentType,
    });
    const objectPath = `treasure-hunt-captures/${input.userId}/${input.locationId}/${input.claimId}.jpg`;

    await bucket.file(objectPath).save(processed.data, {
      resumable: false,
      metadata: {
        contentType: processed.contentType,
        cacheControl: 'private, max-age=0, no-store',
        metadata: { claimId: input.claimId, pending: 'true' },
      },
    });

    return {
      objectPath,
      contentType: processed.contentType,
      byteSize: processed.data.length,
      sha256: createHash('sha256').update(processed.data).digest('hex'),
      width: processed.width,
      height: processed.height,
    };
  },
});

export const getTreasureHuntCaptureBucket = () => storage.bucket(TREASURE_HUNT_CAPTURE_BUCKET);

export const treasureHuntStorageService = createTreasureHuntStorageService({
  bucket: getTreasureHuntCaptureBucket(),
  imageProcessor: captureImageProcessor,
});
