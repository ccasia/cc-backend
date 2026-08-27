export {};
// import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authMethod?: 'session' | 'jwt';
    }
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
