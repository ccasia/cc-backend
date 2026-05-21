import { randomUUID } from 'crypto';
import path from 'path';

interface DraftVideoUploadPathInput {
  submissionId: string;
  originalFileName: string;
  timestamp?: number | string;
  nonce?: string;
  tmpDir?: string;
}

interface DraftVideoUploadPaths {
  inputPath: string;
  outputPath: string;
  fileName: string;
}

const sanitizePathPart = (value: string, fallback: string) => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || fallback;
};

const sanitizeExtension = (extension: string) => {
  const sanitized = extension.replace(/^\./, '').replace(/[^a-zA-Z0-9]+/g, '');

  return sanitized ? `.${sanitized.toLowerCase()}` : '';
};

const getOriginalFileParts = (originalFileName: string) => {
  const normalizedName = originalFileName.replace(/\\/g, '/');
  const parsedName = path.parse(path.basename(normalizedName));

  return {
    baseName: sanitizePathPart(parsedName.name, 'video'),
    extension: sanitizeExtension(parsedName.ext) || '.mp4',
  };
};

export const buildDraftVideoUploadPaths = ({
  submissionId,
  originalFileName,
  timestamp = Date.now(),
  nonce = randomUUID(),
  tmpDir = '/tmp',
}: DraftVideoUploadPathInput): DraftVideoUploadPaths => {
  const { baseName, extension } = getOriginalFileParts(originalFileName);
  const prefix = [
    sanitizePathPart(submissionId, 'submission'),
    sanitizePathPart(String(timestamp), 'upload'),
    sanitizePathPart(nonce, 'nonce'),
  ].join('_');
  const fileName = `${prefix}_${baseName}${extension}`;
  const outputFileName = `${prefix}_${baseName}_compressed.mp4`;

  return {
    inputPath: path.join(tmpDir, fileName),
    outputPath: path.join(tmpDir, outputFileName),
    fileName,
  };
};
