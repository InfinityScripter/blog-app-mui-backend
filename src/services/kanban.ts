import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the kanban board domain. No HTTP — throws AppError.

interface BoardRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Date;
}

export interface Board {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
}

function mapBoard(r: BoardRow): Board {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Boards the given user is a member of, newest first. */
async function listBoards(userId: string): Promise<Board[]> {
  const result = await dbQuery<BoardRow>(
    `SELECT b.id, b.name, b.description, b.created_by, b.created_at
     FROM kanban_boards b
     JOIN kanban_board_members bm ON bm.board_id = b.id AND bm.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapBoard);
}

interface CreateBoardParams {
  userId: string;
  role?: string;
  name: string;
  description?: string;
  memberIds?: string[];
}

/** Admin-only board creation; creator + memberIds become board members. */
async function createBoard({ userId, role, name, description, memberIds = [] }: CreateBoardParams) {
  if (role !== 'admin') {
    throw new AppError(HTTP.FORBIDDEN, 'Only admins can create boards');
  }
  if (!name) {
    throw new AppError(HTTP.BAD_REQUEST, 'name is required');
  }

  const boardId = uuidv4();
  await dbQuery(
    'INSERT INTO kanban_boards (id, name, description, created_by) VALUES ($1, $2, $3, $4)',
    [boardId, name, description ?? null, userId]
  );

  const allMembers = Array.from(new Set([userId, ...memberIds]));
  await Promise.all(
    allMembers.map((memberId) =>
      dbQuery('INSERT INTO kanban_board_members (board_id, user_id) VALUES ($1, $2)', [
        boardId,
        memberId,
      ])
    )
  );

  return { id: boardId, name, description };
}

/** Full board (columns + their tasks) — caller must be a board member. */
async function getBoard(userId: string, boardId: string) {
  const member = await dbQuery(
    'SELECT 1 FROM kanban_board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (!member.rows.length) {
    throw new AppError(HTTP.FORBIDDEN, 'Forbidden');
  }

  const cols = await dbQuery<{ id: string; name: string; position: number }>(
    'SELECT id, name, position FROM kanban_columns WHERE board_id = $1 ORDER BY position ASC',
    [boardId]
  );

  const columns = await Promise.all(
    cols.rows.map(async (col) => {
      const tasks = await dbQuery<{
        id: string;
        title: string;
        description: string | null;
        assignees: unknown[];
        labels: unknown[];
        due_date: Date | null;
        position: number;
        created_by: string;
        created_at: Date;
      }>(
        `SELECT id, title, description, assignees, labels, due_date, position, created_by, created_at
         FROM kanban_tasks WHERE column_id = $1 ORDER BY position ASC`,
        [col.id]
      );
      return {
        id: col.id,
        name: col.name,
        position: col.position,
        tasks: tasks.rows.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assignees: t.assignees,
          labels: t.labels,
          dueDate: t.due_date,
          position: t.position,
          createdBy: t.created_by,
          createdAt: t.created_at,
        })),
      };
    })
  );

  return { id: boardId, columns };
}

/** Deletes a board (cascades to columns/tasks via FK). */
async function deleteBoard(boardId: string) {
  await dbQuery('DELETE FROM kanban_boards WHERE id = $1', [boardId]);
}

/** Appends a column to a board at the next position. */
async function addColumn(boardId: string, name: string) {
  if (!name) {
    throw new AppError(HTTP.BAD_REQUEST, 'name is required');
  }
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
  return { id: colId, name, position, tasks: [] as unknown[] };
}

export const kanbanService = { listBoards, createBoard, getBoard, deleteBoard, addColumn };
