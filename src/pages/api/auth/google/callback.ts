// src/pages/api/auth/google/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';

import dotenv from 'dotenv';
// @ts-ignore
import passport from 'passport';
import { sign } from 'jsonwebtoken';
import nextConnect from 'next-connect';

import dbConnect from '../../../../lib/db';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

const handler = nextConnect<NextApiRequest, NextApiResponse>();

handler.use(async (req, res, next) => {
    await dbConnect();
    next();
});

handler.get(
    passport.authenticate('google', { session: false }),
    (req: any, res) => {
        // При успешной аутентификации создаём JWT и перенаправляем на фронтенд
        const {user} = req;
        const token = sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendURL}/auth/success?token=${token}`);
    }
);

export default handler;
