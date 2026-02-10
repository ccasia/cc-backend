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

const prisma = new PrismaClient();

const io = new Server();

const worker = new Worker(
  'invoice-queue',
  async (job) => {
    throw new Error('ASD');
    // try {
    //   console.log('📨 Sending invoice to Xero', job.data);
    //   const invoice = job.data.invoice;

    //   const creatorUser = invoice.creator.user;
    //   const creatorPaymentForm = creatorUser?.paymentForm;
    //   const campaign = invoice.campaign;
    //   const agreement = invoice.creator.user.creatorAgreement.find(
    //     (item: any) => item.campaignId === invoice.campaignId,
    //   );

    //   let contactID = invoice.creator.xeroContactId;

    //   const user = await prisma.user.findUnique({
    //     where: {
    //       id: job.data.adminId,
    //     },
    //     include: {
    //       admin: {
    //         select: {
    //           xeroTokenSet: true,
    //         },
    //       },
    //     },
    //   });

    //   if (!user) throw new Error('User not found');

    //   const tokenSet: TokenSet = (user.admin?.xeroTokenSet as TokenSet) || null;

    //   if (!tokenSet) throw new Error('You are not connected to Xero');

    //   await xero.initialize();
    //   xero.setTokenSet(tokenSet);

    //   if (dayjs.unix(tokenSet.expires_at!).isBefore(dayjs())) {
    //     const validTokenSet = await xero.refreshToken();
    //     // save the new tokenset
    //     await prisma.admin.update({
    //       where: {
    //         userId: user.id,
    //       },
    //       data: {
    //         xeroTokenSet: validTokenSet as any,
    //       },
    //     });
    //   }

    //   await xero.updateTenants();

    //   const activeTenant = xero.tenants.find(
    //     (item) =>
    //       item?.orgData.baseCurrency.toUpperCase() === ((agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR'),
    //   );
    //   console.log('ACTIVE UPDATE:', activeTenant);
    //   console.log('CREATOR NAME:', creatorUser.name?.trim());
    //   const result = await xero.accountingApi.getContacts(
    //     activeTenant.tenantId,
    //     undefined, // IDs
    //     // `EmailAddress=="${creatorUser.email}"`,
    //     // `EmailAddress=="${creatorUser.email}" || Name=="${creatorUser.name}"`,
    //     `Name=="${invoice.invoiceFrom.name?.trim()}"`,
    //   );
    //   if (result.body.contacts && result.body.contacts.length > 0) {
    //     contactID = result.body.contacts[0].contactID || null;
    //   } else {
    //     const result = await xero.accountingApi.getContacts(
    //       activeTenant.tenantId,
    //       undefined, // IDs
    //       `EmailAddress=="${creatorUser.email.trim()}"`,
    //       // `EmailAddress=="${creatorUser.email}" || Name=="${creatorUser.name}"`,
    //     );
    //     if (result.body.contacts && result.body.contacts.length > 0) {
    //       contactID = result.body.contacts[0].contactID || null;
    //     } else {
    //       const [contact] = await createXeroContact(
    //         invoice.bankAcc,
    //         invoice.creator,
    //         invoice.invoiceFrom,
    //         (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
    //       );
    //       contactID = contact.contactID || null;
    //       await prisma.creator.update({
    //         where: { id: invoice.creator.id },
    //         data: { xeroContactId: contactID },
    //       });
    //     }
    //   }
    //   if (contactID) {
    //     const createdInvoice = await createXeroInvoiceLocal(
    //       contactID,
    //       job.data.items,
    //       job.data.dueDate,
    //       campaign.name,
    //       invoice.invoiceNumber,
    //       invoice.user?.email!,
    //       job.data.invoiceFrom,
    //       invoice.creator,
    //       job.data.bankInfo,
    //       campaign.brand?.name || campaign.company?.name,
    //       (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
    //     );

    //     await prisma.invoice.update({
    //       where: {
    //         id: invoice.id,
    //       },
    //       data: {
    //         xeroInvoiceId: createdInvoice.body.invoices[0].invoiceID,
    //       },
    //     });

    //     if (job.data.invoiceAttachment && createdInvoice.body.invoices[0].invoiceID) {
    //       const buffer = fs.readFileSync(job.data.invoiceAttachment.tempFilePath);
    //       await xero.accountingApi.createInvoiceAttachmentByFileName(
    //         activeTenant.tenantId,
    //         createdInvoice.body.invoices[0].invoiceID,
    //         job.data.invoiceAttachment.name,
    //         buffer,
    //         false,
    //         undefined,
    //         {
    //           headers: {
    //             'Content-Type': job.data.invoiceAttachment.mimetype,
    //           },
    //         },
    //       );
    //     }
    //   }

    //   const { title, message } = notificationInvoiceUpdate(campaign.name);
    //   // Notify CSM admins
    //   const adminNotifications = await Promise.all(
    //     campaign.campaignAdmin
    //       .filter((admin: any) => admin.admin.role?.name === 'CSM')
    //       .map(async (admin: any) => {
    //         const notification = await saveNotification({
    //           userId: admin.adminId,
    //           title,
    //           message,
    //           entity: 'Invoice',
    //           threadId: invoice.id,
    //           entityId: invoice.campaignId,
    //         });
    //         io.to(users.get(admin.adminId)).emit('notification', notification);
    //         return notification;
    //       }),
    //   );

    //   const adminId = job.data.adminId;

    //   if (adminId) {
    //     const adminLogMessage = `Updated Invoice for - "${creatorUser?.name}"`;
    //     logAdminChange(adminLogMessage, adminId);
    //   }
    //   // Log invoice approval in campaign logs for Invoice Actions tab
    //   if (adminId && invoice.campaignId) {
    //     const creatorName = creatorUser?.name || 'Unknown Creator';
    //     const logMessage = `Approved invoice ${invoice.invoiceNumber} for ${creatorName}`;
    //     await logChange(logMessage, invoice.campaignId, undefined, adminId);
    //   }

    //   await sendToSpreadSheet(
    //     {
    //       createdAt: dayjs().format('YYYY-MM-DD'),
    //       name: creatorUser?.name || '',
    //       icNumber: creatorPaymentForm?.icNumber || '',
    //       bankName: creatorPaymentForm?.bankAccountName || '',
    //       bankAccountNumber: creatorPaymentForm?.bankAccountNumber || '',
    //       campaignName: campaign.name,
    //       amount: invoice.amount,
    //     },
    //     '1VClmvYJV9R4HqjADhGA6KYIR9KCFoXTag5SMVSL4rFc',
    //     'Invoices',
    //   );

    //   // Notify creator
    //   const creatorNotification = await saveNotification({
    //     userId: invoice.creatorId,
    //     title,
    //     message,
    //     entity: 'Invoice',
    //     threadId: invoice.id,
    //     entityId: invoice.campaignId,
    //   });

    //   io.to(users.get(invoice.creatorId)).emit('notification', creatorNotification);
    // } catch (error) {
    //   throw new Error(error);
    // }
  },
  {
    connection,
    concurrency: 10,
  },
);

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
        status: 'draft',
      },
    });
  }
  await job?.remove();
  console.error(`❌ Job ${job?.id} failed`, err);
});

// graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
