import dotenv from 'dotenv';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

import { User } from '../models/User';

dotenv.config();

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            callbackURL: '/api/auth/google/callback',
            proxy: true,
            scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails && profile.emails[0].value;
                if (!email) {
                    return done(new Error('Email не найден в профиле'), null);
                }
                const user = await User.findOne({ email });
                if (user) {
                    user.googleId = profile.id;
                    user.isEmailVerified = true;
                    if (!user.avatarURL && profile.photos && profile.photos[0]) {
                        user.avatarURL = profile.photos[0].value;
                    }
                    await user.save();
                    return done(null, user);
                }
                const newUser = new User({
                    email,
                    name: profile.displayName,
                    googleId: profile.id,
                    isEmailVerified: true,
                    avatarURL: profile.photos ? profile.photos[0].value : undefined,
                });
                await newUser.save();
                return done(null, newUser);
            } catch (err) {
                return done(err, null);
            }
        }
    )
);

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

export default passport;
