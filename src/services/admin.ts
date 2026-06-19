import { dbQuery } from '@/src/lib/db';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the admin domain. No HTTP.

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  is_email_verified: boolean;
  is_locked: boolean;
  created_at: Date;
}

/** All users, newest first, mapped to the public-ish admin shape. */
async function listUsers() {
  const result = await dbQuery<UserRow>(
    `SELECT id, name, email, avatar_url, role, is_email_verified, is_locked, created_at
     FROM users ORDER BY created_at DESC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    avatarURL: row.avatar_url,
    role: row.role,
    isEmailVerified: row.is_email_verified,
    isLocked: row.is_locked,
    createdAt: row.created_at,
  }));
}

/** Deletes a user. An admin cannot delete their own account (AppError 400). */
async function deleteUser(adminId: string, targetId: string) {
  if (adminId === targetId) {
    throw new AppError(HTTP.BAD_REQUEST, 'Cannot delete your own account');
  }
  await dbQuery('DELETE FROM users WHERE id = $1', [targetId]);
}

export const adminService = { listUsers, deleteUser };
