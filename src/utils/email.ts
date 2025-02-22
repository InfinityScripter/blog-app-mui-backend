import nodemailer from 'nodemailer';

// Функция для генерации 6-значного кода
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Создаем транспорт с подробным логированием
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true для 465 порта, false для других портов
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  debug: true, // Включаем отладку
  logger: true // Включаем логирование
});

// Проверяем конфигурацию при инициализации
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

export const sendVerificationEmail = async (email: string, code: string) => {
  console.log('Attempting to send verification email to:', email);
  console.log('Using verification code:', code);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationUrl = `${frontendUrl}/auth/verify?email=${encodeURIComponent(email)}&code=${code}`;

  const mailOptions = {
    from: {
      name: 'Blog App Support',
      address: process.env.EMAIL_USER as string
    },
    to: email,
    subject: 'Email Verification',
    html: `
      <h1>Verify Your Email</h1>
      <p>Please use the verification code below to verify your email address:</p>
      <h2 style="font-size: 24px; padding: 10px; background-color: #f5f5f5; text-align: center; letter-spacing: 5px;">${code}</h2>
      <p>Or click the button below to verify your email address:</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${verificationUrl}" 
           style="background-color: #4CAF50; 
                  color: white; 
                  padding: 14px 20px; 
                  text-decoration: none; 
                  border-radius: 4px; 
                  display: inline-block;">
          Verify Email
        </a>
      </div>
      <p>This code will expire in 24 hours.</p>
      <p>If you didn't request this verification, you can safely ignore this email.</p>
      <p style="color: #666; font-size: 12px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
      <p style="color: #666; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
};

export const sendPasswordResetEmail = async (email: string, code: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/auth/reset-password?code=${code}`;

  const mailOptions = {
    from: {
      name: 'Blog App Support',
      address: process.env.EMAIL_USER as string
    },
    to: email,
    subject: 'Password Reset Request',
    html: `
      <h1>Reset Your Password</h1>
      <p>You requested to reset your password. Please use the code below:</p>
      <h2 style="font-size: 24px; padding: 10px; background-color: #f5f5f5; text-align: center; letter-spacing: 5px;">${code}</h2>
      <p>Or click the button below to reset your password:</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${resetUrl}" 
           style="background-color: #4CAF50; 
                  color: white; 
                  padding: 14px 20px; 
                  text-decoration: none; 
                  border-radius: 4px; 
                  display: inline-block;">
          Reset Password
        </a>
      </div>
      <p>This code will expire in 1 hour.</p>
      <p>If you didn't request this password reset, you can safely ignore this email.</p>
      <p style="color: #666; font-size: 12px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
      <p style="color: #666; font-size: 12px; word-break: break-all;">${resetUrl}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};
