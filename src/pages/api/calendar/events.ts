import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  if (req.method === 'GET') {
    const result = await dbQuery<{
      id: string;
      title: string;
      description: string | null;
      color: string;
      start_date: Date;
      end_date: Date;
      all_day: boolean;
      type: string;
      created_by: string;
    }>(
      `SELECT id, title, description, color, start_date, end_date, all_day, type, created_by
       FROM calendar_events
       WHERE type = 'public' OR created_by = $1
       ORDER BY start_date ASC`,
      [userId]
    );
    const events = result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      color: r.color,
      start: r.start_date,
      end: r.end_date,
      allDay: r.all_day,
      type: r.type,
      createdBy: r.created_by,
    }));
    return res.status(200).json({ events });
  }

  if (req.method === 'POST') {
    const { title, description, color = 'primary', start, end, allDay = false, type } = req.body;
    if (!title || !start || !end || !type) {
      return res.status(400).json({ message: 'title, start, end, type are required' });
    }
    const id = uuidv4();
    await dbQuery(
      'INSERT INTO calendar_events (id, title, description, color, start_date, end_date, all_day, type, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, title, description ?? null, color, start, end, allDay, type, userId]
    );
    return res.status(201).json({ event: { id, title, start, end, allDay, type, color } });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
