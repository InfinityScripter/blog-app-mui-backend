import type { NextApiRequest, NextApiResponse } from 'next';

import { isAllowedOrigin } from '@/src/utils/allowed-origin';

// ----------------------------------------------------------------------

/**
 * Per-route CORS helper.
 *
 * Only reflects the request Origin when it is on the allow-list
 * (see allowed-origin.ts) — never echoes an arbitrary origin, so it cannot
 * grant credentialed cross-origin access to untrusted sites. Mirrors the
 * edge middleware policy (src/middleware.ts).
 */
const cors = (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  const { origin } = req.headers;

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  return Promise.resolve();
};

export default cors;
