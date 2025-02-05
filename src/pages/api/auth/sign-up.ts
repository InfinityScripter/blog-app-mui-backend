// src/pages/api/auth/sign-up.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import User, { IUser } from '../../../models/User';
// @ts-ignore
import bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';
import cors from '../../../utils/cors';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    // Поиск пользователя по email (удаляем лишние пробелы)
    const existingUser = await User.findOne({ email: email.trim() });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const newUser: Partial<IUser> = {
      name: `${firstName} ${lastName}`,
      email: email.trim(),
      passwordHash,
      isEmailVerified: false,
    };
    const createdUser = await User.create(newUser);
    const accessToken = sign({ userId: createdUser._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return res.status(201).json({ accessToken, user: createdUser });
  } catch (error: any) {
    console.error('[Sign Up API]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
