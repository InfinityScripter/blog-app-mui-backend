import type { UpdateAvatarBody, UpdateProfileBody, ChangePasswordBody } from '@/src/schemas/user';

import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { SALT_ROUNDS } from '@/src/constants/auth';
import { toPublicUser } from '@/src/utils/public-user';

// Business logic for the authenticated user profile. No HTTP here — throws
// AppError on failure; routes map it via sendError().

/** Updates the caller's display name. Returns the public user. */
async function updateProfile(userId: string, { name }: UpdateProfileBody) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  user.name = name;
  await user.save();
  return toPublicUser(user);
}

/**
 * Verifies the current password against the stored hash and replaces it.
 * Distinct from the reset-by-code flow (auth/update-password) — this requires
 * the existing password, not an emailed reset code.
 */
async function changePassword(
  userId: string,
  { currentPassword, newPassword }: ChangePasswordBody
) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  if (!user.passwordHash) {
    // OAuth-only accounts have no local password to verify against.
    throw new AppError(HTTP.BAD_REQUEST, MSG.NO_PASSWORD_FOR_CHANGE);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.CURRENT_PASSWORD_INCORRECT);
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();
}

/** Persists an already-uploaded avatar URL onto the caller. Returns the public user. */
async function updateAvatar(userId: string, { avatarURL }: UpdateAvatarBody) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  user.avatarURL = avatarURL;
  await user.save();
  return toPublicUser(user);
}

/** Clears the caller's avatar (sets it to null). Returns the public user. */
async function removeAvatar(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  user.avatarURL = null;
  await user.save();
  return toPublicUser(user);
}

export const userService = { updateProfile, changePassword, updateAvatar, removeAvatar };
