import { Worker } from 'bullmq';
import connection from '@configs/redis';

import { Invoice as XeroInvoice, TokenSet } from 'xero-node';
import dayjs from 'dayjs';

import { xero } from '@configs/xero';
import { logChange } from '@services/campaignServices';
import { prisma } from '../prisma/prisma';

interface XeroWebhookEvent {
  resourceId: string;
  tenantId: string;
  eventCategory: string;
  eventType: string;
}

// Xero allows filtering getInvoices by a list of IDs; keep chunks small to stay well within limits.
const CHUNK_SIZE = 50;

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Processes Xero invoice webhook events asynchronously so the HTTP handler can ack 200 immediately.
// Honors Xero's Retry-After on 429 via BullMQ's rate-limit signal instead of dropping the job.
export const xeroWebhookWorker = new Worker(
  'xero-webhook-queue',
  async (job) => {
    const events: XeroWebhookEvent[] = job.data?.events || [];

    // Only invoice events are actionable here
    const invoiceEvents = events.filter((e) => e.eventCategory === 'INVOICE' && e.resourceId && e.tenantId);
    if (!invoiceEvents.length) return;

    // Single connected Xero account (super user) – same source the old handler used
    const user = await prisma.user.findFirst({
      where: { email: 'super@cultcreativeasia.com' },
      include: { admin: { select: { xeroTokenSet: true } } },
    });
    if (!user) throw new Error('Xero webhook: super user not found');

    const tokenSet: TokenSet = user.admin?.xeroTokenSet as TokenSet;
    if (!tokenSet) throw new Error('Xero webhook: user not connected to Xero');

    await xero.initialize();
    xero.setTokenSet(tokenSet);

    if (dayjs.unix(tokenSet.expires_at!).isBefore(dayjs())) {
      const validTokenSet = await xero.refreshToken();
      await prisma.admin.update({
        where: { userId: user.id },
        data: { xeroTokenSet: validTokenSet as any },
      });
    }

    // The backlog batch is heavily duplicated (same invoice CREATE + many UPDATEs). Dedupe per tenant.
    const idsByTenant = new Map<string, Set<string>>();
    for (const e of invoiceEvents) {
      if (!idsByTenant.has(e.tenantId)) idsByTenant.set(e.tenantId, new Set());
      idsByTenant.get(e.tenantId)!.add(e.resourceId);
    }

    for (const [tenantId, idSet] of idsByTenant) {
      const resourceIds = [...idSet];

      // DB-filter first (zero Xero calls): only invoices we track that aren't already paid.
      const candidates = await prisma.invoice.findMany({
        where: { xeroInvoiceId: { in: resourceIds }, status: { not: 'paid' } },
        select: {
          xeroInvoiceId: true,
          invoiceNumber: true,
          campaignId: true,
          user: { select: { name: true } },
        },
      });
      if (!candidates.length) continue;

      const candidateIds = candidates.map((c) => c.xeroInvoiceId).filter((id): id is string => Boolean(id));

      // Confirm PAID in Xero, batched by id list (a handful of calls instead of one-per-event).
      const paidIds = new Set<string>();
      for (const ids of chunk(candidateIds, CHUNK_SIZE)) {
        try {
          const resp = await xero.accountingApi.getInvoices(tenantId, undefined, undefined, undefined, ids);
          for (const inv of resp.body.invoices || []) {
            if (inv.status === XeroInvoice.StatusEnum.PAID && inv.invoiceID) paidIds.add(inv.invoiceID);
          }
        } catch (err: any) {
          if (err?.response?.statusCode === 429) {
            const retryAfter = parseInt(err.response.headers?.['retry-after'] ?? '60', 10);
            console.warn(
              `⏳ Xero webhook rate-limited (${err.response.headers?.['x-rate-limit-problem']}); backing off ${retryAfter}s`,
            );
            await xeroWebhookWorker.rateLimit(retryAfter * 1000);
            // Re-queues the job after the delay without consuming an attempt.
            throw Worker.RateLimitError();
          }
          throw err;
        }
      }

      if (!paidIds.size) continue;

      const updated = await prisma.invoice.updateMany({
        where: { xeroInvoiceId: { in: [...paidIds] } },
        data: { status: 'paid' },
      });
      console.log(`✅ Xero webhook: marked ${updated.count} invoice(s) paid for tenant ${tenantId}`);

      // Log only invoices that actually transitioned to paid (same message as the old handler).
      for (const inv of candidates) {
        if (inv.xeroInvoiceId && paidIds.has(inv.xeroInvoiceId)) {
          logChange(
            `Invoice ${inv.invoiceNumber} for ${inv.user?.name || 'Unknown Creator'} was marked as paid`,
            inv.campaignId,
            undefined,
            undefined,
            { systemLabel: 'Xero' },
          );
        }
      }
    }
  },
  {
    connection,
    concurrency: 1, // Keep at 1 to avoid Xero rate limiting
  },
);

xeroWebhookWorker.on('completed', (job) => {
  console.log(`✅ Xero webhook job ${job.id} done`);
});

xeroWebhookWorker.on('failed', (job, err) => {
  console.error(`❌ Xero webhook job ${job?.id} failed:`, err);
});
