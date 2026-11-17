jest.mock('../src/prisma/prisma', () => ({
  prisma: { submission: { findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock('../src/modules/gamification', () => ({ onSubmissionSubmitted: jest.fn() }));

import { prisma } from '../src/prisma/prisma';
import { updatePostingLink } from '../src/service/submissionV4Service';
import { PostingLinkError } from '../src/utils/postingLinkValidation';

const db = prisma as any;
const link = 'https://www.instagram.com/reel/DfrYSz8TeGu/';

const submission = (type: string, status: string, videoStatuses: string[] = []) => ({
  id: 'sub-1',
  status,
  submissionVersion: 'v4',
  submissionType: { type },
  campaign: { campaignType: 'normal' },
  video: videoStatuses.map((s) => ({ status: s })),
});

beforeEach(() => {
  db.submission.update.mockResolvedValue({ id: 'sub-1', status: 'APPROVE_LINK' });
});

describe('updatePostingLink', () => {
  it.each([
    ['PHOTO', 'APPROVED', []],
    ['RAW_FOOTAGE', 'APPROVED', []],
    ['VIDEO', 'APPROVED', ['APPROVED']],
    ['PHOTO', 'CLIENT_APPROVED', []],
    ['PHOTO', 'REJECTED', []],
  ])('accepts a link for %s with status %s, videos %j', async (type, status, videos) => {
    db.submission.findUnique.mockResolvedValue(submission(type, status, videos));

    await updatePostingLink('sub-1', [link]);

    expect(db.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVE_LINK', content: link }) }),
    );
  });

  it.each([
    ['VIDEO', 'APPROVED', ['PENDING']],
    ['VIDEO', 'APPROVED', []],
    ['PHOTO', 'PENDING_REVIEW', []],
    ['PHOTO', 'CHANGES_REQUIRED', []],
  ])('rejects a link for %s with status %s, videos %j', async (type, status, videos) => {
    db.submission.findUnique.mockResolvedValue(submission(type, status, videos));

    await expect(updatePostingLink('sub-1', [link])).rejects.toBeInstanceOf(PostingLinkError);
    expect(db.submission.update).not.toHaveBeenCalled();
  });
});
