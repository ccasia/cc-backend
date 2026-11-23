import fs from 'fs/promises';
import { Request } from 'express';
import { UploadedFile } from 'express-fileupload';

export const MAX_SCREENSHOTS = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const getScreenshots = (req: Request): UploadedFile[] => {
  const uploaded = req.files?.screenshots;
  return (Array.isArray(uploaded) ? uploaded : uploaded ? [uploaded] : []) as UploadedFile[];
};

export const validateScreenshots = (files: UploadedFile[]): string | null => {
  if (!files.length) return 'Upload at least one screenshot.';
  if (files.length > MAX_SCREENSHOTS) return `Upload ${MAX_SCREENSHOTS} screenshots or fewer.`;
  const invalid = files.find((f) => !IMAGE_TYPES.includes(f.mimetype) || f.size > MAX_FILE_SIZE);
  return invalid ? `${invalid.name} must be a JPG, PNG, or WEBP under 10 MB.` : null;
};

export const removeTempFiles = (files: UploadedFile[]) =>
  Promise.allSettled(files.map((f) => f.tempFilePath && fs.unlink(f.tempFilePath)));
