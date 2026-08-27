import { Queue } from 'bullmq';
import connection from '@configs/redis';

export const invoiceQueue = new Queue('invoice-queue', {
  connection,
});

export const bulkInvoiceQueue = new Queue('bulk-invoice-queue', {
  connection,
});

export const xeroWebhookQueue = new Queue('xero-webhook-queue', {
  connection,
});
