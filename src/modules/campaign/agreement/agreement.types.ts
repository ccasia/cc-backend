import { Request } from 'express';

// Thrown by the agreement workflows instead of writing to `res`, so the same code can run behind
// an HTTP handler or inside a queue worker. `status` is the HTTP status the handler should return.
export class AgreementError extends Error {
  status: number;
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'AgreementError';
    this.status = status;
    this.extra = extra;
  }
}

// Who is performing the action. `req` is optional (absent in a worker); when present it keeps
// the activity log attributed to the session user exactly as before.
export interface AgreementActor {
  adminId: string;
  req?: Request;
}

export interface AgreementProductInput {
  name: string;
  value: string | number;
}

export interface UpdateAgreementAmountInput {
  user: { id: string };
  campaignId: string;
  // The existing CreatorAgreement row being edited. May be absent when isNew creates it.
  agreementId?: string;
  paymentAmount: string | number;
  currency: string;
  isNew?: boolean;
  credits?: number | string | null;
  selectedPlatform?: string | null;
  followerCount?: unknown;
  round?: number;
  isSeedingAgreement?: boolean;
  product?: AgreementProductInput;
  // Temp path of an uploaded agreement PDF. Omit to keep / fall back to the campaign template.
  agreementFormPath?: string;
}

export interface SendAgreementInput {
  user: { id: string };
  campaignId: string;
  agreementId: string;
  isNew?: boolean;
  credits?: number | string | null;
  selectedPlatform?: string | null;
  followerCount?: unknown;
  round?: number;
}

export interface BulkAgreementCreatorInput {
  userId: string;
  // Present when the creator already has a draft agreement row (V2 update path).
  agreementId?: string;
  // Same meaning as on the single-creator endpoints: upsert the round's agreement from the campaign template.
  isNew?: boolean;
  paymentAmount: string | number;
  currency: string;
  credits?: number | string | null;
  selectedPlatform?: string | null;
  followerCount?: unknown;
  round?: number;
  isSeedingAgreement?: boolean;
  product?: AgreementProductInput;
  // Matches the uploaded file name (`<fileKey>.pdf`); defaults to agreementId, then userId.
  fileKey?: string;
  // Temp path of this creator's uploaded agreement PDF, resolved from the multipart upload.
  agreementFormPath?: string;
}

export interface BulkAgreementResult {
  userId: string;
  success: boolean;
  // Which step failed, so the caller can tell a saved-but-unsent draft from a total miss.
  failedStep?: 'update' | 'send';
  message?: string;
}
