import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { setAuthCookies } from '@/src/lib/cookies';
import { issueSession } from '@/src/services/session';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { normalizeEmail } from '@/src/utils/normalize-email';
import { requireFeature } from '@/src/middlewares/require-feature';
import {
  createOAuthConsentChallenge,
  requiresOAuthConsentChallenge,
} from '@/src/services/oauth-consent';

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  if (!yandexClientId || !yandexClientSecret) {
    return res.status(HTTP.INTERNAL).json({ message: 'Yandex OAuth is not configured' });
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
      method: HTTP_METHOD.POST,
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
      method: HTTP_METHOD.GET,
    });

    if (!userResponse.ok) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_userinfo`);
    }

    const profile = (await userResponse.json()) as YandexUserResponse;
    const rawEmail = profile.default_email;

    if (!rawEmail) {
      return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_email`);
    }
    const email = normalizeEmail(rawEmail);

    const avatarURL = profile.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
      : null;

    const displayName = profile.real_name || profile.display_name || email;

    const existingByEmail = await User.findOne({ email });
    const user = existingByEmail;

    if (requiresOAuthConsentChallenge(user)) {
      const consentToken = await createOAuthConsentChallenge({
        provider: 'yandex',
        providerUserId: profile.id,
        email,
        name: displayName,
        avatarURL,
      });
      return res.redirect(
        `${frontendURL}/auth/oauth-consent#token=${encodeURIComponent(consentToken)}`
      );
    }

    if (!user) {
      throw new Error('OAuth consent challenge invariant violated');
    }
    user.yandexId = profile.id;
    user.isEmailVerified = true;
    if (!user.avatarURL && avatarURL) {
      user.avatarURL = avatarURL;
    }
    if (!user.name) {
      user.name = displayName;
    }
    await user.save();

    // Mint access+refresh, set httpOnly cookies, redirect WITHOUT a token in the
    // URL. Cookies are scoped to this API origin (where the SPA's XHRs go). The
    // earlier oauth_state clear Set-Cookie is preserved (setAuthCookies appends).
    const session = await issueSession({
      userId: user.id,
      role: user.role ?? 'user',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setAuthCookies(req, res, session);

    return res.redirect(`${frontendURL}/auth/success`);
  } catch (e) {
    // Keep codes/profile/tokens out of logs; the message is enough to find the stage.
    // eslint-disable-next-line no-console
    console.error(
      '[oauth.yandex.callback] authentication failed',
      e instanceof Error ? e.message : 'unknown error'
    );
    return res.redirect(`${frontendURL}/auth/jwt/sign-in?oauthError=yandex_unknown`);
  }
}

export default requireFeature('pdCollection')(handler);
