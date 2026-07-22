// src/pages/api/auth/google/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dotenv from 'dotenv';
import dbConnect from '@/src/lib/db';
import nextConnect from 'next-connect';
import passport from '@/src/lib/passport';
import { FEATURES } from '@/src/config-global';
import { setAuthCookies } from '@/src/lib/cookies';
import { issueSession } from '@/src/services/session';
import { validateAndClearOAuthState } from '@/src/lib/oauth-state';
import { requireFeature } from '@/src/middlewares/require-feature';

dotenv.config();
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';

const handler = nextConnect<NextApiRequest, NextApiResponse>();

interface GoogleAuthInfo {
  consentToken?: string;
  message?: string;
}

handler.use(async (req, res, next) => {
  await dbConnect();
  next();
});

handler.get(
  (req, res, next) => {
    if (!validateAndClearOAuthState(req, res, 'google', req.query.state)) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=google_state`);
    }
    passport.authenticate(
      'google',
      { session: false },
      (error: Error | null, user: Express.User | false, info?: GoogleAuthInfo) => {
        if (error) {
          // Keep codes/profile/tokens out of logs; the message is enough to find the stage.
          // eslint-disable-next-line no-console
          console.error('[oauth.google.callback] authentication failed', error.message);
          return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=google_failed`);
        }
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
        req.user = user as NextApiRequest['user'];
        return next();
      }
    )(req, res, next);
  },
  async (req: any, res) => {
    // On success: mint access+refresh, set httpOnly cookies, and redirect to the
    // frontend WITHOUT the token in the URL (no leak into history/referrer/logs).
    // The cookies are scoped to THIS API origin — exactly where the frontend's
    // XHRs (withCredentials) are sent.
    const { user } = req;
    const session = await issueSession({
      userId: user.id,
      role: user.role ?? 'user',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setAuthCookies(req, res, session);
    res.redirect(`${frontendURL}/auth/success`);
  }
);

export default requireFeature(FEATURES.pdCollection)(handler);
