import type { NextApiRequest, NextApiResponse } from 'next';

import { randomBytes } from 'crypto';

import cors from '../../../utils/cors';

const yandexClientId = process.env.YANDEX_CLIENT_ID || '';
const backendURL = process.env.BACKEND_URL || 'http://localhost:7272';
const redirectURI = process.env.YANDEX_REDIRECT_URI || `${backendURL}/api/auth/yandex/callback`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!yandexClientId) {
    return res.status(500).json({ message: 'Yandex OAuth is not configured' });
  }

  const authorizeUrl = new URL('https://oauth.yandex.com/authorize');
  const state = randomBytes(16).toString('hex');

  res.setHeader(
    'Set-Cookie',
    `oauth_state_yandex=${state}; Max-Age=600; Path=/api/auth/yandex/callback; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );

  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', yandexClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectURI);
  authorizeUrl.searchParams.set('state', state);

  return res.redirect(authorizeUrl.toString());
}
