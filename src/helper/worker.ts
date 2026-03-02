import { Worker } from 'bullmq';
import connection from '@configs/redis';

import { TokenSet } from 'xero-node';
import dayjs from 'dayjs';

import { notificationInvoiceUpdate } from './notification';
import { saveNotification } from '@controllers/notificationController';

import { logAdminChange, logChange } from '@services/campaignServices';

import { createXeroContact, createXeroInvoiceLocal, sendToSpreadSheet } from '@services/invoiceService';

import fs from 'fs-extra';

import { PrismaClient } from '@prisma/client';

import { xero } from '@configs/xero';
import { Server } from 'socket.io';
import { users } from '@utils/activeUsers';
// import { io } from '../server';

const prisma = new PrismaClient();

const io = new Server();

const worker = new Worker(
  'invoice-queue',
  async (job) => {
    console.log('📨 Sending invoice to Xero', job.data);
    const invoice = job.data.invoice;

    const creatorUser = invoice.creator.user;
    const creatorPaymentForm = creatorUser?.paymentForm;
    const campaign = invoice.campaign;
    const agreement = invoice.creator.user.creatorAgreement.find((item: any) => item.campaignId === invoice.campaignId);

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

    const activeTenant = xero.tenants.find(
      (item) =>
        item?.orgData.baseCurrency.toUpperCase() === ((agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR'),
    );
    console.log('ACTIVE UPDATE:', activeTenant);
    console.log('CREATOR NAME:', creatorUser.name?.trim());
    const result = await xero.accountingApi.getContacts(
      activeTenant.tenantId,
      undefined, // IDs
      // `EmailAddress=="${creatorUser.email}"`,
      // `EmailAddress=="${creatorUser.email}" || Name=="${creatorUser.name}"`,
      `Name=="${invoice.invoiceFrom.name?.trim()}"`,
    );
    if (result.body.contacts && result.body.contacts.length > 0) {
      contactID = result.body.contacts[0].contactID || null;
    } else {
      const result = await xero.accountingApi.getContacts(
        activeTenant.tenantId,
        undefined, // IDs
        `EmailAddress=="${creatorUser.email.trim()}"`,
        // `EmailAddress=="${creatorUser.email}" || Name=="${creatorUser.name}"`,
      );
      if (result.body.contacts && result.body.contacts.length > 0) {
        contactID = result.body.contacts[0].contactID || null;
      } else {
        const [contact] = await createXeroContact(
          invoice.bankAcc,
          invoice.creator,
          invoice.invoiceFrom,
          (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
        );
        contactID = contact.contactID || null;
        await prisma.creator.update({
          where: { id: invoice.creator.id },
          data: { xeroContactId: contactID },
        });
      }
    }
    if (contactID) {
      const createdInvoice = await createXeroInvoiceLocal(
        contactID,
        job.data.items,
        job.data.dueDate,
        campaign.name,
        invoice.invoiceNumber,
        invoice.user?.email!,
        job.data.invoiceFrom,
        invoice.creator,
        job.data.bankInfo,
        campaign.brand?.name || campaign.company?.name,
        (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
      );

      await prisma.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          xeroInvoiceId: createdInvoice.body.invoices[0].invoiceID,
          status: 'approved',
        },
      });

      if (job.data.invoiceAttachment && createdInvoice.body.invoices[0].invoiceID) {
        const buffer = fs.readFileSync(job.data.invoiceAttachment.tempFilePath);
        await xero.accountingApi.createInvoiceAttachmentByFileName(
          activeTenant.tenantId,
          createdInvoice.body.invoices[0].invoiceID,
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
      }
    }

    const { title, message } = notificationInvoiceUpdate(campaign.name);
    // Notify CSM admins
    const adminNotifications = await Promise.all(
      campaign.campaignAdmin
        .filter((admin: any) => admin.admin.role?.name === 'CSM')
        .map(async (admin: any) => {
          const notification = await saveNotification({
            userId: admin.adminId,
            title,
            message,
            entity: 'Invoice',
            threadId: invoice.id,
            entityId: invoice.campaignId,
          });
          io.to(users.get(admin.adminId)).emit('notification', notification);
          return notification;
        }),
    );

    const adminId = job.data.adminId;

    if (adminId) {
      const adminLogMessage = `Updated Invoice for - "${creatorUser?.name}"`;
      logAdminChange(adminLogMessage, adminId);
    }
    // Log invoice approval in campaign logs for Invoice Actions tab
    if (adminId && invoice.campaignId) {
      const creatorName = creatorUser?.name || 'Unknown Creator';
      const logMessage = `Approved invoice ${invoice.invoiceNumber} for ${creatorName}`;
      await logChange(logMessage, invoice.campaignId, undefined, adminId);
    }

    await sendToSpreadSheet(
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
    );

    // Notify creator
    const creatorNotification = await saveNotification({
      userId: invoice.creatorId,
      title,
      message,
      entity: 'Invoice',
      threadId: invoice.id,
      entityId: invoice.campaignId,
    });

    io.to(users.get(invoice.creatorId)).emit('notification', creatorNotification);
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

        if (latestToken.expires_at && dayjs.unix(latestToken.expires_at).isAfter(dayjs())) {
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

    const batches: Record<string, { tenantId: string; xeroInvoices: any[]; invoiceIds: string[] }> = {};

    for (const invoice of invoices) {
      try {
        if (invoice.status === 'approved' || invoice.status === 'paid') continue;

        const agreement = invoice.creator.user.creatorAgreement.find((a) => a.campaignId === invoice.campaignId);

        const currency = (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR';

        const activeTenant = xero.tenants.find((t) => t?.orgData.baseCurrency.toUpperCase() === currency);

        if (!activeTenant) continue;

        const tenantId = activeTenant.tenantId;
        let contactID = invoice.creator.xeroContactId;

        const clientName = invoice.campaign.brand?.name || invoice.campaign.company?.name || '';
        const campaignName = invoice.campaign.name;
        const recipientName =
          (invoice.bankAcc as any)?.payTo ||
          invoice.creator.user.paymentForm?.bankAccountName ||
          invoice.creator.user.name;

        const result = await xero.accountingApi.getContacts(tenantId, undefined, `Name=="${recipientName.trim()}"`);

        if (result.body.contacts && result.body.contacts?.length > 0) {
          contactID = result.body.contacts[0].contactID || null;
        } else {
          const [contact] = await createXeroContact(invoice.bankAcc, invoice.creator, invoice.invoiceFrom, currency);
          contactID = contact.contactID || null;

          await prisma.creator.update({
            where: { id: invoice.creator.id },
            data: { xeroContactId: contactID },
          });
        }

        if (!batches[tenantId]) batches[tenantId] = { tenantId, xeroInvoices: [], invoiceIds: [] };

        batches[tenantId].xeroInvoices.push({
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
          invoiceNumber: `${clientName} ${campaignName}` || 'N/A',
          reference: `${clientName} ${campaignName}`,
        });
        batches[tenantId].invoiceIds.push(invoice.id);
      } catch (err) {
        console.error(`Error prepping invoice ${invoice.id}:`, err.message);
      }
    }

    for (const tenantId in batches) {
      const batch = batches[tenantId];
      if (batch.xeroInvoices.length === 0) continue;

      try {
        const response = await xero.accountingApi.createInvoices(tenantId, { invoices: batch.xeroInvoices }, false);
        const xeroResults = response.body.invoices || [];

        for (let i = 0; i < xeroResults.length; i++) {
          const xeroInv = xeroResults[i];
          const invoiceId = batch.invoiceIds[i];

          if (xeroInv.hasErrors) {
            console.error(`Xero Error [INV: ${xeroInv.invoiceNumber}]:`, xeroInv.validationErrors);

            await prisma.invoice.update({
              where: { id: invoiceId },
              data: { status: 'failed' },
            });

            continue;
          }

          const updatedInvoice = await prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'approved', xeroInvoiceId: xeroInv.invoiceID },
            include: {
              campaign: { include: { campaignAdmin: true } },
              creator: { include: { user: { include: { paymentForm: true } } } },
            },
          });

          const attachment = job.data.attachments?.[invoiceId];
          if (attachment && xeroInv.invoiceID) {
            try {
              const buffer = fs.readFileSync(attachment.tempFilePath);
              await xero.accountingApi.createInvoiceAttachmentByFileName(
                tenantId,
                xeroInv.invoiceID,
                attachment.name,
                buffer,
                false,
                undefined,
                { headers: { 'Content-Type': attachment.mimetype } },
              );

              // await fs.remove(attachment.tempFilePath);
              console.log(`📎 Successfully attached: ${attachment.name}`);
            } catch (error) {
              console.error(`❌ Failed to attach ${attachment.name}:`, error.message);
            } finally {
              if (await fs.pathExists(attachment.tempFilePath)) {
                await fs.remove(attachment.tempFilePath);
                console.log(`🗑️ Deleted temp file: ${attachment.tempFilePath}`);
              }
            }
          }

          await logChange(
            `Bulk approved invoice ${updatedInvoice.invoiceNumber}`,
            updatedInvoice.campaignId,
            undefined,
            adminId,
          );

          await sendToSpreadSheet(
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
          );

          const { title, message } = notificationInvoiceUpdate(updatedInvoice.campaign.name);

          if (updatedInvoice.campaign?.campaignAdmin) {
            await Promise.all(
              updatedInvoice.campaign.campaignAdmin
                .filter((a: any) => a.admin?.role?.name === 'CSM')
                .map(async (admin: any) => {
                  try {
                    const notification = await saveNotification({
                      userId: admin.adminId,
                      title,
                      message,
                      entity: 'Invoice',
                      threadId: updatedInvoice.id,
                      entityId: updatedInvoice.campaignId,
                    });
                    const userId = users.get(admin.adminId);
                    if (userId) io.to(userId).emit('notification', notification);
                  } catch (e) {
                    console.error('CSM Notif failed', admin.adminId);
                  }
                }),
            );
          }

          // const { title, message } = notificationInvoiceUpdate(updatedInvoice.campaign.name);
          const creatorNotification = await saveNotification({
            userId: updatedInvoice.creatorId,
            title,
            message,
            entity: 'Invoice',
            entityId: updatedInvoice.campaignId,
          });
          io.to(updatedInvoice.creatorId).emit('notification', creatorNotification);
        }
      } catch (batchError) {
        console.error(`Critical Batch Error for tenant ${tenantId}:`, batchError.message);
      }
    }

    if (adminId) {
      logAdminChange(`Completed bulk approval for ${invoiceIds.length} invoices`, adminId);
    }

    console.log('✅ Bulk processing job finished');
  },
  {
    connection,
    concurrency: 1, // Keep at 1 to avoid Xero rate limiting on bulk updates
  },
);

bulkInvoiceWorker.on('completed', (job) => {
  console.log(`✅Bulk Job ${job.id} done`);
});

bulkInvoiceWorker.on('failed', (job, err) => {
  console.error(`❌ Bulk Job ${job?.id} failed:`, err);
});

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} done`);
});

worker.on('failed', async (job, err) => {
  if (job?.data.invoice) {
    await prisma.invoice.update({
      where: {
        id: job?.data.invoice.id,
      },
      data: {
        status: 'failed',
      },
    });
  }
  await job?.remove();
  console.error(`❌ Job ${job?.id} failed`, err);
});

// graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await bulkInvoiceWorker.close();
  process.exit(0);
});
