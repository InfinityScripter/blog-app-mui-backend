import type { NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { isAppError } from '@/src/types/api';
import { MSG } from '@/src/constants/messages';

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

/**
 * Maps a thrown error to an HTTP response. AppError uses its own status,
 * message and optional extra fields; anything else becomes a 500. Routes call
 * this in catch so they never branch on error types themselves.
 */
export function sendError(res: NextApiResponse, error: unknown) {
  if (isAppError(error)) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message, ...error.extra });
  }
  // eslint-disable-next-line no-console
  console.error('[API error]', error);
  return res.status(HTTP.INTERNAL).json({ success: false, message: MSG.INTERNAL });
}
