import type { IUser } from '@/src/models/User';

type PublicUser = Pick<
  IUser,
  | '_id'
  | 'id'
  | 'name'
  | 'email'
  | 'googleId'
  | 'yandexId'
  | 'avatarURL'
  | 'isEmailVerified'
  | 'role'
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
    yandexId: user.yandexId ?? null,
    avatarURL: user.avatarURL ?? null,
    isEmailVerified: user.isEmailVerified ?? false,
    role: user.role ?? 'user',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
