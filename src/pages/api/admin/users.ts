import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    const result = await dbQuery<{
      id: string; name: string; email: string;
      avatar_url: string | null; role: string;
      is_email_verified: boolean; is_locked: boolean;
      created_at: Date;
    }>(
      'SELECT id, name, email, avatar_url, role, is_email_verified, is_locked, created_at FROM users ORDER BY created_at DESC'
    );
    const users = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      avatarURL: row.avatar_url,
      role: row.role,
      isEmailVerified: row.is_email_verified,
      isLocked: row.is_locked,
      createdAt: row.created_at,
    }));
    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export default requireAuth(requireAdmin(handler));
