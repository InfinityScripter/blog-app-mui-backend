import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { boardId } = req.query as { boardId: string };
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const { name } = req.body as { name: string };
  if (!name) return res.status(400).json({ message: 'name is required' });

  const posResult = await dbQuery<{ max: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS max FROM kanban_columns WHERE board_id = $1',
    [boardId]
  );
  const position = posResult.rows[0].max;
  const colId = uuidv4();
  await dbQuery(
    'INSERT INTO kanban_columns (id, board_id, name, position) VALUES ($1, $2, $3, $4)',
    [colId, boardId, name, position]
  );

  return res.status(201).json({ column: { id: colId, name, position, tasks: [] } });
}

export default requireAuth(handler);
