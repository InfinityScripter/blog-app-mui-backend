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

export const kanbanService = { listBoards, createBoard };
