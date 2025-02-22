import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
import { sendVerificationEmail } from '../../../utils/email';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Генерируем новый 6-значный код
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Устанавливаем срок действия (24 часа)
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Сохраняем код и срок действия
    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = verificationExpires;
    await user.save();

    // Отправляем новый код на email
    await sendVerificationEmail(email, verificationCode);

    res.status(200).json({ message: 'Verification code sent successfully' });
  } catch (error: any) {
    console.error('[Resend Verification API]', error);
    res.status(500).json({
      message: 'Failed to resend verification code',
      error: error.message,
    });
  }
}
