import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import nextConnect from 'next-connect';
import passport from '@/src/lib/passport';
import { issueOAuthState } from '@/src/lib/oauth-state';
import { requireFeature } from '@/src/middlewares/require-feature';

const handler = nextConnect<NextApiRequest, NextApiResponse>();

handler.use(async (req, res, next) => {
  await dbConnect();
  next();
});

// Инициирует аутентификацию через Google и привязывает callback к браузеру.
handler.get((req, res, next) => {
  const state = issueOAuthState(req, res, 'google');
  passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});

export default requireFeature('pdCollection')(handler);
