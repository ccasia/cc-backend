import sharp from 'sharp';

import { TreasureHuntError } from './treasureHuntService';

const ALLOWED_CAPTURE_TYPES = new Set(['image/jpeg', 'image/png']);

export const createCaptureImageProcessor = ({ sharpFactory }: { sharpFactory: any }) => ({
  async process(input: { data: Buffer; contentType: string }) {
    if (!ALLOWED_CAPTURE_TYPES.has(input.contentType.toLowerCase())) {
      throw new TreasureHuntError(415, 'INVALID_CAPTURE_TYPE', 'Only JPEG and PNG captures are supported.');
    }

    const pipeline = sharpFactory(input.data)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      data,
      contentType: 'image/jpeg' as const,
      width: info.width,
      height: info.height,
    };
  },
});

export const captureImageProcessor = createCaptureImageProcessor({ sharpFactory: sharp });
