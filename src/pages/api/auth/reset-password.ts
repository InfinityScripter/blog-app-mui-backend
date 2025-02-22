import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
// @ts-ignore
import nodemailer from 'nodemailer';
import cors from '../../../utils/cors';
import crypto from 'crypto';

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

    const user = await User.findOne({ email: email.trim() });
    if (!user) {
      return res.status(400).json({ message: 'No user found with that email' });
    }

    // Генерируем токен и устанавливаем срок действия (1 час)
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 час

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(resetExpires);
    await user.save();

    // Настраиваем nodemailer
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE, // например, 'gmail'
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    // Формируем ссылку для сброса пароля (замените FRONTEND_URL на ваш URL)
    const resetUrl = `${process.env.FRONTEND_URL}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset',
      text: `Вы получили это письмо, так как (или кто-то другой) запросил сброс пароля для вашей учётной записи.
Перейдите по следующей ссылке, чтобы сбросить пароль:
${resetUrl}

Если вы не запрашивали сброс, просто проигнорируйте это сообщение.`,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Password reset email sent' });
  } catch (error: any) {
    console.error('[Reset Password API]', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
