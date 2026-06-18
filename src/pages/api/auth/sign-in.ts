// src/pages/api/auth/sign-in.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// @ts-ignore
import bcrypt from 'bcrypt';
import { JWT_SECRET } from '@/src/lib/jwt';
import { sign, type SignOptions } from 'jsonwebtoken';

import cors from '../../../utils/cors';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
import { signInSchema } from '../../../schemas/auth';
import { toPublicUser } from '../../../utils/public-user';

const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path.join('.');
      return res.status(400).json({
        success: false,
        message: first ? `${path ? `${path}: ` : ''}${first.message}` : 'Missing email or password',
      });
    }
    const { email, password } = parsed.data;
    // Поиск пользователя по email
    const user = await User.findOne({ email: email.trim() });
    if (!user) {
      return res.status(400).json({ message: 'Wrong email or password' });
    }
    if (!user.passwordHash) {
      return res.status(400).json({ message: 'No password set for this user' });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Wrong email or password' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: 'Please verify your email before signing in',
        requiresVerification: true,
      });
    }

    const accessToken = sign({ userId: user._id, role: user.role ?? 'user' }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    return res.status(200).json({ accessToken, user: toPublicUser(user) });
  } catch (error: any) {
    console.error('[Sign In API]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
