import { JobType, Worker } from 'bullmq';
import connection from '@configs/redis';

import axios from 'axios';
import { XeroClient } from 'xero-node';
import dayjs from 'dayjs';

import { notificationInvoiceUpdate } from './notification';
import { saveNotification } from '@controllers/notificationController';

import { logAdminChange, logChange } from '@services/campaignServices';

import { createXeroContact, createXeroInvoiceLocal, findXeroBill, sendToSpreadSheet } from '@services/invoiceService';
import { getXeroClientForAdmin } from '@services/xeroClientService';

import fs from 'fs-extra';

import {
  describeXeroError,
  isXeroBillFor,
  noXeroBillWhere,
  xeroBillNumber,
  xeroIdempotencyKey,
} from '@utils/xeroInvoice';
import { bulkInvoiceQueue, invoiceQueue } from '@utils/queue';
import { prisma } from '@/src/prisma/prisma';

// xero-node uses the default axios instance and sets no timeout, so a hung call would hold a job forever.
axios.defaults.timeout = 30_000;

const XERO_BATCH_SIZE = 50;
const REAPER_INTERVAL_MS = 10 * 60_000;
const STALE_AFTER_MINUTES = 30;
const MAX_XERO_ATTEMPTS = 3;
const LIVE_JOB_STATES: JobType[] = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'];

interface InvoiceForXero {
  invoiceType?: string | null;
  reimbursements?: unknown;
}

interface PreparedBill {
  invoiceId: string;
  invoiceNumber: string;
  billNumber: string;
  xeroInvoice: any;
}

/**
 * Xero line items for an invoice. The approve form only sends the fee line, so each billed
 * reimbursement receipt is added as its own line. A REIMBURSEMENT invoice has no fee line.
 */
const withReimbursementLines = (items: any[], invoice: InvoiceForXero) => {
  const lines = Array.isArray(invoice.reimbursements)
    ? (invoice.reimbursements as { description?: string; amount?: number }[])
    : [];

  const reimbursementItems = lines.map((line) => ({
    quantity: 1,
    total: Number(line.amount) || 0,
    xeroDescription: `Reimbursement – ${line.description ?? ''}`,
  }));

  return invoice.invoiceType === 'REIMBURSEMENT' ? reimbursementItems : [...(items ?? []), ...reimbursementItems];
};

const xeroCampaignName = (campaignName: string, invoice: InvoiceForXero) =>
  invoice.invoiceType === 'REIMBURSEMENT' ? `${campaignName} (Reimbursement)` : campaignName;

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * Every exit path must leave the invoice approved or failed. Only invoices still in
 * 'processing' with no Xero bill are touched, so a linked bill is never marked failed.
 */
const markInvoicesFailed = async (invoiceIds: string[], reason: string) => {
  if (!invoiceIds.length) return;

  try {
    const { count } = await prisma.invoice.updateMany({
      where: { id: { in: invoiceIds }, status: 'processing', ...noXeroBillWhere },
      data: { status: 'failed', xeroError: reason.slice(0, 1000) },
    });
    console.error(`❌ Marked ${count}/${invoiceIds.length} invoice(s) failed — ${reason}`, invoiceIds);
  } catch (error) {
    console.error(`🚨 Could not mark invoices failed — ${reason}`, invoiceIds, error);
  }
};

/** Marks the start of an attempt. The reaper uses these fields to find attempts that never finished. */
const startXeroAttempt = (invoiceIds: string[]) =>
  prisma.invoice.updateMany({
    where: { id: { in: invoiceIds }, status: 'processing' },
    data: { xeroAttemptedAt: new Date(), xeroAttempts: { increment: 1 }, xeroError: null },
  });

/**
 * The bill number is saved before the first create call. If it was already saved, an earlier attempt
 * may have created the bill without linking it, so Xero is searched first.
 */
const resolveBillNumber = async (
  invoice: { id: string; invoiceNumber: string; xeroBillNumber: string | null },
  build: () => string,
) => {
  if (invoice.xeroBillNumber) return { billNumber: invoice.xeroBillNumber, mayExist: true };

  const billNumber = build();
  await prisma.invoice.update({ where: { id: invoice.id }, data: { xeroBillNumber: billNumber } });
  return { billNumber, mayExist: false };
};

/** The commit point: once this runs, the invoice can never be billed again. */
const linkXeroBill = (invoiceId: string, xeroInvoiceId: string, tenantId: string) =>
  prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'approved', xeroInvoiceId, xeroTenantId: tenantId, xeroError: null },
    include: {
      campaign: { include: { campaignAdmin: { include: { admin: { include: { role: true } } } } } },
      creator: { include: { user: { include: { paymentForm: true } } } },
    },
  });

type LinkedInvoice = Awaited<ReturnType<typeof linkXeroBill>>;

/** Side effects run after the bill is linked. Their failure is logged and never changes the invoice. */
const runSafely = async (label: string, task: () => Promise<unknown>) => {
  try {
    await task();
  } catch (error) {
    console.error(`⚠️ ${label} failed: ${describeXeroError(error)}`);
  }
};

const worker = new Worker(
  'invoice-queue',
  async (job) => {
    const invoice = job.data.invoice;
    console.log('📨 Sending invoice to Xero', invoice.id);

    const current = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      select: { id: true, invoiceNumber: true, status: true, xeroInvoiceId: true, xeroBillNumber: true },
    });

    if (!current || current.status !== 'processing' || current.xeroInvoiceId) {
      console.log(
        `⏭️ Skipping invoice ${invoice.id}: status ${current?.status}, xeroInvoiceId ${current?.xeroInvoiceId || 'none'}`,
      );
      return;
    }

    await startXeroAttempt([invoice.id]);

    const creatorUser = invoice.creator.user;
    const creatorPaymentForm = creatorUser?.paymentForm;
    const campaign = invoice.campaign;
    const agreement = invoice.creator.user.creatorAgreement.find(
      (item: any) => item.campaignId === invoice.campaignId && item.round === 1,
    );
    const currency = (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR';
    const clientName = campaign.brand?.name || campaign.company?.name;
    const campaignName = xeroCampaignName(campaign.name, invoice);

    const xero = await getXeroClientForAdmin(job.data.adminId);

    const activeTenant = xero.tenants.find((item) => item?.orgData?.baseCurrency?.toUpperCase() === currency);

    if (!activeTenant) throw new Error(`Xero organisation for ${currency} is not connected for this admin`);

    const tenantId: string = activeTenant.tenantId;
    const { billNumber, mayExist } = await resolveBillNumber(current, () =>
      xeroBillNumber(clientName, campaignName, current.invoiceNumber),
    );

    let xeroInvoiceId = mayExist ? (await findXeroBill(xero, tenantId, current.invoiceNumber))?.invoiceID : undefined;

    if (xeroInvoiceId) {
      console.log(
        `🔗 Found existing Xero bill ${xeroInvoiceId} for invoice ${invoice.id}; linking instead of creating`,
      );
    } else {
      let contactID = invoice.creator.xeroContactId;

      const result = await xero.accountingApi.getContacts(
        tenantId,
        undefined, // IDs
        `Name=="${invoice.invoiceFrom.name?.trim()}"`,
      );

      if (result.body.contacts && result.body.contacts.length > 0) {
        contactID = result.body.contacts[0].contactID || null;
      } else {
        const result = await xero.accountingApi.getContacts(
          tenantId,
          undefined, // IDs
          `EmailAddress=="${creatorUser.email.trim()}"`,
        );
        if (result.body.contacts && result.body.contacts.length > 0) {
          contactID = result.body.contacts[0].contactID || null;
        } else {
          const [contact] = await createXeroContact(
            xero,
            tenantId,
            invoice.bankAcc,
            invoice.creator,
            invoice.invoiceFrom,
          );
          contactID = contact.contactID || null;
          await prisma.creator.update({
            where: { id: invoice.creator.id },
            data: { xeroContactId: contactID },
          });
        }
      }

      if (!contactID) throw new Error('No Xero contact was found or created');

      const createdInvoice = await createXeroInvoiceLocal(
        xero,
        tenantId,
        contactID,
        withReimbursementLines(job.data.items, invoice),
        job.data.dueDate,
        campaignName,
        billNumber,
        clientName,
        invoice.id,
      );

      xeroInvoiceId = createdInvoice.body.invoices[0].invoiceID;
    }

    try {
      await linkXeroBill(invoice.id, xeroInvoiceId!, tenantId);
    } catch (error) {
      console.error(`🚨 Xero bill ${xeroInvoiceId} was created but not linked to invoice ${invoice.id}`, error);
      throw error;
    }

    if (job.data.invoiceAttachment && xeroInvoiceId) {
      await runSafely(`Attachment for invoice ${invoice.id}`, async () => {
        const buffer = fs.readFileSync(job.data.invoiceAttachment.tempFilePath);
        await xero.accountingApi.createInvoiceAttachmentByFileName(
          tenantId,
          xeroInvoiceId!,
          job.data.invoiceAttachment.name,
          buffer,
          false,
          undefined,
          {
            headers: {
              'Content-Type': job.data.invoiceAttachment.mimetype,
            },
          },
        );
      });
    }

    const { title, message } = notificationInvoiceUpdate(campaign.name);

    // Notify CSM admins
    await runSafely(`CSM notifications for invoice ${invoice.id}`, () =>
      Promise.all(
        campaign.campaignAdmin
          .filter((admin: any) => admin.admin.role?.name === 'CSM')
          .map((admin: any) =>
            saveNotification({
              userId: admin.adminId,
              title,
              message,
              entity: 'Invoice',
              threadId: invoice.id,
              entityId: invoice.campaignId,
            }),
          ),
      ),
    );

    const adminId = job.data.adminId;

    if (adminId) {
      await runSafely('Admin log', () => logAdminChange(`Updated Invoice for - "${creatorUser?.name}"`, adminId));
    }
    // Log invoice approval in campaign logs for Invoice Actions tab
    if (adminId && invoice.campaignId) {
      const creatorName = creatorUser?.name || 'Unknown Creator';
      await runSafely('Campaign log', () =>
        logChange(
          `Approved invoice ${invoice.invoiceNumber} for ${creatorName}`,
          invoice.campaignId,
          undefined,
          adminId,
        ),
      );
    }

    await runSafely(`Invoices spreadsheet for invoice ${invoice.id}`, () =>
      sendToSpreadSheet(
        {
          createdAt: dayjs().format('YYYY-MM-DD'),
          name: creatorUser?.name || '',
          icNumber: creatorPaymentForm?.icNumber || '',
          bankName: creatorPaymentForm?.bankAccountName || '',
          bankAccountNumber: creatorPaymentForm?.bankAccountNumber || '',
          campaignName: campaign.name,
          amount: invoice.amount,
        },
        '1VClmvYJV9R4HqjADhGA6KYIR9KCFoXTag5SMVSL4rFc',
        'Invoices',
      ),
    );

    // Notify creator
    await runSafely(`Creator notification for invoice ${invoice.id}`, () =>
      saveNotification({
        userId: invoice.creatorId,
        title,
        message,
        entity: 'Invoice',
        threadId: invoice.id,
        entityId: invoice.campaignId,
      }),
    );
  },
  {
    connection,
    concurrency: 10,
  },
);

const runBulkSideEffects = async (
  xero: XeroClient,
  tenantId: string,
  updatedInvoice: LinkedInvoice,
  attachments: Record<string, { name: string; mimetype: string; tempFilePath: string }> | undefined,
  adminId: string,
) => {
  const attachment = attachments?.[updatedInvoice.id];

  if (attachment && updatedInvoice.xeroInvoiceId) {
    await runSafely(`Attachment ${attachment.name}`, async () => {
      const buffer = fs.readFileSync(attachment.tempFilePath);
      await xero.accountingApi.createInvoiceAttachmentByFileName(
        tenantId,
        updatedInvoice.xeroInvoiceId!,
        attachment.name,
        buffer,
        false,
        undefined,
        { headers: { 'Content-Type': attachment.mimetype } },
      );
      console.log(`📎 Successfully attached: ${attachment.name}`);
    });
  }

  await runSafely(`Campaign log for invoice ${updatedInvoice.id}`, () =>
    logChange(
      `Bulk approved invoice ${updatedInvoice.invoiceNumber} for ${updatedInvoice.creator.user?.name || 'Unknown Creator'}`,
      updatedInvoice.campaignId,
      undefined,
      adminId,
    ),
  );

  await runSafely(`Invoices spreadsheet for invoice ${updatedInvoice.id}`, () =>
    sendToSpreadSheet(
      {
        createdAt: dayjs().format('YYYY-MM-DD'),
        name: updatedInvoice.creator.user.paymentForm?.bankAccountName || updatedInvoice.creator.user.name || '',
        icNumber: updatedInvoice.creator.user.paymentForm?.icNumber || '',
        bankName: (updatedInvoice.bankAcc as any)?.bankName || '',
        bankAccountNumber: (updatedInvoice.bankAcc as any)?.accountNumber || '',
        campaignName: updatedInvoice.campaign.name,
        amount: updatedInvoice.amount,
      },
      '1VClmvYJV9R4HqjADhGA6KYIR9KCFoXTag5SMVSL4rFc',
      'Invoices',
    ),
  );

  const { title, message } = notificationInvoiceUpdate(updatedInvoice.campaign.name);

  await runSafely(`CSM notifications for invoice ${updatedInvoice.id}`, () =>
    Promise.all(
      updatedInvoice.campaign.campaignAdmin
        .filter((a) => a.admin?.role?.name === 'CSM')
        .map((admin) =>
          saveNotification({
            userId: admin.adminId,
            title,
            message,
            entity: 'Invoice',
            threadId: updatedInvoice.id,
            entityId: updatedInvoice.campaignId,
          }),
        ),
    ),
  );

  await runSafely(`Creator notification for invoice ${updatedInvoice.id}`, () =>
    saveNotification({
      userId: updatedInvoice.creatorId,
      title,
      message,
      entity: 'Invoice',
      entityId: updatedInvoice.campaignId,
    }),
  );
};

export const bulkInvoiceWorker = new Worker(
  'bulk-invoice-queue',
  async (job) => {
    const { invoiceIds, adminId, attachments } = job.data;
    console.log(`📦 Starting Bulk Approval for ${invoiceIds.length} invoices...`);

    try {
      const xero = await getXeroClientForAdmin(adminId);

      console.log(
        `🏢 Xero organisations for bulk job ${job.id}:`,
        xero.tenants.map((tenant) => `${tenant.tenantName} (${tenant.orgData?.baseCurrency})`),
      );

      const invoices = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        include: {
          creator: {
            include: {
              user: { select: { id: true, name: true, email: true, paymentForm: true, creatorAgreement: true } },
            },
          },
          user: true,
          campaign: {
            include: {
              campaignAdmin: { include: { admin: { include: { role: true } } } },
              brand: true,
              company: true,
            },
          },
        },
      });

      // The controller moved every invoice of this job to 'processing'. Anything else was handled elsewhere.
      const pending = invoices.filter((invoice) => invoice.status === 'processing' && !invoice.xeroInvoiceId);
      await startXeroAttempt(pending.map((invoice) => invoice.id));

      const batches: Record<string, { tenantId: string; bills: PreparedBill[] }> = {};

      for (const invoice of pending) {
        try {
          const agreement = invoice.creator.user.creatorAgreement.find(
            (a) => a.campaignId === invoice.campaignId && a.round === 1,
          );

          const currency = (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR';

          const activeTenant = xero.tenants.find((item) => item?.orgData?.baseCurrency?.toUpperCase() === currency);

          if (!activeTenant) {
            await markInvoicesFailed(
              [invoice.id],
              `Xero organisation for ${currency} is not connected for admin ${adminId}. Reconnect Xero and select it.`,
            );
            continue;
          }

          const tenantId: string = activeTenant.tenantId;
          const clientName = invoice.campaign.brand?.name || invoice.campaign.company?.name || '';
          const campaignName = xeroCampaignName(invoice.campaign.name, invoice);

          const { billNumber, mayExist } = await resolveBillNumber(invoice, () =>
            xeroBillNumber(clientName, campaignName, invoice.invoiceNumber),
          );

          const existingBill = mayExist ? await findXeroBill(xero, tenantId, invoice.invoiceNumber) : undefined;

          if (existingBill?.invoiceID) {
            console.log(`🔗 Found existing Xero bill ${existingBill.invoiceID} for invoice ${invoice.id}; linking`);
            const updatedInvoice = await linkXeroBill(invoice.id, existingBill.invoiceID, tenantId);
            await runBulkSideEffects(xero, tenantId, updatedInvoice, attachments, adminId);
            continue;
          }

          let contactID = invoice.creator.xeroContactId;

          const recipientName =
            (invoice.bankAcc as any)?.payTo ||
            invoice.creator.user.paymentForm?.bankAccountName ||
            invoice.creator.user.name;

          const result = await xero.accountingApi.getContacts(
            tenantId,
            undefined, // IDs
            `Name=="${recipientName.trim()}"`,
          );

          if (result.body.contacts && result.body.contacts.length > 0) {
            contactID = result.body.contacts[0].contactID || null;
          } else {
            const result = await xero.accountingApi.getContacts(
              tenantId,
              undefined, // IDs
              `EmailAddress=="${invoice.creator.user.email.trim()}"`,
            );
            if (result.body.contacts && result.body.contacts.length > 0) {
              contactID = result.body.contacts[0].contactID || null;
            } else {
              const [contact] = await createXeroContact(
                xero,
                tenantId,
                invoice.bankAcc,
                invoice.creator,
                invoice.invoiceFrom,
              );
              contactID = contact.contactID || null;
              await prisma.creator.update({
                where: { id: invoice.creator.id },
                data: { xeroContactId: contactID },
              });
            }
          }

          if (!contactID) throw new Error('No Xero contact was found or created');

          if (!batches[tenantId]) batches[tenantId] = { tenantId, bills: [] };

          batches[tenantId].bills.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            billNumber,
            xeroInvoice: {
              type: 'ACCPAY' as any,
              contact: { contactID: contactID as any },
              dueDate: invoice.dueDate,
              lineItems: [
                {
                  accountCode: '50930',
                  description: `${clientName} ${campaignName}`,
                  quantity: 1,
                  unitAmount: invoice.amount,
                  taxType: 'NONE',
                },
              ],
              status: 'AUTHORISED' as any,
              invoiceNumber: billNumber,
              reference: `${clientName} ${campaignName}`,
            },
          });
        } catch (err) {
          await markInvoicesFailed([invoice.id], `Could not prepare the Xero bill: ${describeXeroError(err)}`);
        }
      }

      for (const batch of Object.values(batches)) {
        for (const bills of chunk(batch.bills, XERO_BATCH_SIZE)) {
          let xeroResults: any[];
          const body = { invoices: bills.map((bill) => bill.xeroInvoice) };

          try {
            const response = await xero.accountingApi.createInvoices(
              batch.tenantId,
              body,
              false,
              undefined,
              xeroIdempotencyKey(`bills-${job.id}`, body),
            );
            xeroResults = response.body.invoices || [];
          } catch (batchError) {
            // The request may still have reached Xero. The saved bill numbers let the next attempt find those bills.
            await markInvoicesFailed(
              bills.map((bill) => bill.invoiceId),
              `Xero createInvoices failed for tenant ${batch.tenantId}: ${describeXeroError(batchError)}. Approve again to retry; existing bills are found and linked.`,
            );
            continue;
          }

          // Xero does not promise the response order, so match each result by its unique "(INV-…)" suffix.
          const linkedInvoices: LinkedInvoice[] = [];

          for (const bill of bills) {
            const xeroInv = xeroResults.find((result) => isXeroBillFor(result.invoiceNumber, bill.invoiceNumber));

            if (!xeroInv) {
              await markInvoicesFailed(
                [bill.invoiceId],
                `Xero returned no result for bill "${bill.billNumber}". Approve again to retry; an existing bill is found and linked.`,
              );
              continue;
            }

            if (xeroInv.hasErrors || !xeroInv.invoiceID) {
              const errors = (xeroInv.validationErrors || []).map((item: any) => item.message).join('; ');
              await markInvoicesFailed([bill.invoiceId], `Xero rejected bill "${bill.billNumber}": ${errors}`);
              continue;
            }

            try {
              linkedInvoices.push(await linkXeroBill(bill.invoiceId, xeroInv.invoiceID, batch.tenantId));
            } catch (error) {
              console.error(
                `🚨 Xero bill ${xeroInv.invoiceID} was created but not linked to invoice ${bill.invoiceId}`,
                error,
              );
            }
          }

          // Side effects run only after every bill in this request is linked, and never stop the loop.
          for (const updatedInvoice of linkedInvoices) {
            await runBulkSideEffects(xero, batch.tenantId, updatedInvoice, attachments, adminId);
          }
        }
      }

      if (adminId) {
        await runSafely('Admin log', () =>
          logAdminChange(`Completed bulk approval for ${invoiceIds.length} invoices`, adminId),
        );
      }

      console.log('✅ Bulk processing job finished');
    } finally {
      for (const attachment of Object.values(attachments || {}) as { tempFilePath: string }[]) {
        await runSafely(`Remove temp file ${attachment.tempFilePath}`, () => fs.remove(attachment.tempFilePath));
      }
    }
  },
  {
    connection,
    concurrency: 1, // Keep at 1 to avoid Xero rate limiting on bulk updates
  },
);

/**
 * Finds invoices left in 'processing' with no live job (a crash, a deploy, a lost job) and queues them
 * again under the admin who approved them. This is safe because a retry searches Xero for the saved
 * bill number before it creates anything. After MAX_XERO_ATTEMPTS, or with no known approver, the
 * invoice is marked failed so a person looks at it.
 */
export const reapStuckInvoices = async () => {
  const cutoff = dayjs().subtract(STALE_AFTER_MINUTES, 'minute').toDate();

  const stale = await prisma.invoice.findMany({
    where: {
      status: 'processing',
      AND: [
        noXeroBillWhere,
        { OR: [{ xeroAttemptedAt: { lt: cutoff } }, { xeroAttemptedAt: null, updatedAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true, xeroAttempts: true, xeroApprovedById: true },
  });

  if (!stale.length) return;

  const liveBulkJobs = await bulkInvoiceQueue.getJobs(LIVE_JOB_STATES);
  const inLiveBulkJob = new Set<string>(liveBulkJobs.flatMap((liveJob) => liveJob?.data?.invoiceIds ?? []));

  const requeueByAdmin = new Map<string, string[]>();
  const giveUp: string[] = [];

  for (const invoice of stale) {
    if (inLiveBulkJob.has(invoice.id)) continue;

    const singleJob = await invoiceQueue.getJob(`invoice-${invoice.id}`);
    if (singleJob && LIVE_JOB_STATES.includes((await singleJob.getState()) as JobType)) continue;

    if (!invoice.xeroApprovedById || invoice.xeroAttempts >= MAX_XERO_ATTEMPTS) {
      giveUp.push(invoice.id);
      continue;
    }

    requeueByAdmin.set(invoice.xeroApprovedById, [...(requeueByAdmin.get(invoice.xeroApprovedById) ?? []), invoice.id]);
  }

  await markInvoicesFailed(
    giveUp,
    'Approval stopped before it finished and was not retried. Check Xero for this bill, then approve again.',
  );

  for (const [adminId, ids] of requeueByAdmin) {
    await bulkInvoiceQueue.add(
      'bulk-approve',
      { invoiceIds: ids, adminId, attachments: {} },
      { jobId: `reaper-${adminId}-${Date.now()}`, removeOnComplete: true },
    );
  }

  const requeued = [...requeueByAdmin.values()].flat();
  if (requeued.length || giveUp.length) {
    console.warn(`🚨 Invoice reaper: re-queued ${requeued.length}, marked failed ${giveUp.length}`, {
      requeued,
      giveUp,
    });
  }
};

let reaperRunning = false;

const reaperTimer = setInterval(async () => {
  if (reaperRunning) return;
  reaperRunning = true;
  try {
    await reapStuckInvoices();
  } catch (error) {
    console.error('Invoice reaper failed:', error);
  } finally {
    reaperRunning = false;
  }
}, REAPER_INTERVAL_MS);

bulkInvoiceWorker.on('completed', (job) => {
  console.log(`✅Bulk Job ${job.id} done`);
});

bulkInvoiceWorker.on('failed', async (job, err) => {
  const reason = `Bulk job ${job?.id} failed: ${describeXeroError(err)}`;
  console.error(`❌ ${reason}`);
  await markInvoicesFailed(job?.data?.invoiceIds ?? [], reason);
});

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} done`);
});

worker.on('failed', async (job, err) => {
  const reason = `Job ${job?.id} failed: ${describeXeroError(err)}`;
  console.error(`❌ ${reason}`);
  if (job?.data?.invoice?.id) await markInvoicesFailed([job.data.invoice.id], reason);
});

// graceful shutdown
process.on('SIGTERM', async () => {
  clearInterval(reaperTimer);
  await worker.close();
  await bulkInvoiceWorker.close();
  process.exit(0);
});
