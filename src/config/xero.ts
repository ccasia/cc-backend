import { XeroClient } from 'xero-node';

const client_id: string = process.env.XERO_CLIENT_ID as string;
const client_secret: string = process.env.XERO_CLIENT_SECRET as string;
const redirectUrl: string = process.env.XERO_REDIRECT_URL as string;
const scopes: string = process.env.XERO_SCOPES as string;

export const xeroClientConfig = {
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes?.split(' '),
};

// Shared client for the OAuth consent flow only. Workers use getXeroClientForAdmin, one client per admin.
export const xero = new XeroClient(xeroClientConfig);
