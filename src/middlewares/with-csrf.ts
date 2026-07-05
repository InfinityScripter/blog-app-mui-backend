import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { csrfValid } from '@/src/lib/csrf';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// ----------------------------------------------------------------------
// CSRF guard for cookie-authenticated, state-changing requests. Composes like
// the other middlewares: withCsrf(handler).
//
// Only mutating methods are checked. Requests carrying an Authorization: Bearer
// token are exempt — that path is the news bot's service token (no ambient
// cookie the browser would auto-send), so it is not CSRF-exposed. Everything
// else (the browser SPA, which authenticates via the access_token cookie) must
// present a matching double-submit CSRF token.

const SAFE_METHODS: readonly string[] = [
  HTTP_METHOD.GET,
  HTTP_METHOD.HEAD,
  HTTP_METHOD.OPTIONS,
];

export const withCsrf =
  (handler: NextApiHandler) => (req: NextApiRequest, res: NextApiResponse) => {
    const method = req.method ?? HTTP_METHOD.GET;

    // Safe (non-mutating) methods never need CSRF.
    if (SAFE_METHODS.includes(method)) {
      return handler(req, res);
    }

    // Bearer-token requests (bot service token / legacy) are not cookie-driven
    // and therefore not CSRF-exposed.
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return handler(req, res);
    }

    if (!csrfValid(req)) {
      return res.status(HTTP.FORBIDDEN).json({ success: false, message: 'CSRF validation failed' });
    }

    return handler(req, res);
  };
