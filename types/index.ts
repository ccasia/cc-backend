import { XeroAccessToken, XeroIdToken } from 'xero-node';

declare module 'express-session' {
  interface Session {
    decodedAccessToken: XeroAccessToken;
    decodedIdToken: XeroIdToken;
    tokenSet: any;
    allTenants: any[];
    activeTenant: any;
  }
}
