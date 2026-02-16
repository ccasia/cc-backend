import { Queue } from 'bullmq';
import connection from '@configs/redis';

export const invoiceQueue = new Queue('invoice-queue', {
  connection,
});

export const videoQueue = new Queue('video-queue', {
  connection,
});

export const compressQueue = new Queue('compress', {
  connection,
});

export const uploadQueue = new Queue('upload', {
  connection,
});
