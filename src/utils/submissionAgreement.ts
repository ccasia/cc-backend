import { randomUUID } from 'crypto';

type AgreementCandidate = {
  createdAt?: Date | string | null;
  id?: string;
  status?: string | null;
  submissionDate?: Date | string | null;
  submissionType?: {
    type?: string | null;
  } | null;
  updatedAt?: Date | string | null;
};

const AGREEMENT_STATUS_PRIORITY: Record<string, number> = {
  PENDING_REVIEW: 4,
  SENT_TO_CLIENT: 4,
  APPROVED: 4,
  CLIENT_APPROVED: 4,
  CHANGES_REQUIRED: 3,
  IN_PROGRESS: 3,
  NOT_STARTED: 2,
  CLIENT_FEEDBACK: 1,
  REJECTED: 0,
};

export function buildAgreementUploadFileName(
  submissionId: string,
  submittedAt = new Date(),
  nonce: string = randomUUID(),
): string {
  const safeSubmissionId = submissionId.replace(/[^a-z0-9_-]/gi, '_');
  const safeNonce = nonce.replace(/[^a-z0-9_-]/gi, '_');

  return `${safeSubmissionId}/${submittedAt.getTime()}-${safeNonce}.pdf`;
}

export function selectCurrentAgreementSubmission<T extends AgreementCandidate>(submissions: T[]): T | undefined {
  return submissions
    .filter((submission) => submission.submissionType?.type === 'AGREEMENT_FORM')
    .sort(compareAgreementSubmissions)[0];
}

function compareAgreementSubmissions(a: AgreementCandidate, b: AgreementCandidate): number {
  const priorityDiff = getAgreementStatusPriority(b.status) - getAgreementStatusPriority(a.status);
  if (priorityDiff !== 0) return priorityDiff;

  const dateDiff = getAgreementSortDate(b) - getAgreementSortDate(a);
  if (dateDiff !== 0) return dateDiff;

  return String(b.id ?? '').localeCompare(String(a.id ?? ''));
}

function getAgreementStatusPriority(status?: string | null): number {
  return AGREEMENT_STATUS_PRIORITY[status ?? ''] ?? 1;
}

function getAgreementSortDate(submission: AgreementCandidate): number {
  const dateValue = submission.updatedAt ?? submission.submissionDate ?? submission.createdAt;
  if (!dateValue) return 0;

  const timestamp = new Date(dateValue).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
