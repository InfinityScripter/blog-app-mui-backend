import { z } from 'zod';

// Request body schemas for the authenticated user-profile endpoints.

// Display name: trimmed, non-empty, capped at a reasonable length.
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// Password change: current password is verified against the stored hash by the
// service; newPassword follows the same min length as sign-up (>= 6).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// Avatar URL is produced by the separate /api/file upload endpoint; this just
// persists the resulting non-empty string onto the user.
export const updateAvatarSchema = z.object({
  avatarURL: z.string().trim().min(1).max(2048),
});

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type UpdateAvatarBody = z.infer<typeof updateAvatarSchema>;
