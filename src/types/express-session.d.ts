import 'express-session';

interface OTPTypes {
  secret: string;
  phone: string;
  sentAt: Date;
  attempts: number;
  isCodeUsed: boolean;
  userId: string;
}

declare module 'express-session' {
  interface SessionData {
    userid: string;
    refreshToken: string;
    name: string;
    role: string;
    photoURL: string;
    xeroToken: any;
    xeroTokenid: any;
    xeroTokenSet: any;
    xeroTenants: any;
    xeroActiveTenants: any;
    isImpersonating?: boolean;
    impersonatingBy?: { userId: string; name: string } | null;
    otp?: OTPTypes;
    pendingRegistration:
      | {
          phone: string;
          verified: boolean;
          authType: 'otp' | 'email';
        }
      | undefined;
  }
}
