// src/pages/api/auth/google/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dotenv from 'dotenv';
import nextConnect from 'next-connect';
import { signToken } from '@/src/lib/jwt';

import dbConnect from '../../../../lib/db';
import passport from '../../../../lib/passport';

dotenv.config();

const handler = nextConnect<NextApiRequest, NextApiResponse>();

handler.use(async (req, res, next) => {
  await dbConnect();
  next();
});

handler.get(passport.authenticate('google', { session: false }), (req: any, res) => {
  // При успешной аутентификации создаём JWT и перенаправляем на фронтенд
  const { user } = req;
  const token = signToken({ userId: user.id });
  const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.redirect(`${frontendURL}/auth/success?token=${token}`);
});

export default handler;
