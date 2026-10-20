import { InvoiceStatus, Prisma } from '@prisma/client';

/**
 * Statuses an admin can approve from. 'processing' stays in the list so an invoice whose
 * job died can be approved again; the workers skip anything that already has a Xero bill.
 */
export const APPROVABLE_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'pending', 'failed', 'processing'];

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
 * xero-node rejects with a JSON string, and our services wrap that in `new Error(string)`.
 * `err.message` alone logs `undefined` or a raw blob, so pull out status, rate limit and validation messages.
 */
export const describeXeroError = (error: unknown): string => {
  let value: any = error instanceof Error ? error.message : error;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }

  const response = value?.response;
  const body = response?.body ?? value?.body;
  const validation: string[] = (body?.Elements ?? [])
    .flatMap((element: any) => element?.ValidationErrors ?? [])
    .map((item: any) => item?.Message)
    .filter(Boolean);

  const parts = [
    response?.statusCode && `HTTP ${response.statusCode}`,
    response?.headers?.['x-rate-limit-problem'] && `rate limit: ${response.headers['x-rate-limit-problem']}`,
    ...validation,
    !validation.length && (body?.Message || body?.Detail || body?.error_description || body?.error),
  ].filter(Boolean);

  return parts.length ? parts.join(' | ') : String(JSON.stringify(value) ?? value).slice(0, 500);
};
