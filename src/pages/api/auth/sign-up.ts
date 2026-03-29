// src/pages/api/auth/sign-up.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// @ts-ignore
import bcrypt from 'bcrypt';

import cors from '../../../utils/cors';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
import { sendVerificationEmail } from '../../../utils/email';

import type { IUser } from '../../../models/User';

const hasEmailCredentials = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

// Генерация 6-значного кода
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    if (!hasEmailCredentials) {
      return res.status(503).json({
        message: 'Email service is not configured. Registration is temporarily unavailable.',
      });
    }

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

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newUser: Partial<IUser> = {
      name: `${firstName} ${lastName}`,
      email: email.trim(),
      passwordHash,
      isEmailVerified: false,
      emailVerificationCode: verificationCode ?? undefined,
      emailVerificationExpires: verificationExpires ?? undefined,
    };
    const createdUser = await User.create(newUser);

    await sendVerificationEmail(email.trim(), verificationCode);

    return res.status(201).json({
      message: 'User created successfully. Please check your email for verification code.',
      user: {
        id: createdUser._id,
        email: createdUser.email,
        name: createdUser.name,
        isEmailVerified: createdUser.isEmailVerified,
      },
    });
  } catch (error: any) {
    console.error('[Sign Up API]', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
}
