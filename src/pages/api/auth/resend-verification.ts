import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { sendVerificationEmail } from '@/src/utils/email';
import { normalizeEmail } from '@/src/utils/normalize-email';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { email } = req.body;

    if (!email) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Email is required' });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'User not found' });
    }

    if (user.isEmailVerified) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Email is already verified' });
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
    await sendVerificationEmail(normalizedEmail, verificationCode);

    res.status(HTTP.OK).json({ message: 'Verification code sent successfully' });
  } catch (error: any) {
    console.error('[Resend Verification API]', error);
    res.status(HTTP.INTERNAL).json({
      message: 'Failed to resend verification code',
      error: error.message,
    });
  }
}
