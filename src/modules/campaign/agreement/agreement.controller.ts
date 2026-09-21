import { Request, Response } from 'express';
import { bulkSendAgreements } from './agreement.service';
import { BulkAgreementCreatorInput } from './agreement.types';

// Each creator's save + send runs inline for now, so cap the batch to keep the request well
// inside the HTTP timeout. Move the per-creator work onto a queue to lift this.
const MAX_BULK_CREATORS = 50;

// The client names two fields differently from the single-creator endpoints (ugcCredits,
// platformFollowerCount). Accept both spellings, and send the amount as a string like the
// agreement column, so an unchanged amount isn't logged as a change.
type BulkCreatorRequest = BulkAgreementCreatorInput & {
  ugcCredits?: number | string | null;
  platformFollowerCount?: unknown;
};

const normalizeCreator = ({
  ugcCredits,
  platformFollowerCount,
  ...creator
}: BulkCreatorRequest): BulkAgreementCreatorInput => ({
  ...creator,
  // Seeding agreements may have no amount; don't turn a missing one into the string 'undefined'.
  ...(creator.paymentAmount !== undefined &&
    creator.paymentAmount !== null && { paymentAmount: String(creator.paymentAmount) }),
  credits: creator.credits ?? ugcCredits,
  followerCount: creator.followerCount ?? platformFollowerCount,
});

// The client posts multipart form data: `creators` is a JSON string and each creator's generated
// agreement PDF is an `agreementForms` file named `<fileKey>.pdf`. Plain JSON bodies also work.
const parseCreators = (raw: unknown): BulkCreatorRequest[] | undefined => {
  if (typeof raw !== 'string') return Array.isArray(raw) ? raw : undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// Pairs each creator with their uploaded PDF by file name.
const attachAgreementForms = (req: Request, creators: BulkCreatorRequest[]): BulkCreatorRequest[] => {
  const uploaded = (req.files as any)?.agreementForms;
  const files: { name: string; tempFilePath: string }[] = !uploaded
    ? []
    : Array.isArray(uploaded)
      ? uploaded
      : [uploaded];
  const pathByName = new Map(files.map((file) => [file.name, file.tempFilePath]));

  return creators.map((creator) => {
    const fileKey = creator.fileKey ?? creator.agreementId ?? creator.userId;
    return { ...creator, agreementFormPath: pathByName.get(`${fileKey}.pdf`) };
  });
};

export const bulkSendAgreementsHandler = async (req: Request, res: Response) => {
  const { campaignId } = req.body as { campaignId?: string };
  const creators = parseCreators(req.body.creators);

  if (!campaignId || !Array.isArray(creators) || creators.length === 0) {
    return res.status(400).json({ message: 'campaignId and at least one creator are required.' });
  }

  if (creators.length > MAX_BULK_CREATORS) {
    return res.status(400).json({ message: `A maximum of ${MAX_BULK_CREATORS} creators can be sent at once.` });
  }

  const invalid = creators.find((creator) => {
    if (!creator.userId) return creator;

    if (!creator.isSeedingAgreement && (creator.paymentAmount === undefined || creator.paymentAmount === null))
      return creator;

    if (!creator.currency) return creator;
  });

  if (invalid) {
    return res.status(400).json({ message: 'Every creator needs a userId, paymentAmount and currency.' });
  }

  if (new Set(creators.map((creator) => creator.userId)).size !== creators.length) {
    return res.status(400).json({ message: 'Each creator can only appear once per request.' });
  }

  try {
    const results = await bulkSendAgreements(campaignId, attachAgreementForms(req, creators).map(normalizeCreator), {
      adminId: req.userId as string,
      req,
    });

    const succeeded = results.filter((result) => result.success).length;
    const failed = results.length - succeeded;

    // 207 when only some creators went through, so the client knows to read `results`.
    return res.status(failed === 0 ? 200 : 207).json({
      message: failed === 0 ? 'All agreements sent.' : `${succeeded} sent, ${failed} failed.`,
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    console.error('Error in bulkSendAgreements:', error);
    return res.status(500).json({ message: 'Error sending agreements' });
  }
};
