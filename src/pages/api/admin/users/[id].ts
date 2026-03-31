import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { id } = req.query as { id: string };

  if (req.method === 'DELETE') {
    // Запретить удалять самого себя
    if (id === req.user!._id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    await dbQuery('DELETE FROM users WHERE id = $1', [id]);
    return res.status(200).json({ success: true, message: 'User deleted' });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(requireAdmin(handler));
