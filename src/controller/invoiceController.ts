import axios from 'axios';

import { XeroClient, Contact, LineItem, Invoice, Phone } from 'xero-node';
import jwt, { Secret } from 'jsonwebtoken';

import { Request, Response } from 'express';

import { creatorInvoice as emailCreatorInvoice } from '@configs/nodemailer.config';
import { logAdminChange } from '@services/campaignServices';
import { logChange } from '@services/campaignServices';

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
import {
  createInvoiceService,
  generateUniqueInvoiceNumber,
  rejectInvoice,
  sendToSpreadSheet,
} from '@services/invoiceService';
import dayjs from 'dayjs';
import { getCreatorInvoiceLists } from '@services/submissionService';
import { missingInvoices } from '@constants/missing-invoices';
import { creatorAgreements } from './campaignController';
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

// invoice item type definition
interface InvoiceItem {
  service: string;
  description?: string;
  currency?: string;
  currencySymbol?: string;
  [key: string]: any; // Allow other properties
}

// invoice type definition
interface invoiceData {
  invoiceId: string;
  invoiceNumber: string;
  createDate: Date;
  dueDate: Date;
  status: InvoiceStatus;
  invoiceFrom: any;
  invoiceTo: object;
  items: InvoiceItem[];
  totalAmount: number;
  subTotal?: number;
  bankInfo: object;
  createdBy: string;
  campaignId: string;
  currency?: string;
  currencySymbol?: string;
  xeroContactId?: string;
  newContact?: boolean;
  otherReason?: string;
  reason?: string;
}

export const getXero = async (req: Request, res: Response) => {
  try {
    const consentUrl = await xero.buildConsentUrl();

    return res.status(200).json({ url: consentUrl });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate consent URL' });
  }
};

export const xeroCallBack = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userid,
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const tokenSet: TokenSet = await xero.apiCallback(req.url);

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
            creatorAgreement: true,
          },
        },
        campaign: {
          include: {
            creatorAgreement: true,
          },
        },
      },
    });

    // Map through invoices to include the specific creator agreement with currency
    const invoicesWithCurrency = invoices.map((invoice) => {
      const creatorAgreement = invoice.campaign?.creatorAgreement?.find(
        (agreement) => agreement.campaignId === invoice.campaignId && agreement.userId === invoice.creatorId,
      );

      return {
        ...invoice,
        currency: creatorAgreement?.currency || null,
      };
    });

    return res.status(200).json(invoicesWithCurrency);
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
            creatorAgreement: {
              where: {
                userId: userid,
              },
            },
          },
        },
        user: true,
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
        campaign: {
          include: {
            subscription: true,
            creatorAgreement: true,
          },
        },
        user: true,
      },
    });

    // Map through invoices to include the specific creator agreement with currency
    const invoicesWithCurrency = invoices.map((invoice) => {
      const creatorAgreement = invoice.campaign?.creatorAgreement?.find(
        (agreement) => agreement.campaignId === invoice.campaignId && agreement.userId === invoice.creatorId,
      );

      return {
        ...invoice,
        currency: creatorAgreement?.currency || null,
      };
    });

    res.status(200).json(invoicesWithCurrency);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// get single invoice by id
export const getInvoiceById = async (req: Request, res: Response) => {
  const { id } = req.params;

  const invoiceCreatorId = await prisma.invoice.findUnique({
    where: {
      id: id,
    },
    select: {
      creatorId: true,
    },
  });

  const creatorId = invoiceCreatorId?.creatorId;

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
            creatorAgreement: { where: { userId: creatorId } },
          },
        },
        user: {
          include: {
            creatorAgreement: true,
          },
        },
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
    subTotal,
    campaignId,
    bankInfo,
    currency,
    currencySymbol,
  }: invoiceData = req.body;

  // Process the first item in the items array
  let item: InvoiceItem = items[0];

  // Handle 'Others' service type with custom description
  if (item.service === 'Others' && item.description) {
    // Update the service field to include the custom description
    item = {
      ...item,
      service: `Others: ${item.description}`,
      // Keep the original description field as well
      description: item.description,
    };
  }

  // Add currency information to the item if provided
  if (currency) {
    item = {
      ...item,
      currency,
      currencySymbol,
    };
  }

  const creatorIdInfo = invoiceFrom.id;

  try {
    // Store the invoice with the currency information embedded in the task object
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        createdAt: createDate,
        dueDate,
        status: status as InvoiceStatus,
        invoiceFrom: invoiceFrom,
        invoiceTo: invoiceTo,
        task: item, // The currency info is already included in the item object
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

  const userId = req.session.userid;

  try {
    const invoice = await prisma.$transaction(
      async (tx) => {
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
                user: { select: { id: true, name: true, paymentForm: true, creatorAgreement: true, email: true } },
              },
            },
            user: {
              include: {
                creatorAgreement: {
                  where: { campaignId: campaignId },
                },
              },
            },
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
        const agreement = updatedInvoice.creator.user.creatorAgreement.find((item) => item.campaignId === campaignId);

        console.log('AGREEMENT:', agreement);

        let contactID = updatedInvoice.creator.xeroContactId;

        if (status === 'approved') {
          const user = await tx.user.findUnique({
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

          console.log('TENANTS:', xero.tenants);

          const activeTenant = xero.tenants.find(
            (item) =>
              item?.orgData.baseCurrency.toUpperCase() ===
              ((agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR'),
          );

          console.log('ACTIVE UPDATE:', activeTenant);
          console.log('CREATOR NAME:', creatorUser.name?.trim());

          const result = await xero.accountingApi.getContacts(
            activeTenant.tenantId,
            undefined, // IDs
            // `EmailAddress=="${creatorUser.email}"`,
            // `EmailAddress=="${creatorUser.email}" || Name=="${creatorUser.name}"`,
            `Name=="${invoiceFrom.name?.trim()}"`,
          );

          if (result.body.contacts && result.body.contacts.length > 0) {
            contactID = result.body.contacts[0].contactID || null;
          } else {
            const [contact] = await createXeroContact(
              bankInfo,
              updatedInvoice.creator,
              invoiceFrom,
              (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
            );

            contactID = contact.contactID || null;

            await tx.creator.update({
              where: { id: updatedInvoice.creator.id },
              data: { xeroContactId: contactID },
            });
          }

          if (contactID) {
            await createXeroInvoiceLocal(
              contactID,
              items,
              dueDate,
              campaign.name,
              updatedInvoice.invoiceNumber,
              updatedInvoice.user?.email!,
              invoiceFrom,
              updatedInvoice.creator,
              bankInfo,
              (agreement?.currency?.toUpperCase() as 'MYR' | 'SGD') ?? 'MYR',
            );
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

          // Log invoice approval in campaign logs for Invoice Actions tab
          if (adminId && updatedInvoice.campaignId) {
            const creatorName = creatorUser?.name || 'Unknown Creator';
            const logMessage = `Approved invoice ${updatedInvoice.invoiceNumber} for ${creatorName}`;
            await logChange(logMessage, updatedInvoice.campaignId, req);
          }

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
      },
      {
        timeout: 10000,
      },
    );

    return res.status(200).json(invoice);
  } catch (error) {
    console.error('asdsads', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(400).json({ error: message });
  }
};

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
      include: {
        admin: {
          select: {
            xeroTokenSet: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (!user.admin?.xeroTokenSet) {
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

    const tokenSet: TokenSet = (user.admin?.xeroTokenSet as TokenSet) || null;

    if (!tokenSet) return res.status(404).json({ message: 'You are not connected to Xero' });

    await xero.initialize();

    xero.setTokenSet(tokenSet);

    if (dayjs(tokenSet.expires_at).isBefore(dayjs())) {
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

    // if (!req.session.xeroTokenSet) {
    //   const tokenSet: TokenSet = await xero.refreshWithRefreshToken(client_id, client_secret, refreshTokenUser);
    // await xero.updateTenants();

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

export const createXeroContact = async (
  bankInfo: any,
  creator: any,
  invoiceFrom: any,
  currency?: 'SGD' | 'MYR',
): Promise<Contact[]> => {
  if (Object.keys(bankInfo).length == 0) {
    throw new Error('bank information not found');
  }

  let activeTenant;

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
    await xero.updateTenants();

    console.log('TENANTS', xero.tenants);
    console.log('CURRENCY', currency);

    activeTenant = xero.tenants.find((item) => item?.orgData.baseCurrency.toUpperCase() === currency);

    console.log('SELECTED TENANT', activeTenant);

    const response = await xero.accountingApi.createContacts(activeTenant.tenantId, { contacts: [contact] });

    return response.body.contacts || [];
  } catch (error) {
    console.log('SADSAD', error);
    throw new Error(error);
    // throw new Error(error);
  }
};

export const createXeroInvoiceLocal = async (
  contactId: string,
  lineItems: any,
  dueDate: any,
  campaignName: string,
  invoiceNumber: string,
  creatorEmail: string,
  invoiceFrom: any,
  creator: any,
  bankInfo: any,
  currency?: 'SGD' | 'MYR',
) => {
  let activeTenant;

  try {
    // await xero.updateTenants();

    // let contact: Contact = { contactID: contactId };

    const where = 'Status=="ACTIVE"';

    if (currency) {
      activeTenant = xero.tenants.find((item) => item?.orgData.baseCurrency.toUpperCase() === currency);
    }

    // const result = await xero.accountingApi.getContacts(
    //   activeTenant.tenantId,
    //   undefined, // IDs
    //   `EmailAddress=="${creatorEmail}"`,
    // );

    // if (result.body.contacts && result.body.contacts.length > 0) {
    //   contact = { contactID: result.body.contacts[0].contactID };
    // } else {
    //   const contactInfo: Contact = {
    //     name: invoiceFrom.name,
    //     emailAddress: invoiceFrom.email,
    //     phones: [{ phoneType: Phone.PhoneTypeEnum.MOBILE, phoneNumber: invoiceFrom.phoneNumber }],
    //     addresses: [
    //       {
    //         addressLine1: creator.address,
    //       },
    //     ],
    //     bankAccountDetails: bankInfo.accountNumber,
    //   };

    //   const response = await xero.accountingApi.createContacts(activeTenant.tenantId, { contacts: [contactInfo] });

    //   contact = { contactID: (response.body as any).contacts[0].contactID };
    // }

    const accounts: any = await xero.accountingApi.getAccounts(activeTenant.tenantId, undefined, where);

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
      contact: { contactID: contactId as any },
      dueDate: dueDate,
      lineItems: lineItemsArray,
      status: 'AUTHORISED' as any,
      invoiceNumber: invoiceNumber || 'N/A',
      reference: campaignName || 'N/A',
    };

    const response: any = await xero.accountingApi.createInvoices(activeTenant.tenantId, { invoices: [invoice] });
    return response;
  } catch (error) {
    console.log('Testing', error);
    throw new Error(error);
  }
};

export const creatorInvoice = async (req: Request, res: Response) => {
  const { invoiceId } = req.params;

  try {
    // First get the invoice to find the campaignId
    const invoiceDetail = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { campaignId: true, creatorId: true },
    });

    if (!invoiceDetail) return res.status(404).json({ message: 'Invoice not found.' });

    const invoice = await prisma.invoice.findUnique({
      where: {
        id: invoiceId,
      },
      include: {
        campaign: {
          include: {
            subscription: true,
            creatorAgreement: {
              where: {
                campaignId: invoiceDetail.campaignId,
                userId: invoiceDetail.creatorId,
              },
            },
          },
        },
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
        undefined,
        undefined,
        req.session.userid,
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
  const adminId = req.session.userid;

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: id },
      include: {
        creator: {
          include: {
            user: true,
          },
        },
        campaign: true,
      },
    });

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // Get creator name for logging
    const creatorName = invoice.creator?.user?.name || 'Unknown Creator';
    const campaignName = invoice.campaign?.name || 'Campaign';

    await prisma.invoice.delete({ where: { id: id } });

    // Log the deletion in campaign logs
    if (adminId && invoice.campaignId) {
      const logMessage = `Deleted invoice ${invoice.invoiceNumber} for creator "${creatorName}"`;
      await logChange(logMessage, invoice.campaignId, req);
    }

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

export const disconnectXeroIntegration = async (req: Request, res: Response) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: {
        userId: req.session.userid,
      },
    });

    if (!admin) return res.status(404).json({ message: 'User not found' });

    const tokenSet = (admin.xeroTokenSet as TokenSet) || '';

    // console.log(tokenSet.refresh_token);

    // Set current token set from DB/session
    xero.setTokenSet(tokenSet);

    // Call the revoke token endpoint
    // await xero.revokeToken();

    await prisma.admin.update({
      where: {
        id: admin.id,
      },
      data: {
        xeroTokenSet: '',
      },
    });

    return res.status(200).json({ success: true, message: 'Disconnected from Xero successfully.' });
  } catch (error) {
    console.error('❌ Failed to disconnect Xero integration:', error);
    return res.status(400).json({ success: false, message: 'Failed to disconnect from Xero' });
  }
};

export async function generateMissingInvoices(req: Request, res: Response) {
  const invoiceTo = {
    id: '1',
    name: 'Cult Creative',
    fullAddress: '5-3A, Block A, Jaya One, No.72A, Jalan Universiti,46200 Petaling Jaya, Selangor',
    phoneNumber: '+60 11-5415 5751',
    company: 'Cult Creative',
    addressType: 'Hq',
    email: 'support@cultcreative.asia',
    primary: true,
  };

  try {
    for (const item of missingInvoices) {
      const invoiceNumber = await generateUniqueInvoiceNumber();
      const agreement = await prisma.creatorAgreement.findFirst({
        where: {
          userId: item.userId,
          campaignId: item.campaignId,
        },
        include: {
          user: {
            include: {
              creator: true,
              paymentForm: true,
            },
          },
        },
      });

      console.log(agreement);

      const items = {
        title: 'Posting on social media',
        description: 'Posting on social media',
        service: 'Posting on social media',
        quantity: 1,
        price: agreement?.amount,
        total: agreement?.amount,
      };

      const invoiceFrom = {
        id: agreement?.user.id,
        name: agreement?.user.name,
        phoneNumber: agreement?.user.phoneNumber,
        email: agreement?.user.email,
        fullAddress: agreement?.user.creator?.address,
        company: agreement?.user.creator?.employment,
        addressType: 'Home',
        primary: false,
      };

      const bankInfo = {
        bankName: agreement?.user.paymentForm?.bankName,
        accountName: agreement?.user.paymentForm?.bankAccountName,
        payTo: agreement?.user.name,
        accountNumber: agreement?.user.paymentForm?.bankAccountNumber,
        accountEmail: agreement?.user.email,
      };

      const firstDraftType = await prisma.submissionType.findFirst({
        where: {
          type: 'FIRST_DRAFT',
        },
      });

      const finalDraftType = await prisma.submissionType.findFirst({
        where: {
          type: 'FINAL_DRAFT',
        },
      });

      const firstDraftSubmission = await prisma.submission.findFirst({
        where: {
          userId: agreement?.userId,
          campaignId: agreement?.campaignId,
          submissionTypeId: firstDraftType?.id,
        },
      });

      const invoiceItems = await getCreatorInvoiceLists(firstDraftSubmission?.id!);

      await prisma.invoice.create({
        data: {
          invoiceNumber: invoiceNumber,
          createdAt: new Date(),
          dueDate: new Date(dayjs().add(28, 'day').format()),
          status: 'draft' as InvoiceStatus,
          invoiceFrom: invoiceFrom,
          invoiceTo,
          task: items,
          amount: parseFloat(agreement?.amount!) || 0,
          bankAcc: bankInfo,
          user: {
            connect: {
              id: agreement?.userId,
            },
          },
          creator: {
            connect: {
              userId: agreement?.userId,
            },
          },
          ...(invoiceItems?.length && {
            deliverables: invoiceItems,
          }),
          campaign: {
            connect: { id: item.campaignId },
          },
        },
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(400);
  }
}
