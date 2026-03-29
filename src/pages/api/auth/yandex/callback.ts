import type { NextApiRequest, NextApiResponse } from 'next';

import { sign, type SignOptions } from 'jsonwebtoken';

import dbConnect from '../../../../lib/db';
import User from '../../../../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

const yandexClientId = process.env.YANDEX_CLIENT_ID || '';
const yandexClientSecret = process.env.YANDEX_CLIENT_SECRET || '';
const backendURL = process.env.BACKEND_URL || 'http://localhost:7272';
const redirectURI = process.env.YANDEX_REDIRECT_URI || `${backendURL}/api/auth/yandex/callback`;

type YandexTokenResponse = {
  access_token: string;
};

type YandexUserResponse = {
  default_avatar_id?: string;
  default_email?: string;
  display_name?: string;
  id: string;
  real_name?: string;
};

const getCookieValue = (cookieHeader: string | undefined, key: string) => {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.split('=').slice(1).join('='));
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!yandexClientId || !yandexClientSecret) {
    return res.status(500).json({ message: 'Yandex OAuth is not configured' });
  }

  const { code, error, state } = req.query;
  const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3033';

  if (error) {
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_denied`);
  }

  if (!code || Array.isArray(code)) {
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_no_code`);
  }

  if (!state || Array.isArray(state)) {
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_state`);
  }

  const expectedState = getCookieValue(req.headers.cookie, 'oauth_state_yandex');
  res.setHeader('Set-Cookie', 'oauth_state_yandex=; Max-Age=0; Path=/api/auth/yandex/callback');

  if (!expectedState || expectedState !== state) {
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_state`);
  }

  try {
    await dbConnect();

    const tokenResponse = await fetch('https://oauth.yandex.com/token', {
      body: new URLSearchParams({
        client_id: yandexClientId,
        client_secret: yandexClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectURI,
      }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!tokenResponse.ok) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_token`);
    }

    const tokenData = (await tokenResponse.json()) as YandexTokenResponse;
    const yandexAccessToken = tokenData.access_token;

    if (!yandexAccessToken) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_token`);
    }

    const userResponse = await fetch('https://login.yandex.ru/info?format=json', {
      headers: {
        Authorization: `OAuth ${yandexAccessToken}`,
      },
      method: 'GET',
    });

    if (!userResponse.ok) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_userinfo`);
    }

    const profile = (await userResponse.json()) as YandexUserResponse;
    const email = profile.default_email;

    if (!email) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_email`);
    }

    const avatarURL = profile.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
      : null;

    const displayName = profile.real_name || profile.display_name || email;

    const existingByEmail = await User.findOne({ email });
    let user = existingByEmail;

    if (user) {
      user.yandexId = profile.id;
      user.isEmailVerified = true;
      if (!user.avatarURL && avatarURL) {
        user.avatarURL = avatarURL;
      }
      if (!user.name) {
        user.name = displayName;
      }
      await user.save();
    } else {
      user = await User.create({
        avatarURL: avatarURL ?? undefined,
        email,
        isEmailVerified: true,
        name: displayName,
        yandexId: profile.id,
      });
    }

    const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.redirect(`${frontendURL}/auth/success?token=${encodeURIComponent(token)}`);
  } catch (e) {
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_unknown`);
  }
}
