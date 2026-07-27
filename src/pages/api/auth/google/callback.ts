// src/pages/api/auth/google/callback.ts
import type User from '@/src/models/User';
import type { NextApiRequest, NextApiResponse } from 'next';

import dotenv from 'dotenv';
import dbConnect from '@/src/lib/db';
import passport from '@/src/lib/passport';
import { sendError } from '@/src/utils/response';
import { HTTP_METHOD } from '@/src/constants/http';
import { setAuthCookies } from '@/src/lib/cookies';
import { issueSession } from '@/src/services/session';
import { withMethods } from '@/src/middlewares/with-methods';
import { validateAndClearOAuthState } from '@/src/lib/oauth-state';
import { requireFeature } from '@/src/middlewares/require-feature';

dotenv.config();
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';

interface GoogleAuthInfo {
  consentToken?: string;
  message?: string;
}

interface GoogleAuthResult {
  user: User | false;
  info?: GoogleAuthInfo;
}

/**
 * Run the Google strategy and resolve with whatever its verify callback produced
 * (src/lib/passport.ts). passport's custom-callback form suppresses its own
 * redirects, so every branch is decided by the handler below. `next` is
 * unreachable for an OAuth2 strategy (it would take a strategy.pass()), but it
 * still has to settle the promise — a stray call would hang the request forever.
 */
function authenticateGoogle(req: NextApiRequest, res: NextApiResponse): Promise<GoogleAuthResult> {
  return new Promise((resolve, reject) => {
    passport.authenticate(
      'google',
      { session: false },
      (error: Error | null, user: User | false, info?: GoogleAuthInfo) =>
        error ? reject(error) : resolve({ user, info })
    )(req, res, (error: unknown) =>
      reject(error instanceof Error ? error : new Error('google strategy did not authenticate'))
    );
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();

    if (!validateAndClearOAuthState(req, res, 'google', req.query.state)) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=google_state`);
    }

    let result: GoogleAuthResult;
    try {
      result = await authenticateGoogle(req, res);
    } catch (error) {
      // Keep codes/profile/tokens out of logs; the message is enough to find the stage.
      // eslint-disable-next-line no-console
      console.error(
        '[oauth.google.callback] authentication failed',
        error instanceof Error ? error.message : 'unknown error'
      );
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=google_failed`);
    }

    const { user, info } = result;
    if (!user) {
      if (info?.consentToken) {
        return res.redirect(
          `${frontendURL}/auth/oauth-consent#token=${encodeURIComponent(info.consentToken)}`
        );
      }
      const oauthError =
        info?.message === 'oauth_account_not_found' ? 'account_not_found' : 'google_failed';
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=${oauthError}`);
    }

    // On success: mint access+refresh, set httpOnly cookies, and redirect to the
    // frontend WITHOUT the token in the URL (no leak into history/referrer/logs).
    // The cookies are scoped to THIS API origin — exactly where the frontend's
    // XHRs (withCredentials) are sent. The earlier oauth_state clear Set-Cookie is
    // preserved (setAuthCookies appends).
    const session = await issueSession({
      userId: user.id,
      role: user.role ?? 'user',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setAuthCookies(req, res, session);
    return res.redirect(`${frontendURL}/auth/success`);
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireFeature('pdCollection')(withMethods([HTTP_METHOD.GET])(handler));
