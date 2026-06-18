import type { NextApiResponse } from 'next';

// ----------------------------------------------------------------------
// Standard API response helpers.
//
// Shape:
//   success: { success: true, message?, data? }
//   error:   { success: false, message }
//
// Adopt these in new routes. Existing routes keep their current success
// payload keys (the frontend reads them directly, e.g. data.posts), so we
// don't break the client contract by retrofitting everywhere at once.

interface OkOptions {
  status?: number;
  message?: string;
}

export function ok<T>(res: NextApiResponse, data?: T, options: OkOptions = {}) {
  const { status = 200, message } = options;
  return res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  });
}

export function fail(res: NextApiResponse, status: number, message: string) {
  return res.status(status).json({ success: false, message });
}
