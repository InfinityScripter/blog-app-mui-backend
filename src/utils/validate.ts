import type { ZodType } from 'zod';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

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
      return res.status(400).json({ success: false, message });
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
      return res.status(400).json({ success: false, message });
    }
    req.query = result.data as NextApiRequest['query'];
    return handler(req, res);
  };
}
