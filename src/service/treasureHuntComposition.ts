import axios from 'axios';
import dayjs from 'dayjs';

import { buildGcsPublicUrl, storage } from '../config/cloudStorage.config';
import { prisma } from '../prisma/prisma';
import { createBitlyClient, type BitlyQrImage } from './bitlyService';
import { createPrismaTreasureHuntRepository } from './treasureHuntRepository';
import { createTreasureHuntAdminService } from './treasureHuntAdminService';
import { createTreasureHuntService } from './treasureHuntService';
import { treasureHuntStorageService } from './treasureHuntStorageService';
import { createTokenCipher, generateHuntToken } from './treasureHuntToken';

// Canonical Cult HTTPS host that Bitly links redirect to and that Universal /
// App Links open. Kept in sync with TREASURE_HUNT_LINK_BASE_URL.
export const TREASURE_HUNT_LINK_BASE_URL =
  process.env.TREASURE_HUNT_LINK_BASE_URL ?? 'https://app.cultcreativeasia.com';

const canonicalHost = (() => {
  try {
    return new URL(TREASURE_HUNT_LINK_BASE_URL).hostname;
  } catch {
    return 'app.cultcreativeasia.com';
  }
})();

export const treasureHuntRepository = createPrismaTreasureHuntRepository({
  prisma,
  canonicalHost,
});

export const treasureHuntService = createTreasureHuntService({
  repository: treasureHuntRepository,
  captureStorage: treasureHuntStorageService,
});

// --- Admin side (superadmin only) ------------------------------------------

const bitlyClient = createBitlyClient({
  http: axios,
  config: {
    accessToken: process.env.BITLY_GENERIC_ACCESS_TOKEN ?? '',
    groupGuid: process.env.BITLY_GROUP_GUID ?? '',
  },
});

const tokenCipher = createTokenCipher({
  key: process.env.TREASURE_HUNT_TOKEN_ENCRYPTION_KEY ?? '',
});

const QR_EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// QR images are public print assets — store them in the public bucket. The
// extension and content type follow whatever Bitly actually returned (SVG
// today); hardcoding .png stored an SVG under a name no viewer would render.
const uploadQrImage = async (image: BitlyQrImage, locationId: string): Promise<string> => {
  const bucketName = process.env.BUCKET_NAME as string;
  const extension = QR_EXTENSIONS[image.contentType] ?? 'png';
  const objectPath = `treasure-hunt-qr/${locationId}.${extension}`;
  const file = storage.bucket(bucketName).file(objectPath);
  await file.save(image.data, {
    resumable: false,
    metadata: { contentType: image.contentType, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return buildGcsPublicUrl(bucketName, objectPath, dayjs().format());
};

export const treasureHuntAdminService = createTreasureHuntAdminService({
  prisma,
  bitly: bitlyClient,
  tokenCipher,
  uploadQrImage,
  linkBaseUrl: TREASURE_HUNT_LINK_BASE_URL,
  generateToken: generateHuntToken,
});
