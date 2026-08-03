// middleware/bigIntSerializer.ts
import { Request, Response, NextFunction } from 'express';

export function bigIntSerializerMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    return originalJson(
      JSON.parse(JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))),
    );
  };
  next();
}
