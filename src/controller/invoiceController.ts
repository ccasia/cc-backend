import { Request, Response } from 'express';

import { InvoiceStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    });
    res.status(200).json(invoice);
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
    });
    res.status(200).json(invoice);
  } catch (error) {
    //console.log(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};
// create delete function

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
