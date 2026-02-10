import { Queue } from 'bullmq';
import connection from '@configs/redis';

export const invoiceQueue = new Queue('invoice-queue', {
  connection,
});
