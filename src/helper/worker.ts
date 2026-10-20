import { Worker } from 'bullmq';
import connection from '@configs/redis';

import axios from 'axios';
import { TokenSet } from 'xero-node';
import dayjs from 'dayjs';

import { notificationInvoiceUpdate } from './notification';
import { saveNotification } from '@controllers/notificationController';

import { logAdminChange, logChange } from '@services/campaignServices';

import { createXeroContact, createXeroInvoiceLocal, sendToSpreadSheet } from '@services/invoiceService';

import fs from 'fs-extra';

import { xero } from '@configs/xero';

import { describeXeroError, isXeroBillFor, noXeroBillWhere, xeroBillNumber } from '@utils/xeroInvoice';
import { prisma } from '@/src/prisma/prisma';

// xero-node uses the default axios instance and sets no timeout, so a hung call would hold a job forever.
axios.defaults.timeout = 30_000;

const XERO_BATCH_SIZE = 50;

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
      data: { status: 'failed' },
    });
    console.error(`❌ Marked ${count}/${invoiceIds.length} invoice(s) failed — ${reason}`, invoiceIds);
  } catch (error) {
    console.error(`🚨 Could not mark invoices failed — ${reason}`, invoiceIds, error);
  }
};

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
      select: { status: true, xeroInvoiceId: true },
    });

    if (!current || current.status !== 'processing' || current.xeroInvoiceId) {
      console.log(
        `⏭️ Skipping invoice ${invoice.id}: status ${current?.status}, xeroInvoiceId ${current?.xeroInvoiceId || 'none'}`,
      );
      return;
    }

    const creatorUser = invoice.creator.user;
    const creatorPaymentForm = creatorUser?.paymentForm;
    const campaign = invoice.campaign;
    const agreement = invoice.creator.user.creatorAgreement.find(
      (item: any) => item.campaignId === invoice.campaignId && item.round === 1,
    );
    const currency = (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR';

    let contactID = invoice.creator.xeroContactId;

    const user = await prisma.user.findUnique({
      where: {
        id: job.data.adminId,
      },
      include: {
        admin: {
          select: {
            xeroTokenSet: true,
          },
        },
      },
    });

    if (!user) throw new Error('User not found');

    const tokenSet: TokenSet = (user.admin?.xeroTokenSet as TokenSet) || null;

    if (!tokenSet) throw new Error('You are not connected to Xero');

    await xero.initialize();
    xero.setTokenSet(tokenSet);

    if (dayjs.unix(tokenSet.expires_at!).isBefore(dayjs())) {
      const validTokenSet = await xero.refreshToken();
      // save the new tokenset
      await prisma.admin.update({
        where: {
          userId: user.id,
        },
        data: {
          xeroTokenSet: validTokenSet as any,
        },
      });
    }

    await xero.updateTenants();

    const activeTenant = xero.tenants.find((item) => item?.orgData?.baseCurrency?.toUpperCase() === currency);

    if (!activeTenant) throw new Error(`Xero organisation for ${currency} is not connected for this admin`);

    const result = await xero.accountingApi.getContacts(
      activeTenant.tenantId,
      undefined, // IDs
      `Name=="${invoice.invoiceFrom.name?.trim()}"`,
    );

    if (result.body.contacts && result.body.contacts.length > 0) {
      contactID = result.body.contacts[0].contactID || null;
    } else {
      const result = await xero.accountingApi.getContacts(
        activeTenant.tenantId,
        undefined, // IDs
        `EmailAddress=="${creatorUser.email.trim()}"`,
      );
      if (result.body.contacts && result.body.contacts.length > 0) {
        contactID = result.body.contacts[0].contactID || null;
      } else {
        const [contact] = await createXeroContact(invoice.bankAcc, invoice.creator, invoice.invoiceFrom, currency);
        contactID = contact.contactID || null;
        await prisma.creator.update({
          where: { id: invoice.creator.id },
          data: { xeroContactId: contactID },
        });
      }
    }

    if (!contactID) throw new Error('No Xero contact was found or created');

    const createdInvoice = await createXeroInvoiceLocal(
      contactID,
      withReimbursementLines(job.data.items, invoice),
      job.data.dueDate,
      xeroCampaignName(campaign.name, invoice),
      invoice.invoiceNumber,
      invoice.user?.email!,
      job.data.invoiceFrom,
      invoice.creator,
      job.data.bankInfo,
      campaign.brand?.name || campaign.company?.name,
      currency,
    );

    const xeroInvoiceId = createdInvoice.body.invoices[0].invoiceID;

    try {
      await prisma.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          xeroInvoiceId,
          status: 'approved',
        },
      });
    } catch (error) {
      console.error(`🚨 Xero bill ${xeroInvoiceId} was created but not linked to invoice ${invoice.id}`, error);
      throw error;
    }

    if (job.data.invoiceAttachment && xeroInvoiceId) {
      await runSafely(`Attachment for invoice ${invoice.id}`, async () => {
        const buffer = fs.readFileSync(job.data.invoiceAttachment.tempFilePath);
        await xero.accountingApi.createInvoiceAttachmentByFileName(
          activeTenant.tenantId,
          xeroInvoiceId,
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

export const bulkInvoiceWorker = new Worker(
  'bulk-invoice-queue',
  async (job) => {
    const { invoiceIds, adminId, attachments } = job.data;
    console.log(`📦 Starting Bulk Approval for ${invoiceIds.length} invoices...`);

    try {
      const user = await prisma.user.findUnique({
        where: { id: adminId },
        include: { admin: { select: { xeroTokenSet: true } } },
      });

      if (!user || !user.admin?.xeroTokenSet) throw new Error('Admin not connected to Xero');

      const tokenSet: TokenSet = user.admin.xeroTokenSet as any;
      await xero.initialize();
      xero.setTokenSet(tokenSet);

      if (tokenSet.expires_at && dayjs.unix(tokenSet.expires_at).isBefore(dayjs())) {
        try {
          const latestAdmin = await prisma.admin.findUnique({
            where: { userId: adminId },
            select: { xeroTokenSet: true },
          });

          const latestToken: TokenSet = latestAdmin?.xeroTokenSet as any;

          if (latestToken?.expires_at && dayjs.unix(latestToken.expires_at).isAfter(dayjs())) {
            console.log('Token was already refreshed by another worker. Skipping refresh.');
            xero.setTokenSet(latestToken);
          } else {
            const validTokenSet = await xero.refreshToken();
            await prisma.admin.update({
              where: { userId: adminId },
              data: { xeroTokenSet: validTokenSet as any },
            });
            xero.setTokenSet(validTokenSet);
          }
        } catch (error) {
          console.error('Critical: Xero Refresh Token is invalid or refresh failed.');
          throw error;
        }
      }

      await xero.updateTenants();

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

      const batches: Record<string, { tenantId: string; bills: PreparedBill[] }> = {};

      for (const invoice of invoices) {
        // The controller moved every invoice of this job to 'processing'. Anything else was handled elsewhere.
        if (invoice.status !== 'processing' || invoice.xeroInvoiceId) continue;

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

          const tenantId = activeTenant.tenantId;
          let contactID = invoice.creator.xeroContactId;

          const clientName = invoice.campaign.brand?.name || invoice.campaign.company?.name || '';
          const campaignName = xeroCampaignName(invoice.campaign.name, invoice);
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
                invoice.bankAcc,
                invoice.creator,
                invoice.invoiceFrom,
                currency,
              );
              contactID = contact.contactID || null;
              await prisma.creator.update({
                where: { id: invoice.creator.id },
                data: { xeroContactId: contactID },
              });
            }
          }

          if (!contactID) throw new Error('No Xero contact was found or created');

          const billNumber = xeroBillNumber(clientName, campaignName, invoice.invoiceNumber);

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

          try {
            const response = await xero.accountingApi.createInvoices(
              batch.tenantId,
              { invoices: bills.map((bill) => bill.xeroInvoice) },
              false,
            );
            xeroResults = response.body.invoices || [];
          } catch (batchError) {
            // The request may still have reached Xero, so say where to look before anyone approves again.
            await markInvoicesFailed(
              bills.map((bill) => bill.invoiceId),
              `Xero createInvoices failed for tenant ${batch.tenantId}: ${describeXeroError(batchError)}. Check Xero for these bills before approving again.`,
            );
            continue;
          }

          // Xero does not promise the response order, so match each result by its unique "(INV-…)" suffix.
          const linkedInvoices = [];

          for (const bill of bills) {
            const xeroInv = xeroResults.find((result) => isXeroBillFor(result.invoiceNumber, bill.invoiceNumber));

            if (!xeroInv) {
              await markInvoicesFailed(
                [bill.invoiceId],
                `Xero returned no result for bill "${bill.billNumber}". Check Xero before approving again.`,
              );
              continue;
            }

            if (xeroInv.hasErrors || !xeroInv.invoiceID) {
              const errors = (xeroInv.validationErrors || []).map((item: any) => item.message).join('; ');
              await markInvoicesFailed([bill.invoiceId], `Xero rejected bill "${bill.billNumber}": ${errors}`);
              continue;
            }

            try {
              const updatedInvoice = await prisma.invoice.update({
                where: { id: bill.invoiceId },
                data: { status: 'approved', xeroInvoiceId: xeroInv.invoiceID },
                include: {
                  campaign: { include: { campaignAdmin: { include: { admin: { include: { role: true } } } } } },
                  creator: { include: { user: { include: { paymentForm: true } } } },
                },
              });
              linkedInvoices.push({ updatedInvoice, xeroInvoiceId: xeroInv.invoiceID as string });
            } catch (error) {
              console.error(
                `🚨 Xero bill ${xeroInv.invoiceID} was created but not linked to invoice ${bill.invoiceId}`,
                error,
              );
            }
          }

          // Side effects run only after every bill in this request is linked, and never stop the loop.
          for (const { updatedInvoice, xeroInvoiceId } of linkedInvoices) {
            const attachment = attachments?.[updatedInvoice.id];

            if (attachment) {
              await runSafely(`Attachment ${attachment.name}`, async () => {
                const buffer = fs.readFileSync(attachment.tempFilePath);
                await xero.accountingApi.createInvoiceAttachmentByFileName(
                  batch.tenantId,
                  xeroInvoiceId,
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
                  name:
                    updatedInvoice.creator.user.paymentForm?.bankAccountName || updatedInvoice.creator.user.name || '',
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
  await worker.close();
  await bulkInvoiceWorker.close();
  process.exit(0);
});
