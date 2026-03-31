import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.query as { id: string };

  const eventResult = await dbQuery<{ created_by: string }>(
    'SELECT created_by FROM calendar_events WHERE id = $1',
    [id]
  );
  if (!eventResult.rows[0]) return res.status(404).json({ message: 'Event not found' });

  const canModify = eventResult.rows[0].created_by === userId || isAdmin;
  if (!canModify) return res.status(403).json({ message: 'Forbidden' });

  if (req.method === 'DELETE') {
    await dbQuery('DELETE FROM calendar_events WHERE id = $1', [id]);
    return res.status(200).json({ success: true });
  }

  if (req.method === 'PATCH') {
    const { title, description, color, start, end, allDay, type } = req.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (title !== undefined) {
      values.push(title);
      updates.push(`title = $${values.length}`);
    }
    if (description !== undefined) {
      values.push(description);
      updates.push(`description = $${values.length}`);
    }
    if (color !== undefined) {
      values.push(color);
      updates.push(`color = $${values.length}`);
    }
    if (start !== undefined) {
      values.push(start);
      updates.push(`start_date = $${values.length}`);
    }
    if (end !== undefined) {
      values.push(end);
      updates.push(`end_date = $${values.length}`);
    }
    if (allDay !== undefined) {
      values.push(allDay);
      updates.push(`all_day = $${values.length}`);
    }
    if (type !== undefined) {
      values.push(type);
      updates.push(`type = $${values.length}`);
    }

    if (!updates.length) return res.status(400).json({ message: 'No fields to update' });
    updates.push(`updated_at = NOW()`);
    values.push(id);
    await dbQuery(
      `UPDATE calendar_events SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
