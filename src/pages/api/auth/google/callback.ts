// src/pages/api/auth/google/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dotenv from 'dotenv';
import dbConnect from '@/src/lib/db';
import nextConnect from 'next-connect';
import passport from '@/src/lib/passport';
import { setAuthCookies } from '@/src/lib/cookies';
import { issueSession } from '@/src/services/session';

dotenv.config();

const handler = nextConnect<NextApiRequest, NextApiResponse>();

handler.use(async (req, res, next) => {
  await dbConnect();
  next();
});

handler.get(passport.authenticate('google', { session: false }), async (req: any, res) => {
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
  const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.redirect(`${frontendURL}/auth/success`);
});

export default handler;
