// src/pages/api/auth/sign-in.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// @ts-ignore
import bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';

import cors from '../../../utils/cors';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Missing email or password' });
    }
    // Поиск пользователя по email (очищаем от пробелов)
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
    const accessToken = sign({ userId: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return res.status(200).json({ accessToken, user });
  } catch (error: any) {
    console.error('[Sign In API]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
