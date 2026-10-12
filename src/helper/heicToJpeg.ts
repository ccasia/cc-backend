import { promises as fs } from 'fs';
import convert from 'heic-convert';

export const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'];

const JPEG_QUALITY = 0.9;

let conversionQueue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
  const run = conversionQueue.then(task, task);
  conversionQueue = run.catch(() => undefined);
  return run;
};

export const isHeif = async (filePath: string): Promise<boolean> => {
  const handle = await fs.open(filePath, 'r');
  const head = Buffer.alloc(12);

  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  return head.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.includes(head.toString('latin1', 8, 12));
};

export const heicToJpegFile = (sourcePath: string, targetPath: string) =>
  oneAtATime(async () => {
    const jpeg = await convert({ buffer: await fs.readFile(sourcePath), format: 'JPEG', quality: JPEG_QUALITY });
    await fs.writeFile(targetPath, jpeg);
  });

export const convertHeicToJpeg = async (filePath: string, fileName: string) => {
  if (!(await isHeif(filePath))) return { filePath, fileName };

  try {
    const jpegPath = `${filePath}.jpg`;
    await heicToJpegFile(filePath, jpegPath);
    return { filePath: jpegPath, fileName: `${fileName.replace(/\.[^./]*$/, '')}.jpg` };
  } catch (error) {
    console.error('HEIC to JPEG conversion failed, uploading the original', { filePath, error });
    return { filePath, fileName };
  }
};
