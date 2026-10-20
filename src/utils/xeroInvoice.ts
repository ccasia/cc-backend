import { createHash } from 'crypto';
import { InvoiceStatus, Prisma } from '@prisma/client';

/**
 * Statuses an admin can approve from. 'processing' is left out: a job or the reaper owns that invoice,
 * and a second approval could run two jobs and create two bills. The reaper fails or retries it.
 */
export const APPROVABLE_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'pending', 'failed'];

/** Statuses that already went through Xero. Approving them again must not create another bill. */
export const BILLED_INVOICE_STATUSES: InvoiceStatus[] = ['approved', 'paid'];

/** Some rows store an empty string instead of NULL for "no Xero bill". */
export const noXeroBillWhere: Prisma.InvoiceWhereInput = {
  OR: [{ xeroInvoiceId: null }, { xeroInvoiceId: '' }],
};

/** The InvoiceNumber sent to Xero. The "(INV-…)" suffix keeps it unique, so results can be matched by it. */
export const xeroBillNumber = (clientName: string | undefined | null, campaignName: string, invoiceNumber: string) =>
  `${[clientName, campaignName].filter(Boolean).join(' ')} (${invoiceNumber})`.replace(/\s+/g, ' ').trim();

export const isXeroBillFor = (xeroInvoiceNumber: string | undefined, invoiceNumber: string) =>
  Boolean(xeroInvoiceNumber?.trim().endsWith(`(${invoiceNumber})`));

/**
 * Xero replays the saved response for a repeated key within 6 minutes, and rejects the same key
 * with a different body. Hashing the body keeps the key stable for identical retries only.
 */
export const xeroIdempotencyKey = (prefix: string, body: unknown) =>
  `${prefix}-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}`.slice(0, 128);

interface XeroErrorDetails {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: any;
  message?: string;
}

/** xero-node rejects with a JSON string, and our services wrap that in `new Error(string)`. */
export const parseXeroError = (error: unknown): XeroErrorDetails => {
  const raw: any = error instanceof Error ? error.message : error;
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { message: raw };
    }
  }

  const response = value?.response;
  return {
    statusCode: response?.statusCode,
    headers: response?.headers,
    body: response?.body ?? value?.body,
    message: undefined,
  };
};

/** Status, rate limit and validation messages, instead of `undefined` or a raw blob. */
export const describeXeroError = (error: unknown): string => {
  const { statusCode, headers, body, message } = parseXeroError(error);
  if (message) return message;

  const validation: string[] = (body?.Elements ?? [])
    .flatMap((element: any) => element?.ValidationErrors ?? [])
    .map((item: any) => item?.Message)
    .filter(Boolean);

  const parts = [
    statusCode && `HTTP ${statusCode}`,
    headers?.['x-rate-limit-problem'] && `rate limit: ${headers['x-rate-limit-problem']}`,
    ...validation,
    !validation.length && (body?.Message || body?.Detail || body?.error_description || body?.error),
  ].filter(Boolean);

  return parts.length ? parts.join(' | ') : String(JSON.stringify(error) ?? error).slice(0, 500);
};
