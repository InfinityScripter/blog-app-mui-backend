import type { NextApiRequest, NextApiResponse } from 'next';
import { sendVerificationEmail } from '../../../utils/email';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Включаем CORS
  await cors(req, res);

  // Проверяем метод
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  console.log('Request received:', {
    method: req.method,
    body: req.body,
    headers: req.headers,
  });

  try {
    const { email } = req.body;

    console.log('Parsed email:', email);

    if (!email) {
      console.log('Email is missing in request');
      return res.status(400).json({ message: 'Email is required' });
    }

    // Проверяем переменные окружения
    const envCheck = {
      EMAIL_SERVICE: process.env.EMAIL_SERVICE,
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ? 'Set' : 'Not set',
      FRONTEND_URL: process.env.FRONTEND_URL,
    };

    console.log('Environment variables:', envCheck);

    // Создаем тестовый токен
    const testToken = `test-token-${Date.now()}`;
    console.log('Generated test token:', testToken);

    // Отправляем тестовое письмо
    console.log('Attempting to send email...');
    const info = await sendVerificationEmail(email, testToken);
    console.log('Email sent successfully:', info);

    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      details: info,
    });
  } catch (error: any) {
    console.error('Error in test-email endpoint:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: {
        message: error.message,
        code: error.code,
        command: error.command,
      },
    });
  }
}
