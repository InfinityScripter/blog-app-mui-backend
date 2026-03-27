import type { IUser } from '@/src/models/User';

type PublicUser = Pick<
  IUser,
  | '_id'
  | 'id'
  | 'name'
  | 'email'
  | 'googleId'
  | 'avatarURL'
  | 'isEmailVerified'
  | 'createdAt'
  | 'updatedAt'
>;

export function toPublicUser(user: IUser): PublicUser {
  return {
    _id: user._id,
    id: user.id,
    name: user.name,
    email: user.email,
    googleId: user.googleId ?? null,
    avatarURL: user.avatarURL ?? null,
    isEmailVerified: user.isEmailVerified ?? false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
