import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { columnId } = req.query as { columnId: string };

  if (req.method === 'DELETE') {
    await dbQuery('DELETE FROM kanban_columns WHERE id = $1', [columnId]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
