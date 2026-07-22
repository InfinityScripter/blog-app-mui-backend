import type { Profile, VerifyCallback } from 'passport-google-oauth20';

import dotenv from 'dotenv';
import passport from 'passport';
import User from '@/src/models/User';
import { normalizeEmail } from '@/src/utils/normalize-email';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import {
  createOAuthConsentChallenge,
  requiresOAuthConsentChallenge,
} from '@/src/services/oauth-consent';

dotenv.config();
const backendURL = process.env.BACKEND_URL || 'http://localhost:7272';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: `${backendURL}/api/auth/google/callback`,
      proxy: true,
      scope: ['profile', 'email'],
    },
    async (accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => {
      try {
        const rawEmail = profile.emails && profile.emails[0].value;
        if (!rawEmail) {
          return done(new Error('Email не найден в профиле'));
        }
        const email = normalizeEmail(rawEmail);
        const user = await User.findOne({ email });
        if (user) {
          if (requiresOAuthConsentChallenge(user)) {
            const consentToken = await createOAuthConsentChallenge({
              provider: 'google',
              providerUserId: profile.id,
              email,
              name: profile.displayName || email,
              avatarURL: profile.photos?.[0]?.value,
            });
            return done(null, false, { message: 'oauth_consent_required', consentToken });
          }
          user.googleId = profile.id;
          user.isEmailVerified = true;
          if (!user.avatarURL && profile.photos && profile.photos[0]) {
            user.avatarURL = profile.photos[0].value;
          }
          await user.save();
          return done(null, user);
        }
        const consentToken = await createOAuthConsentChallenge({
          provider: 'google',
          providerUserId: profile.id,
          email,
          name: profile.displayName || email,
          avatarURL: profile.photos?.[0]?.value,
        });
        return done(null, false, { message: 'oauth_consent_required', consentToken });
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, (user as { id?: string; _id?: string }).id ?? (user as { _id?: string })._id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

export default passport;
