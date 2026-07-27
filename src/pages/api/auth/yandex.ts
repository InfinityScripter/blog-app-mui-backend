import type { NextApiRequest, NextApiResponse } from 'next';

import { MSG } from '@/src/constants/messages';
import { issueOAuthState } from '@/src/lib/oauth-state';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireFeature } from '@/src/middlewares/require-feature';

const yandexClientId = process.env.YANDEX_CLIENT_ID || '';
const backendURL = process.env.BACKEND_URL || 'http://localhost:7272';
const redirectURI = process.env.YANDEX_REDIRECT_URI || `${backendURL}/api/auth/yandex/callback`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  if (!yandexClientId) {
    return res.status(HTTP.INTERNAL).json({ message: 'Yandex OAuth is not configured' });
  }

  const authorizeUrl = new URL('https://oauth.yandex.com/authorize');
  const state = issueOAuthState(req, res, 'yandex');

  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', yandexClientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectURI);
  authorizeUrl.searchParams.set('state', state);

  return res.redirect(authorizeUrl.toString());
}

export default requireFeature('pdCollection')(handler);
