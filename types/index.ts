import { XeroAccessToken, XeroIdToken } from 'xero-node';
import 'express';

export interface OTPTypes {
  secret: string;
  phone: string;
  sentAt: Date;
  attempts: number;
  isCodeUsed: boolean;
}

declare module 'express-session' {
  interface Session {
    decodedAccessToken: XeroAccessToken;
    decodedIdToken: XeroIdToken;
    tokenSet: any;
    allTenants: any[];
    activeTenant: any;
    isImpersonating?: boolean;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    ipinfo?: {
      ip: string;
      city?: string;
      region?: string;
      country?: string;
      loc?: string;
      org?: string;
      postal?: string;
      timezone?: string;
    };
  }
}
