import type { ZodType } from 'zod';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';

// ----------------------------------------------------------------------
// Body-validation middleware. Wrap a handler with a zod schema; an invalid
// req.body is rejected with 400 (consistent { success:false, message } shape)
// before the handler runs. On success req.body is replaced with the parsed,
// typed value.

export function validateBody<T>(schema: ZodType<T>) {
  return (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path.join('.');
      const message = first ? `${path ? `${path}: ` : ''}${first.message}` : 'Invalid request body';
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message });
    }
    req.body = result.data;
    return handler(req, res);
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path.join('.');
      const message = first ? `${path ? `${path}: ` : ''}${first.message}` : 'Invalid query';
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message });
    }
    req.query = result.data as NextApiRequest['query'];
    return handler(req, res);
  };
}

/**
 * Per-method body validation for multi-method routes (e.g. POST/PUT/DELETE on
 * one comments endpoint). Methods absent from the map pass through untouched —
 * the route's own method check (withMethods or inline 405) still applies.
 */
export function validateBodyByMethod(schemas: Partial<Record<string, ZodType>>) {
  return (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    const schema = req.method ? schemas[req.method] : undefined;
    if (!schema) {
      return handler(req, res);
    }
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = first?.path.join('.');
      const message = first ? `${path ? `${path}: ` : ''}${first.message}` : 'Invalid request body';
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message });
    }
    req.body = result.data;
    return handler(req, res);
  };
}
