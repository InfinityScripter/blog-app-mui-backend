import type { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import passport from '../../../lib/passport';
import dbConnect from '../../../lib/db';

const handler = nextConnect<NextApiRequest, NextApiResponse>();

handler.use(async (req, res, next) => {
    await dbConnect();
    next();
});

// Инициирует аутентификацию через Google
handler.get(passport.authenticate('google', { scope: ['profile', 'email'] }));

export default handler;
