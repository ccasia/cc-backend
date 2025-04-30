import axios from 'axios';

import { XeroClient, Contact, LineItem, Invoice, Phone } from 'xero-node';
import jwt, { Secret } from 'jsonwebtoken';

import { Request, Response } from 'express';

import { creatorInvoice as emailCreatorInvoice } from '@configs/nodemailer.config';
import { logAdminChange } from '@services/campaignServices';

import { InvoiceStatus, PrismaClient } from '@prisma/client';
import {
  notificationInvoiceGenerate,
  notificationInvoiceStatus,
  notificationInvoiceUpdate,
} from '@helper/notification';
import { saveNotification } from './notificationController';
import { clients, io } from '../server';

import { TokenSet } from 'openid-client';
import { error } from 'console';

import fs from 'fs-extra';
import { createInvoiceService, rejectInvoice, sendToSpreadSheet } from '@services/invoiceService';
import dayjs from 'dayjs';
// import { decreamentCreditCampiagn } from '@services/packageService';

const prisma = new PrismaClient();

const client_id: string = process.env.XERO_CLIENT_ID as string;
const client_secret: string = process.env.XERO_CLIENT_SECRET as string;
const redirectUrl: string = process.env.XERO_REDIRECT_URL as string;
const scopes: string = process.env.XERO_SCOPES as string;

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes?.split(' '),
});

// invoice type definition
interface invoiceData {
  invoiceId: string;
  invoiceNumber: string;
  createDate: Date;
  dueDate: Date;
  status: InvoiceStatus;
  invoiceFrom: any;
  invoiceTo: object;
  items: object[];
  totalAmount: number;
  bankInfo: object;
  createdBy: string;
  campaignId: string;
  xeroContactId?: string;
  newContact?: boolean;
  otherReason?: string;
  reason?: string;
}

export const getAllInvoices = async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: {
        creator: {
          include: {
            user: true,
          },
        },
        user: {
          include: {
            creator: true,
          },
        },
        campaign: true,
      },
    });

    return res.status(200).json(invoices);
  } catch (error) {
    return res.status(400).json(error);
  }
};

// get invoices by creator id
export const getInvoicesByCreatorId = async (req: Request, res: Response) => {
  const userid = req.session.userid;

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        creatorId: userid,
      },
      include: {
        campaign: {
          include: {
            brand: true,
            company: true,
          },
        },
      },
    });
    return res.status(200).json(invoices);
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// get invoices by campaign id
export const getInvoicesByCampaignId = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        campaignId: id,
      },
      include: {
        creator: true,
        campaign: true,
        user: true,
      },
    });
    res.status(200).json(invoices);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// get single invoice by id
export const getInvoiceById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const invoice = await prisma.invoice.findUnique({
      where: {
        id: id,
      },
      include: {
        creator: {
          include: {
            user: {
              include: {
                paymentForm: true,
              },
            },
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
            company: {
              select: {
                id: true,
                name: true,
              },
            },
            brand: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        user: true,
      },
    });
    res.status(200).json(invoice);
  } catch (error) {
    res.status(400).json(error);
  }
};

// get invoice by creator id and campaign id
export const getInvoiceByCreatorIdAndCampaignId = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.params;

  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    });

    return res.status(200).json(invoice);
  } catch (error) {
    //console.log(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

// create invoices
export const createInvoice = async (req: Request, res: Response) => {
  // get user id from session
  const { userid } = req.session;

  const {
    invoiceNumber,
    createDate,
    dueDate,
    status,
    invoiceFrom,
    invoiceTo,
    items,
    totalAmount,
    campaignId,
    bankInfo,
  }: invoiceData = req.body;
  const item: object = items[0];
  const creatorIdInfo = invoiceFrom.id;

  try {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        createdAt: createDate,
        dueDate,
        status: status as InvoiceStatus,
        invoiceFrom: invoiceFrom,
        invoiceTo: invoiceTo,
        task: item,
        amount: totalAmount,
        bankAcc: bankInfo,
        campaignId: campaignId,
        creatorId: creatorIdInfo,
        adminId: userid,
      },
    });

    const message = `Invoice generated in campaign - ${invoice.campaignId} `;
    logAdminChange(message, userid, req);
    return res.status(201).json(invoice);
  } catch (error) {
    return res.status(400).json(error);
  }
};

// update invoice status
export const updateInvoiceStatus = async (req: Request, res: Response) => {
  const { invoiceId, status } = req.body;
  try {
    const invoice = await prisma.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        status: status as InvoiceStatus,
      },
      include: {
        campaign: {
          include: { campaignAdmin: { include: { admin: true } } },
        },
        user: true,
      },
    });
    res.status(200).json(invoice);

    const { title, message } = notificationInvoiceStatus(invoice.campaign.name);

    // Notify Finance Admins and Creator
    for (const admin of invoice.campaign.campaignAdmin) {
      const notification = await saveNotification({
        userId: admin.admin.userId,
        title,
        message,
        entity: 'Invoice',
        entityId: invoice.campaignId,
      });
      io.to(clients.get(admin.adminId)).emit('notification', notification);
    }
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// export const updateInvoice = async (req: Request, res: Response) => {
//   const {
//     invoiceId,
//     dueDate,
//     status,
//     invoiceFrom,
//     invoiceTo,
//     items,
//     totalAmount,
//     campaignId,
//     bankInfo,
//     xeroContactId,
//   }: invoiceData = req.body;

//   try {
//     const invoice = await prisma.invoice.update({
//       where: {
//         id: invoiceId,
//       },
//       data: {
//         dueDate,
//         status: status as InvoiceStatus,
//         invoiceFrom,
//         invoiceTo,
//         task: items[0],
//         amount: totalAmount,
//         bankAcc: bankInfo,
//         campaignId,
//       },
//       include: {
//         creator: true,
//         user: true,
//         campaign: {
//           include: {
//             campaignAdmin: {
//               include: {
//                 admin: {
//                   include: {
//                     role: true,
//                   },
//                 },
//               },
//             },
//           },
//         },
//       },
//     });

//     let contactID: any;
//     let invoiceData: any;

//     if (invoice.creator.xeroContactId) {
//       contactID = invoice.creator.xeroContactId;
//       invoiceData = await createXeroInvoiceLocal(
//         contactID,
//         items,
//         dueDate,
//         invoice.campaign.name,
//         invoice.invoiceNumber,
//       );
//     }

//     // if (status == 'approved' && xeroContactId) {
//     //   invoiceData = await createXeroInvoiceLocal(
//     //     invoice.creator.xeroContactId as string,
//     //     items,
//     //     dueDate,
//     //     invoice.campaign.name,
//     //     invoice.invoiceNumber,
//     //   );
//     //   contactID = invoice.creator.xeroContactId;
//     // }

//     if (status == 'approved' && req.body.newContact) {
//       const contact: any = await createXeroContact(bankInfo, invoice.creator, invoice.user, invoiceFrom);
//       contactID = contact[0].contactID;
//       invoiceData = await createXeroInvoiceLocal(
//         contactID,
//         items,
//         dueDate,
//         invoice.campaign.name,
//         invoice.invoiceNumber,
//       );
//     }

//     // Attach invoice PDF in xero
//     // await attachInvoicePDF(xero.tenants[0].tenantId);

//     await prisma.creator.update({
//       where: {
//         id: invoice.creator.id,
//       },
//       data: {
//         xeroContactId: contactID,
//       },
//     });

//     const { title, message } = notificationInvoiceUpdate(invoice.campaign.name);

//     for (const admin of invoice.campaign.campaignAdmin) {
//       if (admin.admin.role?.name === 'CSM') {
//         try {
//           const notification = await saveNotification({
//             userId: admin.adminId,
//             title,
//             message,
//             entity: 'Invoice',
//             threadId: invoice.id,
//             // invoiceId: invoice.id,
//             entityId: invoice.campaignId,
//           });
//           //  console.log("Sending notification to admin:", admin.adminId, notification);
//           io.to(clients.get(admin.adminId)).emit('notification', notification);
//         } catch (error) {
//           console.error('Error notifying admin:', error);
//         }
//       }
//     }

//     const creatorNotification = await saveNotification({
//       userId: invoice.creatorId,
//       title,
//       message,
//       entity: 'Invoice',
//       threadId: invoice.id,
//       // invoiceId: invoice.id,
//       entityId: invoice.campaignId,
//     });

//     io.to(clients.get(invoice.creatorId)).emit('notification', creatorNotification);

//     return res.status(200).json(invoice);
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// };

// export const updateInvoice = async (req: Request, res: Response) => {
//   const {
//     invoiceId,
//     dueDate,
//     status,
//     invoiceFrom,
//     invoiceTo,
//     items,
//     totalAmount,
//     campaignId,
//     bankInfo,
//     newContact,
//     reason,
//   }: invoiceData = req.body;

//   try {
//     const invoice = await prisma.$transaction(async (tx) => {
//       const invoice = await tx.invoice.update({
//         where: {
//           id: invoiceId,
//         },
//         data: {
//           dueDate,
//           status: status as InvoiceStatus,
//           invoiceFrom,
//           invoiceTo,
//           task: items[0],
//           amount: totalAmount,
//           bankAcc: bankInfo,
//           campaignId,
//         },
//         include: {
//           creator: {
//             include: {
//               user: {
//                 select: {
//                   id: true,
//                   name: true,
//                   paymentForm: true,
//                 },
//               },
//             },
//           },
//           user: true,
//           campaign: {
//             include: {
//               campaignAdmin: {
//                 include: {
//                   admin: {
//                     include: {
//                       role: true,
//                     },
//                   },
//                 },
//               },
//             },
//           },
//         },
//       });

//       let contactID: any;
//       let invoiceData: any;

//       if (!newContact) {
//         contactID = invoice.creator.xeroContactId;
//       } else {
//         const contact: any = await createXeroContact(bankInfo, invoice.creator, invoice.user, invoiceFrom);
//         contactID = contact[0].contactID;

//         await tx.creator.update({
//           where: {
//             id: invoice.creator.id,
//           },
//           data: {
//             xeroContactId: contactID,
//           },
//         });
//       }

//       if (status == 'approved') {
//         await sendToSpreadSheet(
//           {
//             createdAt: dayjs().format(''),
//             name: invoice.creator.user?.name as string,
//             icNumber: invoice.creator.user.paymentForm?.icNumber as string,
//             bankName: invoice.creator.user.paymentForm?.bankAccountName as string,
//             bankAccountNumber: invoice.creator.user.paymentForm?.bankAccountNumber as string,
//             campaignName: invoice.campaign.name,
//             amount: invoice.amount,
//           },
//           '1VClmvYJV9R4HqjADhGA6KYIR9KCFoXTag5SMVSL4rFc',
//           'Invoices',
//         );

//         invoiceData = await createXeroInvoiceLocal(
//           contactID,
//           items,
//           dueDate,
//           invoice.campaign.name,
//           invoice.invoiceNumber,
//         );

//         const { title, message } = notificationInvoiceUpdate(invoice.campaign.name);

//         for (const admin of invoice.campaign.campaignAdmin) {
//           if (admin.admin.role?.name === 'CSM') {
//             try {
//               const notification = await saveNotification({
//                 userId: admin.adminId,
//                 title,
//                 message,
//                 entity: 'Invoice',
//                 threadId: invoice.id,
//                 // invoiceId: invoice.id,
//                 entityId: invoice.campaignId,
//               });
//               //  console.log("Sending notification to admin:", admin.adminId, notification);
//               io.to(clients.get(admin.adminId)).emit('notification', notification);
//             } catch (error) {
//               console.error('Error notifying admin:', error);
//             }
//           }
//         }

//         const adminId = req.session.userid;

//         if (adminId) {
//           const adminLogMessage = `Updated Invoice for - "${invoice.creator.user?.name}" `;
//           logAdminChange(adminLogMessage, adminId, req);
//         }

//         const creatorNotification = await saveNotification({
//           userId: invoice.creatorId,
//           title,
//           message,
//           entity: 'Invoice',
//           threadId: invoice.id,
//           entityId: invoice.campaignId,
//         });

//         io.to(clients.get(invoice.creatorId)).emit('notification', creatorNotification);
//       }

//       if (status === 'rejected') {
//         await rejectInvoice({
//           userId: invoice?.user?.id,
//           tx: tx as PrismaClient,
//           reason: reason as string,
//           campaignName: invoice.campaign.name,
//         });
//       }

//       return invoice;
//     });

//     return res.status(200).json(invoice);
//   } catch (error) {
//     console.log(error);
//     return res.status(400).json(error);
//   }
// };

export const updateInvoice = async (req: Request, res: Response) => {
  const {
    invoiceId,
    dueDate,
    status,
    invoiceFrom,
    invoiceTo,
    items,
    totalAmount,
    campaignId,
    bankInfo,
    newContact,
    reason,
  }: invoiceData = req.body;

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          dueDate,
          status: status as InvoiceStatus,
          invoiceFrom,
          invoiceTo,
          task: items[0],
          amount: totalAmount,
          bankAcc: bankInfo,
          campaignId,
        },
        include: {
          creator: {
            include: {
              user: { select: { id: true, name: true, paymentForm: true } },
            },
          },
          user: true,
          campaign: {
            include: {
              campaignAdmin: {
                include: {
                  admin: { include: { role: true } },
                },
              },
            },
          },
        },
      });

      const creatorUser = updatedInvoice.creator.user;
      const creatorPaymentForm = creatorUser?.paymentForm;
      const campaign = updatedInvoice.campaign;

      let contactID = updatedInvoice.creator.xeroContactId;

      if (newContact) {
        const [contact] = await createXeroContact(bankInfo, updatedInvoice.creator, updatedInvoice.user, invoiceFrom);
        contactID = contact.contactID;

        await tx.creator.update({
          where: { id: updatedInvoice.creator.id },
          data: { xeroContactId: contactID },
        });
      }

      if (status === 'approved') {
        await sendToSpreadSheet(
          {
            createdAt: dayjs().format('YYYY-MM-DD'),
            name: creatorUser?.name || '',
            icNumber: creatorPaymentForm?.icNumber || '',
            bankName: creatorPaymentForm?.bankAccountName || '',
            bankAccountNumber: creatorPaymentForm?.bankAccountNumber || '',
            campaignName: campaign.name,
            amount: updatedInvoice.amount,
          },
          '1VClmvYJV9R4HqjADhGA6KYIR9KCFoXTag5SMVSL4rFc',
          'Invoices',
        );

        if (contactID) {
          await createXeroInvoiceLocal(contactID, items, dueDate, campaign.name, updatedInvoice.invoiceNumber);
        }

        const { title, message } = notificationInvoiceUpdate(campaign.name);

        // Notify CSM admins
        await Promise.all(
          campaign.campaignAdmin
            .filter((admin) => admin.admin.role?.name === 'CSM')
            .map(async (admin) => {
              const notification = await saveNotification({
                userId: admin.adminId,
                title,
                message,
                entity: 'Invoice',
                threadId: updatedInvoice.id,
                entityId: updatedInvoice.campaignId,
              });

              io.to(clients.get(admin.adminId)).emit('notification', notification);
            }),
        );

        const adminId = req.session.userid;

        if (adminId) {
          const adminLogMessage = `Updated Invoice for - "${creatorUser?.name}"`;
          logAdminChange(adminLogMessage, adminId, req);
        }

        // Notify creator
        const creatorNotification = await saveNotification({
          userId: updatedInvoice.creatorId,
          title,
          message,
          entity: 'Invoice',
          threadId: updatedInvoice.id,
          entityId: updatedInvoice.campaignId,
        });

        io.to(clients.get(updatedInvoice.creatorId)).emit('notification', creatorNotification);
      }

      if (status === 'rejected') {
        await rejectInvoice({
          userId: updatedInvoice?.creator?.user?.id,
          tx,
          reason: reason || '',
          campaignName: campaign.name,
        });
      }

      return updatedInvoice;
    });

    return res.status(200).json(invoice);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(400).json({ error: message });
  }
};

export const getXero = async (req: Request, res: Response) => {
  try {
    const consentUrl = await xero.buildConsentUrl();
    return res.status(200).json({ url: consentUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate consent URL' });
  }
};

export const xeroCallBack = async (req: Request, res: Response) => {
  console.log(req.url);
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const tokenSet: TokenSet = await xero.apiCallback(req.url);

    // await xero.updateTenants();

    // const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);

    const decodedAccessToken: any = jwt.decode(tokenSet.access_token as any);

    await prisma.user.update({
      where: {
        id: req.session.userid,
      },
      data: {
        xeroRefreshToken: tokenSet.refresh_token,
        updateRefershToken: dayjs().toDate(),
        admin: {
          update: {
            xeroTokenSet: tokenSet as any,
          },
        },
      },
    });

    return res.status(200).json({ token: decodedAccessToken || null }); // Send the token response back to the client
  } catch (err) {
    console.log(err);
    return res.status(400).json(error);
  }
};

// {
//   id_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgxNTcwRUZDMTkiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJISy1PWm5jdGJjQW8xbkp2MENZVmdWY09fQmsifQ.eyJuYmYiOjE3NDU5OTM1NDEsImV4cCI6MTc0NTk5Mzg0MSwiaXNzIjoiaHR0cHM6Ly9pZGVudGl0eS54ZXJvLmNvbSIsImF1ZCI6IkVEMTAxRTJBQUZBMjQyNzBCODVBMUZFMjNDMUQ4OEUxIiwiaWF0IjoxNzQ1OTkzNTQxLCJhdF9oYXNoIjoiX3hpS0VLNHJWT3RGSlllNFJHbWU1QSIsInNpZCI6IjE4Y2I0NjAxYTg3ODRmMDFhM2I4Njc4ZWRlMGY0YjZkIiwic3ViIjoiZGRkMmI5MzJkZGViNWEyMjk1YWJhZmJlNjE3N2U2ZTQiLCJhdXRoX3RpbWUiOjE3NDU5OTM1MzEsInhlcm9fdXNlcmlkIjoiYjA2YzY4ZDgtZGM1ZC00YWZhLTg3ZjUtNWYwYzU3MWI0NTgxIiwiZ2xvYmFsX3Nlc3Npb25faWQiOiIxOGNiNDYwMWE4Nzg0ZjAxYTNiODY3OGVkZTBmNGI2ZCIsInByZWZlcnJlZF91c2VybmFtZSI6ImF0aXFAY3VsdGNyZWF0aXZlLmFzaWEiLCJlbWFpbCI6ImF0aXFAY3VsdGNyZWF0aXZlLmFzaWEiLCJnaXZlbl9uYW1lIjoiTnVyIEF0aXFhaCIsImZhbWlseV9uYW1lIjoiWmFpbnVsIiwibmFtZSI6Ik51ciBBdGlxYWggWmFpbnVsIiwiYW1yIjpbInB3ZCJdfQ.AqiCqFQ-vcG-ZBJ1EAa7EN9L7XfSldDEBXpGA6OEtMvjp7cmT66g7xNExQfp-nwLfxLnRFxiDiXB-2PROx6LNNyLvA4TNRmggPdnGnEoxcMsVJO-FHRNHxy98JrlSd1QvmpLPUS_sEWVT_c89MJch1UpCrLUR8Bsymitm4slYXpCNEAoNbRGQSXzT9XTSeKCv7FxdinhrdYlDo_w6H_YhL7w9Fitc2ocITqaAGS_3tackOKtfbNEaI1_Ho4z6dBbmv83SAJEwCG8MAzN5c1ji4XGEffec23Y9at_oxS333PePgB5RxfXPFLx8x7cLfrvL2wITUNDWmDQrwMrX51dig',
//   access_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgxNTcwRUZDMTkiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJISy1PWm5jdGJjQW8xbkp2MENZVmdWY09fQmsifQ.eyJuYmYiOjE3NDU5OTM1NDEsImV4cCI6MTc0NTk5NTM0MSwiaXNzIjoiaHR0cHM6Ly9pZGVudGl0eS54ZXJvLmNvbSIsImF1ZCI6Imh0dHBzOi8vaWRlbnRpdHkueGVyby5jb20vcmVzb3VyY2VzIiwiY2xpZW50X2lkIjoiRUQxMDFFMkFBRkEyNDI3MEI4NUExRkUyM0MxRDg4RTEiLCJzdWIiOiJkZGQyYjkzMmRkZWI1YTIyOTVhYmFmYmU2MTc3ZTZlNCIsImF1dGhfdGltZSI6MTc0NTk5MzUzMSwieGVyb191c2VyaWQiOiJiMDZjNjhkOC1kYzVkLTRhZmEtODdmNS01ZjBjNTcxYjQ1ODEiLCJnbG9iYWxfc2Vzc2lvbl9pZCI6IjE4Y2I0NjAxYTg3ODRmMDFhM2I4Njc4ZWRlMGY0YjZkIiwic2lkIjoiMThjYjQ2MDFhODc4NGYwMWEzYjg2NzhlZGUwZjRiNmQiLCJqdGkiOiI1NzdEQjUyQjk2OTlDQjUyOTY2QjRFQjA0NDkyRkE3RCIsImF1dGhlbnRpY2F0aW9uX2V2ZW50X2lkIjoiZDJkMDExNDUtMTk1Mi00OTI0LWEwY2MtOTUzYjU2YWZiZmQ4Iiwic2NvcGUiOlsiZW1haWwiLCJwcm9maWxlIiwib3BlbmlkIiwiYWNjb3VudGluZy5yZXBvcnRzLnJlYWQiLCJhY2NvdW50aW5nLnNldHRpbmdzIiwiYWNjb3VudGluZy5hdHRhY2htZW50cyIsImFjY291bnRpbmcudHJhbnNhY3Rpb25zIiwiYWNjb3VudGluZy5qb3VybmFscy5yZWFkIiwiYWNjb3VudGluZy5jb250YWN0cyIsIm9mZmxpbmVfYWNjZXNzIl0sImFtciI6WyJwd2QiXX0.aoFn4FT3Hg-tOwrPfnsQUppfO_QCk_vmcHlKTu25z3UsQ8kjRlcaigOl5CPM3G4S_UHWKAZK8cusK1Qq-80C1bX9ZRRZTEZD8WULTNm_3GkUtc7_m3FNZrxmpqEs6bmDTOodxqi9pTlIrMCEBcQjVFX22stgk8Th3aVinBv3w6xvfaWWZbkV-yV-LGgZrtQqT-w2pvTMHCFmmHJ-PmCRb_HtqoZTVwFZcRyF2xPEN3hcIQWB9sp2iQyCCVxJNo7kmM6ffl4FVo668aQOdRM6nG8YYU5h8FdMUczZGc7CRv8aEzibOOD5gZ3Whr_PZ8exBRdVKizhDGg3ZS6Vo2n15Q',
//   expires_at: 1745995341,
//   token_type: 'Bearer',
//   refresh_token: '2qcxgHr3_LLXR9mw3kMC92vFQH7zAyZjH7l0_TKakTk',
//   scope: 'openid profile email accounting.settings accounting.reports.read accounting.journals.read accounting.contacts accounting.attachments accounting.transactions offline_access'
// }

export const getXeroContacts = async (req: Request, res: Response) => {
  if (req.session.xeroActiveTenants == undefined) {
    console.log(error);
    return res
      .status(400)
      .json({ error: 'Tenant ID is missing check your xero connection please activate your xero account' });
  }

  const activeTenants: any = req.session.xeroActiveTenants.tenantId;

  try {
    const contacts = await xero.accountingApi.getContacts(activeTenants);
    const contactData: any = contacts.body.contacts;
    const reduceConctacts = contactData
      ?.filter((contact: any) => contact.isSupplier == true)
      .map((contact: any) => {
        return {
          contactID: contact.contactID,
          name: contact.name,
        };
      });
    return res.status(200).json(reduceConctacts);
  } catch (error) {
    console.log(error);
    return res.status(400).json({ Message: 'check your xero auth' });
  }
};

export const checkRefreshToken = async (req: Request, res: Response) => {
  const userId = req.session.userid;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (!user.updateRefershToken) {
      return res.status(200).json({ token: null });
    }
    const lastRefreshToken: any = new Date(user.updateRefershToken || new Date());

    const tokenStatus = lastRefreshToken >= new Date();

    return res.status(200).json({ token: true, lastRefreshToken });
  } catch (error) {
    return res.status(400).json({ token: false });
  }
};

export const checkAndRefreshAccessToken = async (req: Request, res: Response, next: Function) => {
  try {
    const userId = req.session.userid;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: {
          select: {
            xeroTokenSet: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const refreshTokenUser = user?.xeroRefreshToken;
    const tokenSet: TokenSet = (user.admin?.xeroTokenSet as TokenSet) || null;

    if (!tokenSet) return res.status(404).json({ message: 'You are not connected to Xero' });

    xero.setTokenSet(tokenSet);

    if (dayjs(tokenSet.expires_at).isAfter(dayjs(), 'date')) {
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

    // if (!req.session.xeroTokenSet) {
    //   const tokenSet: TokenSet = await xero.refreshWithRefreshToken(client_id, client_secret, refreshTokenUser);
    //   await xero.updateTenants();

    //   const newTokenSet = xero.readTokenSet();
    //   const decodedAccessTokenRef = jwt.decode(tokenSet.access_token as any);
    //   const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);

    //   req.session.xeroTokenid = decodedIdToken;
    //   req.session.xeroToken = decodedAccessTokenRef;
    //   req.session.xeroTokenSet = tokenSet;
    //   req.session.xeroTenants = xero.tenants;
    //   req.session.xeroActiveTenants = xero.tenants[0];

    //   await prisma.user.update({
    //     where: {
    //       id: req.session.userid,
    //     },
    //     data: {
    //       xeroRefreshToken: tokenSet.refresh_token,
    //     },
    //   });
    // }
    // const decodedAccessToken = jwt.decode(req.session.xeroTokenSet.access_token) as any;

    // const currentTime = Math.floor(Date.now() / 1000);

    // if (decodedAccessToken) {
    //   const tokenSet: TokenSet = await xero.refreshWithRefreshToken(client_id, client_secret, refreshTokenUser);
    //   await xero.updateTenants();

    //   const newTokenSet = xero.readTokenSet();
    //   const decodedAccessTokenRef = jwt.decode(tokenSet.access_token as any);
    //   const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);

    //   req.session.xeroTokenid = decodedIdToken;
    //   req.session.xeroToken = decodedAccessTokenRef;
    //   req.session.xeroTokenSet = tokenSet;
    //   req.session.xeroTenants = xero.tenants;
    //   req.session.xeroActiveTenants = xero.tenants[0];

    //   await prisma.user.update({
    //     where: {
    //       id: req.session.userid,
    //     },
    //     data: {
    //       xeroRefreshToken: tokenSet.refresh_token,
    //     },
    //   });
    // }

    next();
  } catch (err) {
    console.error('Error checking and refreshing token:', err);
    res.status(500).json({ error: 'Failed to check and refresh token' });
  }
};

export const createXeroInvoice = async (req: Request, res: Response) => {
  const { contactId, lineItems, invoiceType, dueDate, reference } = req.body;

  if (!contactId || !lineItems || !invoiceType || !dueDate || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const contact: Contact = { contactID: contactId };

  const lineItemsArray: LineItem[] = lineItems.map((item: any) => ({
    description: item.description,
    quantity: item.quantity,
    unitAmount: item.unitAmount,
    accountCode: item.accountCode,
  }));

  const invoice: Invoice = {
    type: invoiceType, // e.g., 'ACCREC' for Accounts Receivable
    contact: contact,
    dueDate: dueDate,
    lineItems: lineItemsArray,
    reference: reference,
    status: 'AUTHORISED' as any,
  };

  const response = await xero.accountingApi.createInvoices(xero.tenants[0].tenantId, { invoices: [invoice] });
};

export const createXeroContact = async (bankInfo: any, creator: any, user: any, invoiceFrom: any) => {
  if (Object.keys(bankInfo).length == 0) {
    throw new Error('bank information not found');
  }

  const contact: Contact = {
    name: invoiceFrom.name,
    emailAddress: invoiceFrom.email,
    phones: [{ phoneType: Phone.PhoneTypeEnum.MOBILE, phoneNumber: invoiceFrom.phoneNumber }],
    addresses: [
      {
        addressLine1: creator.address,
      },
    ],
    bankAccountDetails: bankInfo.accountNumber,
  };

  try {
    const response = await xero.accountingApi.createContacts(xero.tenants[0].tenantId, { contacts: [contact] });
    return response.body.contacts;
  } catch (error) {
    return error;
  }
};

export const createXeroInvoiceLocal = async (
  contactId: string,
  lineItems: any,
  dueDate: any,
  campaignName: string,
  invoiceNumber: string,
) => {
  try {
    const contact: Contact = { contactID: contactId };

    const where = 'Status=="ACTIVE"';

    const accounts: any = await xero.accountingApi.getAccounts(xero.tenants[0].tenantId, undefined, where);

    const lineItemsArray: LineItem[] = lineItems.map((item: any) => ({
      accountID: accounts.body.accounts[0].accountID,
      accountCode: '50930',
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.total,
      taxType: 'NONE',
    }));

    const invoice: Invoice = {
      type: 'ACCPAY' as any,
      contact: contact,
      dueDate: dueDate,
      lineItems: lineItemsArray,
      status: 'AUTHORISED' as any,
      invoiceNumber: invoiceNumber || 'N/A',
      reference: campaignName || 'N/A',
    };

    const response: any = await xero.accountingApi.createInvoices(xero.tenants[0].tenantId, { invoices: [invoice] });
    return response;
  } catch (error) {
    throw new Error(error);
  }
};

export const creatorInvoice = async (req: Request, res: Response) => {
  const { invoiceId } = req.params;

  try {
    const invoice = await prisma.invoice.findUnique({
      where: {
        id: invoiceId,
      },
      include: {
        campaign: true,
      },
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });

    return res.status(200).json(invoice);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const attachInvoicePDF = async (tenantId: string, invoiceId: string, fileName: string, filePath: string) => {
  try {
    const fileStream = fs.createReadStream(filePath);

    const data = await xero.accountingApi.createInvoiceAttachmentByFileName(
      tenantId,
      invoiceId,
      fileName,
      fileStream,
      true,
    );

    return data;
  } catch (error) {
    throw new Error(error);
  }
};

export const generateInvoice = async (req: Request, res: Response) => {
  const { userId, campaignId } = req.body;

  try {
    const creator = await prisma.shortListedCreator.findFirst({
      where: {
        campaignId: campaignId,
        userId: userId,
      },
      select: {
        campaign: {
          select: {
            id: true,
            campaignBrief: true,
            name: true,
          },
        },
        isCampaignDone: true,
        user: {
          select: {
            paymentForm: true,
            id: true,
            name: true,
            email: true,
            creatorAgreement: true,
            creator: true,
          },
        },
      },
    });

    if (!creator) return res.status(404).json({ message: 'Data not found' });

    const invoice = await prisma.invoice.findFirst({
      where: {
        campaignId: campaignId,
        creatorId: userId,
      },
    });

    if (invoice) return res.status(400).json({ message: 'Invoice has been generated for this campaign' });

    if (!creator.isCampaignDone && !invoice) {
      const invoiceAmount = creator?.user?.creatorAgreement.find(
        (elem) => elem.campaignId === creator.campaign.id,
      )?.amount;

      const invoice = await createInvoiceService(
        { ...creator, userId: creator.user?.id, campaignId: creator.campaign.id },
        req.session.userid,
        invoiceAmount,
      );

      await prisma.shortListedCreator.update({
        where: {
          userId_campaignId: {
            userId: creator?.user?.id as string,
            campaignId: creator.campaign.id as string,
          },
        },
        data: {
          isCampaignDone: true,
        },
      });

      // await decreamentCreditCampiagn(campaignId);
      // await decreamentCreditCampiagn(campaignId);
      const images: any = creator.campaign.campaignBrief?.images;

      emailCreatorInvoice(
        creator?.user?.email as any,
        creator.campaign.name,
        creator?.user?.name ?? 'Creator',
        images[0],
      );

      const adminId = req.session.userid;
      if (adminId) {
        const adminLogMessage = `Generated Invoice for - "${creator.user?.name}" `;
        logAdminChange(adminLogMessage, adminId, req);
      }

      const { title, message } = notificationInvoiceGenerate(creator.campaign.name);

      await saveNotification({
        userId: creator.user?.id as any,
        title,
        message,
        invoiceId: invoice?.id,
        entity: 'Invoice',
        entityId: creator.campaign.id,
      });
      return res.status(200).json({ message: 'Invoice has been successfully generated.' });
    }
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const deleteInvoice = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: id } });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    await prisma.invoice.delete({ where: { id: id } });

    return res.status(200).json({ message: 'Successfully deleted' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

const getContactFromXero = async (contactName: string) => {
  try {
    const res = await xero.accountingApi.getContacts(xero.tenants[0].tenantId, undefined, `Name=="${contactName}"`);

    if (res.body.contacts?.length) {
      return res?.body?.contacts[0].contactID;
    }

    return null;
  } catch (error) {
    throw new Error(error);
  }
};
