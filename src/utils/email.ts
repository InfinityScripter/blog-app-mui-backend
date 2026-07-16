import nodemailer from 'nodemailer';

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
  logger: true, // Включаем логирование
});

// Проверяем конфигурацию при инициализации
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

export const sendVerificationEmail = async (email: string, code: string) => {
  console.log('Attempting to send verification email to:', email);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationUrl = `${frontendUrl}/auth/verify?email=${encodeURIComponent(email)}&code=${code}`;

  const mailOptions = {
    from: {
      name: 'Blog App Support',
      address: process.env.EMAIL_USER as string,
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
      address: process.env.EMAIL_USER as string,
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

// Newsletter (double-opt-in) confirmation email. Sends a link to the frontend
// confirm page — trailing slash matters (FE has trailingSlash: true).
export const sendConfirmEmail = async (email: string, confirmToken: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const fromAddress = process.env.EMAIL_USER || '';
  const confirmUrl = `${frontendUrl}/newsletter/confirm/?token=${encodeURIComponent(confirmToken)}`;

  const mailOptions = {
    from: { name: 'AI First — рассылка', address: fromAddress },
    to: email,
    subject: 'Подтвердите подписку на рассылку',
    html: `
      <h1>Подтвердите подписку</h1>
      <p>Вы подписались на еженедельную рассылку с честными разборами AI. Осталось подтвердить адрес.</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${confirmUrl}"
           style="background-color: #4CAF50;
                  color: white;
                  padding: 14px 20px;
                  text-decoration: none;
                  border-radius: 4px;
                  display: inline-block;">
          Подтвердить подписку
        </a>
      </div>
      <p>Ссылка действует 24 часа.</p>
      <p>Если вы не подписывались, просто проигнорируйте это письмо.</p>
      <p style="color: #666; font-size: 12px;">Если кнопка не работает, скопируйте ссылку в браузер:</p>
      <p style="color: #666; font-size: 12px; word-break: break-all;">${confirmUrl}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Confirm email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending confirm email:', error);
    throw error;
  }
};

// Newsletter digest email. Sends the pre-rendered html as-is and appends a
// per-recipient unsubscribe footer (the bot ships one shared html; the working
// unsubscribe link is added here from each recipient's own token).
export const sendDigestEmail = async (
  email: string,
  subject: string,
  html: string,
  unsubscribeToken?: string
) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const fromAddress = process.env.EMAIL_USER || '';

  const unsubscribeFooter = unsubscribeToken
    ? `
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;" />
      <p style="color: #999; font-size: 12px; text-align: center;">
        Вы получили это письмо, потому что подписались на рассылку.
        <a href="${frontendUrl}/newsletter/unsubscribe/?token=${encodeURIComponent(unsubscribeToken)}"
           style="color: #999;">Отписаться</a>.
      </p>
    `
    : '';

  const mailOptions = {
    from: { name: 'AI First — рассылка', address: fromAddress },
    to: email,
    subject,
    html: `${html}${unsubscribeFooter}`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Digest email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending digest email:', error);
    throw error;
  }
};
