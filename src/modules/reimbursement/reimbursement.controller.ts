import { Request, Response } from 'express';
import { prisma } from '@/src/prisma/prisma';
import {
  ReimbursementError,
  addReceipt,
  deleteReceipt,
  getReimbursements,
  reviewReceipt,
  setReceiptRequired,
  submitReceipts,
  updateReceipt,
} from './reimbursement.service';
import { ReceiptFile, ReceiptInput, ReviewInput } from './reimbursement.types';

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof ReimbursementError) {
    return res.status(error.status).json({ message: error.message, ...error.details });
  }

  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback });
};

const parseReceiptBody = (req: Request): ReceiptInput => {
  const raw = req.body?.data;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return req.body ?? {};
};

const getReceiptFile = (req: Request): ReceiptFile | undefined => {
  const uploaded = (req.files as any)?.receipt;
  return Array.isArray(uploaded) ? uploaded[0] : uploaded;
};

export const getReimbursementsHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.query as { campaignId?: string; userId?: string };

  if (!campaignId) return res.status(400).json({ message: 'campaignId is required' });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });

    // Creators only ever see their own receipts; admins pick the creator via userId.
    const isStaff = user?.role === 'admin' || user?.role === 'superadmin';
    const userId = isStaff ? (req.query.userId as string | undefined) : req.userId;

    if (!userId) return res.status(400).json({ message: 'userId is required' });
    if (!isStaff && user?.role !== 'creator') return res.status(403).json({ message: 'Forbidden' });

    const rounds = await getReimbursements(campaignId, userId);
    return res.status(200).json(rounds);
  } catch (error) {
    return handleError(res, error, 'Error fetching reimbursements');
  }
};

export const setReceiptRequiredHandler = async (req: Request, res: Response) => {
  const { required, confirmRegenerate } = req.body as { required?: boolean; confirmRegenerate?: boolean };

  if (typeof required !== 'boolean') return res.status(400).json({ message: 'required must be a boolean' });

  try {
    const agreement = await setReceiptRequired(
      req.params.agreementId,
      required,
      req.userId as string,
      confirmRegenerate === true,
    );
    return res.status(200).json({
      message: required ? 'Receipt is now required' : 'Receipt is no longer required',
      isReceiptRequired: agreement.isReceiptRequired,
    });
  } catch (error) {
    return handleError(res, error, 'Error updating receipt requirement');
  }
};

export const addReceiptHandler = async (req: Request, res: Response) => {
  try {
    const receipt = await addReceipt(req.userId as string, parseReceiptBody(req), getReceiptFile(req));
    return res.status(201).json({ message: 'Receipt added', receipt });
  } catch (error) {
    return handleError(res, error, 'Error adding receipt');
  }
};

export const updateReceiptHandler = async (req: Request, res: Response) => {
  try {
    const receipt = await updateReceipt(
      req.userId as string,
      req.params.id,
      parseReceiptBody(req),
      getReceiptFile(req),
    );
    return res.status(200).json({ message: 'Receipt updated', receipt });
  } catch (error) {
    return handleError(res, error, 'Error updating receipt');
  }
};

export const deleteReceiptHandler = async (req: Request, res: Response) => {
  try {
    await deleteReceipt(req.userId as string, req.params.id);
    return res.status(200).json({ message: 'Receipt removed' });
  } catch (error) {
    return handleError(res, error, 'Error removing receipt');
  }
};

export const submitReceiptsHandler = async (req: Request, res: Response) => {
  try {
    await submitReceipts(req.userId as string, req.params.agreementId);
    return res.status(200).json({ message: 'Receipts submitted for review' });
  } catch (error) {
    return handleError(res, error, 'Error submitting receipts');
  }
};

export const reviewReceiptHandler = async (req: Request, res: Response) => {
  const input = req.body as ReviewInput;

  if (input?.action !== 'approve' && input?.action !== 'reject') {
    return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
  }

  try {
    const receipt = await reviewReceipt(req.userId as string, req.params.id, input);
    return res.status(200).json({
      message: input.action === 'approve' ? 'Receipt approved' : 'Receipt rejected',
      receipt,
    });
  } catch (error) {
    return handleError(res, error, 'Error reviewing receipt');
  }
};
