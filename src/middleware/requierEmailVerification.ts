import { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import User from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function requireEmailVerification(
  req: NextApiRequest,
  res: NextApiResponse,
  next: () => void
) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = verify(token, JWT_SECRET) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: 'Email verification required. Please check your email to verify your account.',
        requiresVerification: true,
      });
    }

    // Add user to request for downstream middleware/handlers
    (req as any).user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
