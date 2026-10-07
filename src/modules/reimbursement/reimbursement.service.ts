import { promises as fs } from 'fs';
import { Prisma, ReimbursementStatus } from '@prisma/client';
import { prisma } from '@/src/prisma/prisma';
import { clients, getIo } from '@configs/socket';
import { uploadAttachments, deleteGcsObjectByPublicUrl } from '@configs/cloudStorage.config';
import { saveNotification } from '@controllers/notificationController';
import { logChange } from '@services/campaignServices';
import { createInvoiceService } from '@services/invoiceService';
import { handleV4CompletedCampaign, isReimbursementReady } from '@services/submissionV4CompletionService';
import { ReceiptFile, ReceiptInput, ReviewInput } from './reimbursement.types';

export class ReimbursementError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

type DetectedReceiptType = { mimeType: string; ext: string };

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'];

/**
 * The file's real type from its leading bytes ("magic bytes"). The browser-sent mimetype is
 * client-controlled, so it's never trusted. Only formats a receipt can be are allowed —
 * notably not SVG, which can carry script and would be served publicly from storage.
 */
const detectReceiptType = async (tempFilePath: string): Promise<DetectedReceiptType | null> => {
  const handle = await fs.open(tempFilePath, 'r');
  const head = Buffer.alloc(16);
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }

  const ascii = (start: number, end: number) => head.toString('latin1', start, end);

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mimeType: 'image/webp', ext: 'webp' };
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.includes(ascii(8, 12))) return { mimeType: 'image/heic', ext: 'heic' };
  if (ascii(0, 5) === '%PDF-') return { mimeType: 'application/pdf', ext: 'pdf' };

  return null;
};

const agreementInclude = {
  reimbursementReceipts: { orderBy: { order: 'asc' as const } },
  campaign: { select: { id: true, name: true, submissionVersion: true } },
  user: { select: { id: true, name: true } },
};

const getAgreementOrThrow = async (agreementId: string) => {
  const agreement = await prisma.creatorAgreement.findUnique({
    where: { id: agreementId },
    include: agreementInclude,
  });

  if (!agreement) throw new ReimbursementError(404, 'Agreement not found');

  return agreement;
};

// The round's own invoice. A round can also have a REIMBURSEMENT invoice, which never counts here.
const getRoundInvoice = (campaignId: string, userId: string, round: number) =>
  prisma.invoice.findFirst({
    where: { campaignId, creatorId: userId, round, invoiceType: 'STANDARD' },
    select: { id: true, invoiceNumber: true, status: true, amount: true },
  });

// Once any receipt is on an invoice the batch is closed: no more edits, reviews or toggling.
const isBilled = (agreement: { reimbursementReceipts: { invoiceId: string | null }[] }) =>
  agreement.reimbursementReceipts.some((receipt) => Boolean(receipt.invoiceId));

const assertNotBilled = (agreement: { reimbursementReceipts: { invoiceId: string | null }[] }) => {
  if (isBilled(agreement)) {
    throw new ReimbursementError(400, 'The reimbursements for this agreement have already been invoiced');
  }
};

const parseAmount = (value: unknown) => {
  const amount = typeof value === 'string' ? parseFloat(value) : Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ReimbursementError(400, 'Amount must be a positive number');
  }

  return Math.round(amount * 100) / 100;
};

const parseDescription = (value: unknown) => {
  const description = typeof value === 'string' ? value.trim() : '';

  if (!description) throw new ReimbursementError(400, 'Description is required');

  return description;
};

// Returns the detected type, which is what gets stored — not the browser's claim.
const validateFile = async (file: ReceiptFile): Promise<DetectedReceiptType> => {
  if (file.size > MAX_RECEIPT_SIZE) {
    throw new ReimbursementError(400, 'Receipt must be 10MB or smaller');
  }

  const detected = await detectReceiptType(file.tempFilePath);

  if (!detected) {
    throw new ReimbursementError(400, 'Receipt must be a JPG, PNG, WebP, HEIC image or a PDF');
  }

  return detected;
};

const uploadReceiptFile = async (agreementId: string, file: ReceiptFile, detected: DetectedReceiptType) => {
  // Name the stored object by its real type, so e.g. a PNG uploaded as "x.svg" is never served as SVG
  const baseName = file.name.replace(/\.[^.]*$/, '').replace(/[^\w-]+/g, '_') || 'receipt';

  return uploadAttachments({
    tempFilePath: file.tempFilePath,
    fileName: `${agreementId}/${Date.now()}_${baseName}.${detected.ext}`,
    folderName: 'reimbursements',
  });
};

const deleteReceiptFile = async (fileUrl: string) => {
  try {
    await deleteGcsObjectByPublicUrl(fileUrl);
  } catch (error) {
    // A leftover object is harmless; never fail the request over it.
    console.error('Failed to delete reimbursement receipt file:', error);
  }
};

const emitUpdate = (campaignId: string, userId: string, round: number) => {
  const payload = { campaignId, userId, round };

  getIo().to(campaignId).emit('v4:reimbursement:updated', payload);

  const creatorSocketId = clients.get(userId);
  if (creatorSocketId) getIo().to(creatorSocketId).emit('v4:reimbursement:updated', payload);
};

const notifyUser = async (userId: string, campaignId: string, title: string, message: string) => {
  const notification = await saveNotification({
    userId,
    title,
    message,
    entity: 'Reimbursement',
    entityId: campaignId,
  });

  const socketId = clients.get(userId);
  if (socketId) getIo().to(socketId).emit('notification', notification);
};

const notifyCampaignAdmins = async (campaignId: string, title: string, message: string) => {
  const campaignAdmins = await prisma.campaignAdmin.findMany({
    where: { campaignId },
    select: { admin: { select: { userId: true, user: { select: { role: true } } } } },
  });

  const adminUserIds = campaignAdmins
    .filter(({ admin }) => admin.user.role === 'admin' || admin.user.role === 'superadmin')
    .map(({ admin }) => admin.userId);

  await Promise.all(adminUserIds.map((adminUserId) => notifyUser(adminUserId, campaignId, title, message)));
};

/**
 * Receipts were required only after the round's invoice had been sent, so that invoice is
 * left alone and the approved receipts are billed on their own REIMBURSEMENT invoice.
 */
const createReimbursementInvoice = async (agreementId: string, parentInvoiceId: string, adminId?: string) => {
  const agreement = await getAgreementOrThrow(agreementId);

  if (!agreement.isReceiptRequired || !isReimbursementReady(agreement)) return;

  const receipts = agreement.reimbursementReceipts.filter(
    (receipt) => receipt.status === 'APPROVED' && !receipt.invoiceId,
  );
  if (!receipts.length) return;

  const creator = await prisma.user.findUnique({
    where: { id: agreement.userId },
    include: { creator: true, paymentForm: true },
  });
  if (!creator) throw new Error('Creator user not found');

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await createInvoiceService(
      { user: creator, campaignId: agreement.campaignId, updatedAt: new Date(), round: agreement.round },
      agreement.userId,
      0,
      undefined,
      tx,
      // No adminId: it only makes createInvoiceService write a generic "generated" log line, and
      // this path writes its own "Reimbursement invoice … (related to INV-x)" line below.
      undefined,
      receipts.map((receipt) => ({
        receiptId: receipt.id,
        order: receipt.order,
        description: receipt.description,
        amount: receipt.amount,
        currency: receipt.currency,
        fileUrl: receipt.fileUrl,
      })),
      { invoiceType: 'REIMBURSEMENT', parentInvoiceId },
    );

    if (!created) throw new Error('Failed to create reimbursement invoice');

    // Claim the receipts. If a concurrent approval already billed them, roll this invoice back.
    const claimed = await tx.reimbursementReceipt.updateMany({
      where: { id: { in: receipts.map((receipt) => receipt.id) }, invoiceId: null },
      data: { invoiceId: created.id },
    });

    if (claimed.count !== receipts.length) throw new Error('Reimbursement receipts were already invoiced');

    return created;
  });

  const parent = await prisma.invoice.findUnique({ where: { id: parentInvoiceId }, select: { invoiceNumber: true } });

  await logChange(
    `Reimbursement invoice ${invoice.invoiceNumber} for ${agreement.user.name ?? 'creator'} was generated${
      parent ? ` (related to ${parent.invoiceNumber})` : ''
    }`,
    agreement.campaignId,
    undefined,
    adminId,
  );

  const notification = await saveNotification({
    userId: agreement.userId,
    title: '🧾 Reimbursement invoice ready',
    message: `Your reimbursement invoice for ${agreement.campaign.name} is ready inside`,
    entity: 'Invoice',
    invoiceId: invoice.id,
    entityId: agreement.campaignId,
  });

  const creatorSocketId = clients.get(agreement.userId);
  if (creatorSocketId) getIo().to(creatorSocketId).emit('notification', notification);

  getIo().to(agreement.campaignId).emit('v4:invoice:generated', {
    campaignId: agreement.campaignId,
    creatorId: agreement.userId,
    round: agreement.round,
    invoiceId: invoice.id,
    invoiceType: 'REIMBURSEMENT',
  });
};

/**
 * Bills the receipts once they're all approved. Before the round invoice exists this re-runs the
 * V4 completion, which only generates the invoice when the videos and receipts are both done;
 * after it exists the receipts go on a separate reimbursement invoice. Safe to call after any
 * receipt or toggle change.
 */
const releaseInvoiceIfReady = async (
  agreement: {
    id: string;
    campaignId: string;
    userId: string;
    round: number;
    campaign: { submissionVersion: string | null };
  },
  adminId?: string,
) => {
  if (agreement.campaign.submissionVersion !== 'v4') return;

  try {
    const roundInvoice = await getRoundInvoice(agreement.campaignId, agreement.userId, agreement.round);

    if (roundInvoice) {
      await createReimbursementInvoice(agreement.id, roundInvoice.id, adminId);
    } else {
      await handleV4CompletedCampaign(agreement.campaignId, agreement.userId, adminId, agreement.round);
    }
  } catch (error) {
    console.error('Failed to bill reimbursements after a reimbursement change:', error);
  }
};

// Keeps receipt order contiguous (1..n) so invoice lines are numbered without gaps.
const renumberReceipts = async (agreementId: string) => {
  const receipts = await prisma.reimbursementReceipt.findMany({
    where: { agreementId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true },
  });

  await prisma.$transaction(
    receipts
      .map((receipt, index) => ({ ...receipt, nextOrder: index + 1 }))
      .filter((receipt) => receipt.order !== receipt.nextOrder)
      .map((receipt) =>
        prisma.reimbursementReceipt.update({ where: { id: receipt.id }, data: { order: receipt.nextOrder } }),
      ),
  );
};

const assertCreatorCanEdit = async (agreement: Awaited<ReturnType<typeof getAgreementOrThrow>>, userId: string) => {
  if (agreement.userId !== userId) throw new ReimbursementError(403, 'Not your agreement');

  if (!agreement.isReceiptRequired) {
    throw new ReimbursementError(400, 'Receipts are not required for this agreement');
  }

  assertNotBilled(agreement);
};

const CHILD_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  amount: true,
  createdAt: true,
  dueDate: true,
  invoiceType: true,
  parentInvoiceId: true,
} as const;

/**
 * Invoice "family" for lists: a receipts-only (REIMBURSEMENT) invoice is a child of the round's
 * main invoice via parentInvoiceId. Adds to each invoice on the page:
 * - childInvoices: its reimbursement invoices (always complete, even if a status filter hid them)
 * - parentInvoice: for a child, its main invoice's number + status
 * Works on an already-filtered page, so totals, status counts and pagination are unchanged.
 */
export const attachInvoiceFamily = async <T extends { id: string; parentInvoiceId?: string | null }>(
  invoices: T[],
) => {
  const parentIds = [...new Set(invoices.map((invoice) => invoice.parentInvoiceId).filter(Boolean))] as string[];

  const [children, parents] = await Promise.all([
    prisma.invoice.findMany({
      where: { parentInvoiceId: { in: invoices.map((invoice) => invoice.id) } },
      select: CHILD_INVOICE_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    parentIds.length
      ? prisma.invoice.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, invoiceNumber: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  return invoices.map((invoice) => ({
    ...invoice,
    childInvoices: children.filter((child) => child.parentInvoiceId === invoice.id),
    parentInvoice: parents.find((parent) => parent.id === invoice.parentInvoiceId) ?? null,
  }));
};

/**
 * Withdraw / remove-from-campaign cleanup. Deletes the creator's receipt rows for the campaign
 * (pass `tx` to join the caller's transaction) and returns their file URLs. The caller deletes
 * the files with `deleteReceiptFiles` only after its own DB work has committed, so a rolled-back
 * withdrawal never leaves receipts pointing at missing files.
 */
export const deleteCreatorReceipts = async (
  campaignId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string[]> => {
  const receipts = await tx.reimbursementReceipt.findMany({
    where: { campaignId, userId },
    select: { fileUrl: true },
  });

  if (!receipts.length) return [];

  await tx.reimbursementReceipt.deleteMany({ where: { campaignId, userId } });

  return receipts.map((receipt) => receipt.fileUrl);
};

// Best-effort storage cleanup; never throws (a leftover file must not fail a finished withdrawal).
export const deleteReceiptFiles = async (fileUrls: string[], campaignId?: string, userId?: string) => {
  await Promise.all(fileUrls.map(deleteReceiptFile));

  // Any open review modal / creator screen drops the receipts straight away
  if (campaignId && userId && fileUrls.length) {
    getIo().to(campaignId).emit('v4:reimbursement:updated', { campaignId, userId });
  }
};

export const getReimbursements = async (campaignId: string, userId: string) => {
  const [agreements, invoices] = await Promise.all([
    prisma.creatorAgreement.findMany({
      where: { campaignId, userId },
      orderBy: { round: 'asc' },
      include: { reimbursementReceipts: { orderBy: { order: 'asc' } } },
    }),
    prisma.invoice.findMany({
      where: { campaignId, creatorId: userId },
      select: { id: true, round: true, invoiceType: true, status: true, invoiceNumber: true },
    }),
  ]);

  const findInvoice = (round: number, invoiceType: 'STANDARD' | 'REIMBURSEMENT') =>
    invoices.find((invoice) => invoice.round === round && invoice.invoiceType === invoiceType) ?? null;

  const reviewerIds = [
    ...new Set(
      agreements.flatMap((agreement) =>
        agreement.reimbursementReceipts.map((receipt) => receipt.reviewedById).filter(Boolean),
      ),
    ),
  ] as string[];

  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
    : [];
  const reviewerNameById = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name]));

  return agreements.map((agreement) => ({
    agreementId: agreement.id,
    round: agreement.round,
    required: agreement.isReceiptRequired,
    submittedAt: agreement.receiptsSubmittedAt,
    currency: agreement.currency || 'MYR',
    isSeeding: agreement.isSeeding,
    invoiceId: findInvoice(agreement.round, 'STANDARD')?.id ?? null,
    // Lets the toggle warn before an existing invoice is regenerated (draft) or supplemented
    invoice: findInvoice(agreement.round, 'STANDARD'),
    reimbursementInvoice: findInvoice(agreement.round, 'REIMBURSEMENT'),
    billed: isBilled(agreement),
    receipts: agreement.reimbursementReceipts.map((receipt) => ({
      ...receipt,
      reference: `RB-${agreement.id.slice(-4).toUpperCase()}-${receipt.order}`,
      reviewedByName: receipt.reviewedById ? (reviewerNameById.get(receipt.reviewedById) ?? null) : null,
    })),
  }));
};

/**
 * Turning receipts on after the round invoice exists:
 * - draft invoice: it's deleted (only after the admin confirmed the warning — `confirmRegenerate`)
 *   and regenerated with the receipts once they're all approved.
 * - any later status: the invoice is left alone; receipts go on a separate reimbursement invoice.
 */
export const setReceiptRequired = async (
  agreementId: string,
  required: boolean,
  adminId: string,
  confirmRegenerate = false,
) => {
  const agreement = await getAgreementOrThrow(agreementId);

  if (agreement.isReceiptRequired === required) return agreement;

  if (agreement.isSeeding) {
    throw new ReimbursementError(400, 'Receipts cannot be required on a seeding agreement');
  }

  assertNotBilled(agreement);

  const roundInvoice = await getRoundInvoice(agreement.campaignId, agreement.userId, agreement.round);
  const draftInvoice = required && roundInvoice?.status === 'draft' ? roundInvoice : null;

  if (draftInvoice && !confirmRegenerate) {
    const agreementAmount = parseFloat(agreement.amount ?? '') || 0;

    throw new ReimbursementError(
      409,
      `Invoice ${draftInvoice.invoiceNumber} is still a draft and will be regenerated`,
      {
        code: 'DRAFT_INVOICE_EXISTS',
        invoiceId: draftInvoice.id,
        invoiceNumber: draftInvoice.invoiceNumber,
        amount: draftInvoice.amount,
        agreementAmount,
        currency: agreement.currency || 'MYR',
        // The regenerated invoice starts again from the agreement amount
        wasEdited: Math.abs(draftInvoice.amount - agreementAmount) > 0.01,
      },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (draftInvoice) {
      // Status-checked delete: if the draft was approved in the meantime, nothing is lost
      const deleted = await tx.invoice.deleteMany({ where: { id: draftInvoice.id, status: 'draft' } });

      if (!deleted.count) {
        throw new ReimbursementError(
          409,
          `Invoice ${draftInvoice.invoiceNumber} is no longer a draft. Refresh and try again.`,
        );
      }

      // Old "invoice's ready" notifications would otherwise link to the deleted invoice
      await tx.notification.updateMany({ where: { invoiceId: draftInvoice.id }, data: { invoiceId: null } });
    }

    return tx.creatorAgreement.update({
      where: { id: agreementId },
      data: { isReceiptRequired: required },
      include: agreementInclude,
    });
  });

  const creatorName = agreement.user.name ?? 'creator';
  const agreementLabel = agreement.round > 1 ? ` (Agreement ${agreement.round})` : '';

  await logChange(
    `Receipt ${required ? 'required' : 'no longer required'} for ${creatorName}${agreementLabel}`,
    agreement.campaignId,
    undefined,
    adminId,
  );

  if (draftInvoice) {
    await logChange(
      `Draft invoice ${draftInvoice.invoiceNumber} for ${creatorName} was removed — it will be regenerated with the reimbursements once all receipts are approved`,
      agreement.campaignId,
      undefined,
      adminId,
    );

    getIo().to(agreement.campaignId).emit('v4:invoice:removed', {
      campaignId: agreement.campaignId,
      creatorId: agreement.userId,
      round: agreement.round,
      invoiceId: draftInvoice.id,
    });
  }

  if (required) {
    const message = draftInvoice
      ? `${agreement.campaign.name} reimburses your expenses — upload your receipts. Your invoice will be reissued once they're approved`
      : roundInvoice
        ? `${agreement.campaign.name} reimburses your expenses — upload your receipts. They'll be paid on a separate invoice`
        : `${agreement.campaign.name} reimburses your expenses — upload your receipts to be paid back`;

    await notifyUser(agreement.userId, agreement.campaignId, '🧾 Upload your receipts', message);
  }

  // Off: drops the hold and generates the fee-only invoice if the videos are done.
  // On: bills straight away if receipts kept from an earlier toggle are already all approved.
  await releaseInvoiceIfReady(updated, adminId);

  emitUpdate(agreement.campaignId, agreement.userId, agreement.round);

  return updated;
};

export const addReceipt = async (userId: string, input: ReceiptInput, file?: ReceiptFile) => {
  if (!input.agreementId) throw new ReimbursementError(400, 'agreementId is required');
  if (!file) throw new ReimbursementError(400, 'Receipt file is required');

  const agreement = await getAgreementOrThrow(input.agreementId);
  await assertCreatorCanEdit(agreement, userId);

  if (agreement.receiptsSubmittedAt) {
    throw new ReimbursementError(400, 'Receipts have already been submitted');
  }

  const amount = parseAmount(input.amount);
  const description = parseDescription(input.description);
  const detected = await validateFile(file);

  const fileUrl = await uploadReceiptFile(agreement.id, file, detected);
  const receipts = agreement.reimbursementReceipts;
  const lastOrder = receipts[receipts.length - 1]?.order ?? 0;

  const receipt = await prisma.reimbursementReceipt.create({
    data: {
      agreementId: agreement.id,
      userId,
      campaignId: agreement.campaignId,
      round: agreement.round,
      order: lastOrder + 1,
      fileUrl,
      fileName: file.name,
      mimeType: detected.mimeType,
      amount,
      currency: agreement.currency || 'MYR',
      description,
    },
  });

  emitUpdate(agreement.campaignId, userId, agreement.round);

  return receipt;
};

/**
 * Edits a DRAFT receipt, or replaces a REJECTED one — a replaced receipt goes straight back
 * to PENDING_REVIEW because the creator has already submitted the batch.
 */
export const updateReceipt = async (userId: string, receiptId: string, input: ReceiptInput, file?: ReceiptFile) => {
  const receipt = await prisma.reimbursementReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) throw new ReimbursementError(404, 'Receipt not found');

  const agreement = await getAgreementOrThrow(receipt.agreementId);
  await assertCreatorCanEdit(agreement, userId);

  if (receipt.status !== 'DRAFT' && receipt.status !== 'REJECTED') {
    throw new ReimbursementError(400, 'Only draft or rejected receipts can be changed');
  }

  const isReplacingRejected = receipt.status === 'REJECTED';

  const detected = file ? await validateFile(file) : null;

  const data: Record<string, unknown> = {};
  if (input.amount !== undefined) data.amount = parseAmount(input.amount);
  if (input.description !== undefined) data.description = parseDescription(input.description);

  if (file && detected) {
    data.fileUrl = await uploadReceiptFile(agreement.id, file, detected);
    data.fileName = file.name;
    data.mimeType = detected.mimeType;
  }

  if (isReplacingRejected) {
    Object.assign(data, {
      status: 'PENDING_REVIEW' as ReimbursementStatus,
      submittedAt: new Date(),
      rejectionReason: null,
      reviewedAt: null,
      reviewedById: null,
    });
  }

  const updated = await prisma.reimbursementReceipt.update({ where: { id: receiptId }, data });

  if (file) await deleteReceiptFile(receipt.fileUrl);

  if (isReplacingRejected) {
    await notifyCampaignAdmins(
      agreement.campaignId,
      '🧾 Receipt resubmitted',
      `${agreement.user.name ?? 'A creator'} resubmitted a receipt for ${agreement.campaign.name}`,
    );
  }

  emitUpdate(agreement.campaignId, userId, agreement.round);

  return updated;
};

export const deleteReceipt = async (userId: string, receiptId: string) => {
  const receipt = await prisma.reimbursementReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) throw new ReimbursementError(404, 'Receipt not found');

  const agreement = await getAgreementOrThrow(receipt.agreementId);
  await assertCreatorCanEdit(agreement, userId);

  if (receipt.status !== 'DRAFT' && receipt.status !== 'REJECTED') {
    throw new ReimbursementError(400, 'Only draft or rejected receipts can be removed');
  }

  await prisma.reimbursementReceipt.delete({ where: { id: receiptId } });
  await renumberReceipts(agreement.id);
  await deleteReceiptFile(receipt.fileUrl);

  // Removing the last rejected receipt may leave every remaining one approved.
  if (receipt.status === 'REJECTED') await releaseInvoiceIfReady(agreement);

  emitUpdate(agreement.campaignId, userId, agreement.round);
};

export const submitReceipts = async (userId: string, agreementId: string) => {
  const agreement = await getAgreementOrThrow(agreementId);
  await assertCreatorCanEdit(agreement, userId);

  if (agreement.receiptsSubmittedAt) {
    throw new ReimbursementError(400, 'Receipts have already been submitted');
  }

  const drafts = agreement.reimbursementReceipts.filter((receipt) => receipt.status === 'DRAFT');
  if (!drafts.length) throw new ReimbursementError(400, 'Add at least one receipt before submitting');

  const now = new Date();

  await prisma.$transaction([
    prisma.reimbursementReceipt.updateMany({
      where: { agreementId, status: 'DRAFT' },
      data: { status: 'PENDING_REVIEW', submittedAt: now },
    }),
    prisma.creatorAgreement.update({ where: { id: agreementId }, data: { receiptsSubmittedAt: now } }),
  ]);

  await notifyCampaignAdmins(
    agreement.campaignId,
    '🧾 Receipts submitted',
    `${agreement.user.name ?? 'A creator'} submitted ${drafts.length} receipt${
      drafts.length > 1 ? 's' : ''
    } for ${agreement.campaign.name}`,
  );

  emitUpdate(agreement.campaignId, userId, agreement.round);
};

export const reviewReceipt = async (adminId: string, receiptId: string, input: ReviewInput) => {
  const receipt = await prisma.reimbursementReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) throw new ReimbursementError(404, 'Receipt not found');

  if (receipt.status !== 'PENDING_REVIEW') {
    throw new ReimbursementError(400, 'Only receipts pending review can be approved or rejected');
  }

  const agreement = await getAgreementOrThrow(receipt.agreementId);
  assertNotBilled(agreement);

  const isApprove = input.action === 'approve';
  const reason = input.reason?.trim();

  if (!isApprove && !reason) throw new ReimbursementError(400, 'A reason is required to reject a receipt');

  const financeNote = input.financeNote?.trim();

  // Conditional write: only a still-pending receipt is updated. If two admins review at the same
  // moment, the database lets just one through — the other gets 0 rows and a clean 409.
  const { count } = await prisma.reimbursementReceipt.updateMany({
    where: { id: receiptId, status: 'PENDING_REVIEW' },
    data: {
      status: isApprove ? 'APPROVED' : 'REJECTED',
      reviewedAt: new Date(),
      reviewedById: adminId,
      rejectionReason: isApprove ? null : reason,
      ...(financeNote !== undefined && { financeNote: financeNote || null }),
    },
  });

  if (!count) throw new ReimbursementError(409, 'This receipt was already reviewed');

  const updated = await prisma.reimbursementReceipt.findUniqueOrThrow({ where: { id: receiptId } });

  const reference = `RB-${agreement.id.slice(-4).toUpperCase()}-${receipt.order}`;

  await logChange(
    `Reimbursement ${reference} for ${agreement.user.name ?? 'creator'} was ${isApprove ? 'approved' : 'rejected'}`,
    agreement.campaignId,
    undefined,
    adminId,
  );

  if (isApprove) {
    await releaseInvoiceIfReady(agreement, adminId);
  } else {
    await notifyUser(
      agreement.userId,
      agreement.campaignId,
      '🧾 Receipt needs changes',
      `Your receipt "${receipt.description}" for ${agreement.campaign.name} was rejected: ${reason}`,
    );
  }

  emitUpdate(agreement.campaignId, agreement.userId, agreement.round);

  return updated;
};
