export type ReceiptInput = {
  agreementId?: string;
  amount?: number | string;
  description?: string;
};

export type ReviewInput = {
  action: 'approve' | 'reject';
  reason?: string;
  financeNote?: string;
};

// express-fileupload file (useTempFiles: true)
export type ReceiptFile = {
  name: string;
  mimetype: string;
  size: number;
  tempFilePath: string;
};
