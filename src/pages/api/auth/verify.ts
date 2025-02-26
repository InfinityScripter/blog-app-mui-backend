import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '../../../utils/cors';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { email, code } = req.body;

    console.log('Verification attempt:', {
      email,
      code,
      timestamp: new Date().toISOString(),
    });

    if (!email || !code) {
      console.log('Missing email or verification code');
      return res.status(400).json({ message: 'Email and verification code are required' });
    }

    const user = await User.findOne({
      email,
      isEmailVerified: false,
    }).select('+emailVerificationCode +emailVerificationExpires');

    if (!user) {
      console.log('No unverified user found with email:', email);
      return res.status(400).json({
        message: 'Invalid email or user already verified',
      });
    }

    console.log('Found user:', {
      email: user.email,
      storedCode: user.emailVerificationCode,
      receivedCode: code,
      expiresAt: user.emailVerificationExpires,
    });

    // Проверяем срок действия кода
    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      console.log('Verification code expired');
      return res.status(400).json({
        message: 'Verification code has expired. Please request a new one.',
      });
    }

    // Проверяем код верификации
    if (user.emailVerificationCode !== code) {
      console.log('Invalid verification code');
      return res.status(400).json({
        message: 'Invalid verification code',
      });
    }

    // Подтверждаем email
    user.isEmailVerified = true;
    // @ts-ignore
    user.emailVerificationCode = null;
    // @ts-ignore
    user.emailVerificationExpires = null;
    await user.save();

    console.log('User email verified successfully:', email);

    return res.status(200).json({
      message: 'Email verified successfully',
    });
  } catch (error: any) {
    console.error('Error in verification endpoint:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
}
