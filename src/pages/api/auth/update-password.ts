import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
// @ts-ignore
import bcrypt from 'bcrypt';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { email, code, password } = req.body;

    console.log('Update password request:', {
      email,
      code,
      hasPassword: !!password,
    });

    if (!email || !code || !password) {
      return res.status(400).json({
        message: 'Email, verification code, and new password are required',
      });
    }

    const user = await User.findOne({
      email: email.trim(),
      passwordResetCode: code,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      console.log('Invalid reset attempt:', {
        email,
        code,
        found: !!user,
      });
      return res.status(400).json({
        message: 'Invalid or expired reset code',
      });
    }

    console.log('Valid reset code for user:', {
      email: user.email,
      resetCode: user.passwordResetCode,
      expiresAt: user.passwordResetExpires,
    });

    // Хэшируем новый пароль
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Обновляем пароль и очищаем код сброса
    user.passwordHash = passwordHash;
    // @ts-ignore
    user.passwordResetCode = null;
    // @ts-ignore
    user.passwordResetExpires = null;
    await user.save();

    console.log('Password updated successfully for user:', user.email);

    res.status(200).json({
      message: 'Password has been updated successfully',
    });
  } catch (error) {
    console.error('[Update Password API Error]:', error);
    res.status(500).json({
      message: 'Failed to update password. Please try again later.',
    });
  }
}
