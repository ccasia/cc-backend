import axios from 'axios';

import { XeroClient, Contact, LineItem, Invoice, Phone } from 'xero-node';
import jwt, { Secret } from 'jsonwebtoken';

import { Request, Response } from 'express';

import { InvoiceStatus, PrismaClient } from '@prisma/client';
import { notificationInvoiceStatus, notificationInvoiceUpdate } from '@helper/notification';
import { saveNotification } from './notificationController';
import { clients, io } from '../server';

import { TokenSet } from 'openid-client';
import { error } from 'console';

const prisma = new PrismaClient();

const client_id: string = process.env.XeroCLientID as string;
const client_secret: string = process.env.XeroClientSecret as string;
const redirectUrl: string = process.env.XeroRedirectUrl as string;
const scopes: string = process.env.XeroScopes as string;

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes?.split(' '),
});

export const getAllInvoices = async (req: Request, res: Response) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: {
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
  console.log(userid);
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
        creator: true,
        campaign: true,
        user: true,
      },
    });
    res.status(200).json(invoice);
  } catch (error) {
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// get invoice by creator id and campaign id
export const getInvoiceByCreatorIdAndCampaignId = async (req: Request, res: Response) => {
  const { creatorId, campaignId } = req.params;
  //console.log(req.params);
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        creatorId: creatorId,
        campaignId: campaignId,
      },
    });
    res.status(200).json(invoice);
  } catch (error) {
    //console.log(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

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
}

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
  const creator = await prisma.creator.findMany();

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
        createdBy: userid as string,
      },
    });
    res.status(201).json(invoice);
  } catch (error) {
    //console.log(error);
    res.status(500).json({ error: 'Something went wrong' });
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
          include: { campaignAdmin: true },
        },
        user: true,
      },
    });
    res.status(200).json(invoice);

    const { title, message } = notificationInvoiceStatus(invoice.campaign.name);

    // Notify Finance Admins and Creator
    for (const admin of invoice.campaign.campaignAdmin) {
      const notification = await saveNotification({
        userId: admin.adminId && invoice.user.id,
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

export const updateInvoice = async (req: Request, res: Response) => {
  //console.log(req.body);
  const { invoiceId, dueDate, status, invoiceFrom, invoiceTo, items, totalAmount, campaignId, bankInfo }: invoiceData =
    req.body;

  try {
    const invoice = await prisma.invoice.update({
      where: {
        id: invoiceId,
      },
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
        creator: true,
        user: true,
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    let contactID: any;

    if (invoice.creator.xeroContactId) {
      contactID = invoice.creator.xeroContactId;
      await createXeroInvoiceLocal(contactID, items, dueDate, req.body.contactId.type);
    }

    if (status == 'approved' && Object.keys(req.body.contactId).length != 0) {
      await createXeroInvoiceLocal(
        req.body.contactId.contact.contactID,
        items,
        dueDate,

        req.body.contactId.type,
      );
      contactID = req.body.contactId.contact.contactID;
    }

    if (status == 'approved' && req.body.newContact == true) {
      const contact: any = await createXeroContact(bankInfo, invoice.creator, invoice.user, invoiceFrom);
      contactID = contact[0].contactID;
      await createXeroInvoiceLocal(contactID, items, dueDate, req.body.contactId.type);
    }

    await prisma.creator.update({
      where: {
        id: invoice.creator.id,
      },
      data: {
        xeroContactId: contactID,
      },
    });
    res.status(200).json(invoice);

    const { title, message } = notificationInvoiceUpdate(invoice.campaign.name);

    for (const admin of invoice.campaign.campaignAdmin) {
      if (admin.admin.role?.name === 'CSM') {
        try {
          const notification = await saveNotification({
            userId: admin.adminId,
            title,
            message,
            entity: 'Invoice',
            threadId: invoice.id,
            // invoiceId: invoice.id,
            entityId: invoice.campaignId,
          });
          //  console.log("Sending notification to admin:", admin.adminId, notification);
          io.to(clients.get(admin.adminId)).emit('notification', notification);
        } catch (error) {
          console.error('Error notifying admin:', error);
        }
      }
    }

    try {
      const creatorNotification = await saveNotification({
        userId: invoice.creatorId,
        title,
        message,
        entity: 'Invoice',
        threadId: invoice.id,
        // invoiceId: invoice.id,
        entityId: invoice.campaignId,
      });
      //  console.log("Sending notification to creator:", invoice.creatorId, creatorNotification);
      io.to(clients.get(invoice.creatorId)).emit('notification', creatorNotification);
    } catch (error) {
      console.error('Error notifying creator:', error);
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

export const getXero = async (req: Request, res: Response) => {
  try {
    const consentUrl: string = await xero.buildConsentUrl();
    console.log('consentUrl', consentUrl);
    return res.status(200).json({ url: consentUrl });
    // res.redirect(consentUrl);
  } catch (err) {
    console.error('Error generating consent URL:', err);
    return res.status(500).json({ error: 'Failed to generate consent URL' });
  }
};

export const xeroCallBack = async (req: Request, res: Response) => {
  console.log(req);
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.session.userid,
      },
    });

    const tokenSet: TokenSet = await xero.apiCallback(req.url);
    await xero.updateTenants();

    const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);
    const decodedAccessToken: any = jwt.decode(tokenSet.access_token as any);

    req.session.xeroTokenid = decodedIdToken;
    req.session.xeroToken = decodedAccessToken;
    req.session.xeroTokenSet = tokenSet;
    req.session.xeroTenants = xero.tenants;
    req.session.xeroActiveTenants = xero.tenants[0];

    const today = new Date();
    const refreshExpiry = new Date(today);

    await prisma.user.update({
      where: {
        id: req.session.userid,
      },
      data: {
        xeroRefreshToken: tokenSet.refresh_token,
        updateRefershToken: new Date(refreshExpiry),
      },
    });

    return res.status(200).json({ token: decodedAccessToken || null }); // Send the token response back to the client
  } catch (err) {
    console.log(err);
    return res.status(400).json(error);
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
    });
    if (!user) {
      return res.status(400).json({ error: 'user not found' });
    }
    // const refreshTokenUser = user.xeroRefreshToken;

    if (!user.updateRefershToken) {
      return res.status(400).json({ error: 'not valid' });
    }
    const lastRefreshToken: any = new Date(user.updateRefershToken || new Date());

    const tokenStatus = lastRefreshToken >= new Date();

    return res.status(200).json({ tokenStatus: true, lastRefreshToken });
  } catch (error) {
    return res.status(400).json({ tokenStatus: false });
  }
};

export const checkAndRefreshAccessToken = async (req: Request, res: Response, next: Function) => {
  try {
    const userId = req.session.userid;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    const refreshTokenUser = user?.xeroRefreshToken;
    // if (!refreshTokenUser) {
    //   console.log(error)
    //   return res.status(400).json({ error: 'Not authenticated user for using xero' });
    // }

    console.log('refresh token exp :', refreshTokenUser);
    if (!req.session.xeroTokenSet) {
      const tokenSet: TokenSet = await xero.refreshWithRefreshToken(client_id, client_secret, refreshTokenUser);
      await xero.updateTenants();

      const newTokenSet = xero.readTokenSet();
      const decodedAccessTokenRef = jwt.decode(tokenSet.access_token as any);
      const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);

      req.session.xeroTokenid = decodedIdToken;
      req.session.xeroToken = decodedAccessTokenRef;
      req.session.xeroTokenSet = tokenSet;
      req.session.xeroTenants = xero.tenants;
      req.session.xeroActiveTenants = xero.tenants[0];

      await prisma.user.update({
        where: {
          id: req.session.userid,
        },
        data: {
          xeroRefreshToken: tokenSet.refresh_token,
        },
      });
    }
    const decodedAccessToken = jwt.decode(req.session.xeroTokenSet.access_token) as any;

    const currentTime = Math.floor(Date.now() / 1000);

    if (decodedAccessToken) {
      const tokenSet: TokenSet = await xero.refreshWithRefreshToken(client_id, client_secret, refreshTokenUser);
      await xero.updateTenants();

      const newTokenSet = xero.readTokenSet();
      const decodedAccessTokenRef = jwt.decode(tokenSet.access_token as any);
      const decodedIdToken: any = jwt.decode(tokenSet.id_token as any);

      req.session.xeroTokenid = decodedIdToken;
      req.session.xeroToken = decodedAccessTokenRef;
      req.session.xeroTokenSet = tokenSet;
      req.session.xeroTenants = xero.tenants;
      req.session.xeroActiveTenants = xero.tenants[0];

      await prisma.user.update({
        where: {
          id: req.session.userid,
        },
        data: {
          xeroRefreshToken: tokenSet.refresh_token,
        },
      });
    }

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

  const response = await xero.accountingApi.createContacts(xero.tenants[0].tenantId, { contacts: [contact] });

  return response.body.contacts;
};

export const createXeroInvoiceLocal = async (contactId: string, lineItems: any, dueDate: any, invoiceType: any) => {
  try {
    const contact: Contact = { contactID: contactId };
    const where = 'Status=="ACTIVE"';
    const accounts: any = await xero.accountingApi.getAccounts(xero.tenants[0].tenantId, undefined, where);
    console.log('accounts.body.accounts[0]', accounts.body.accounts[0]);
    const lineItemsArray: LineItem[] = lineItems.map((item: any) => ({
      accountID: accounts.body.accounts[0].accountID,
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.total,
      taxType: 'NONE',
    }));

    const invoice: Invoice = {
      type: 'ACCREC' as any,
      contact: contact,
      dueDate: dueDate,
      lineItems: lineItemsArray,
      status: 'AUTHORISED' as any,
    };

    const response = await xero.accountingApi.createInvoices(xero.tenants[0].tenantId, { invoices: [invoice] });
  } catch (error) {
    console.log(error);
  }
};
// create update function

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
