import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
// @ts-ignore
import nodemailer from 'nodemailer';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { email } = req.body;

    console.log('Reset password request for email:', email);

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.trim() });
    if (!user) {
      return res.status(400).json({ message: 'No user found with that email' });
    }

    // Генерируем 6-значный код
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpires = new Date(Date.now() + 3600000); // 1 час

    // Сохраняем код и время истечения
    user.passwordResetCode = resetCode;
    user.passwordResetExpires = resetExpires;
    await user.save();

    console.log('Generated reset code for user:', {
      email: user.email,
      resetCode,
      expiresAt: resetExpires,
    });

    // Формируем ссылку для сброса пароля
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:7272';
    const resetLink = `${frontendUrl}/auth/update-password?email=${encodeURIComponent(email)}&code=${resetCode}`;

    // Настраиваем nodemailer
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Code',
      text: `Your password reset code is: ${resetCode}

Click the following link to reset your password:
${resetLink}

This link and code will expire in 1 hour.

If you did not request this code, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset</h2>
          <p>Your password reset code is:</p>
          <div style="background-color: #f4f4f4; padding: 15px; margin: 20px 0; font-size: 24px; text-align: center; letter-spacing: 5px;">
            ${resetCode}
          </div>
          <p>Click the following button to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #007bff;">
            ${resetLink}
          </p>
          <p>This link and code will expire in 1 hour.</p>
          <p style="color: #666; font-size: 14px;">If you did not request this code, please ignore this email.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('Reset code email sent to:', user.email);

    res.status(200).json({
      message: 'Password reset code has been sent to your email',
    });
  } catch (error) {
    console.error('[Reset Password API Error]:', error);
    res.status(500).json({
      message: 'Failed to send reset code. Please try again later.',
    });
  }
}
