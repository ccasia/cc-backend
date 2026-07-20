import { Request, Response } from 'express';
import dayjs from 'dayjs';
import {
  getFinanceInvoices,
  getNewPackageClients,
  FinanceInvoiceStatus,
  getFinanceDashboardData,
  getClientCampaignBreakdown,
} from '@services/financeService';

export const getFinanceDashboard = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;

  const start = startDate ? dayjs(startDate as string) : dayjs().startOf('month');
  const end = endDate ? dayjs(endDate as string) : dayjs().endOf('month');

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({ success: false, message: 'Invalid startDate or endDate' });
  }

  try {
    const data = await getFinanceDashboardData(start.toDate(), end.toDate());
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching finance dashboard:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch finance dashboard' });
  }
};

export const getClientCampaignBreakdownController = async (req: Request, res: Response) => {
  const { companyId } = req.params;

  try {
    const data = await getClientCampaignBreakdown(companyId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching client campaign breakdown:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch campaign breakdown' });
  }
};

export const getFinanceInvoicesController = async (req: Request, res: Response) => {
  const { status, startDate, endDate } = req.query;

  if (!['draft', 'processing', 'overdue'].includes(status as string)) {
    return res.status(400).json({ success: false, message: 'Invalid invoice status' });
  }

  const start = startDate ? dayjs(startDate as string) : dayjs().startOf('month');
  const end = endDate ? dayjs(endDate as string) : dayjs().endOf('month');

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({ success: false, message: 'Invalid startDate or endDate' });
  }

  try {
    const data = await getFinanceInvoices(status as FinanceInvoiceStatus, start.toDate(), end.toDate());
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching finance invoices:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch finance invoices' });
  }
};

export const getNewPackageClientsController = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;

  const start = startDate ? dayjs(startDate as string) : dayjs().startOf('month');
  const end = endDate ? dayjs(endDate as string) : dayjs().endOf('month');

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({ success: false, message: 'Invalid startDate or endDate' });
  }

  try {
    const data = await getNewPackageClients(start.toDate(), end.toDate());
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching new package clients:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch new package clients' });
  }
};
