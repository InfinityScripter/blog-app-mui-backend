import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { buildNewPostPayload, buildPostPatchPayload } from '@/src/utils/post-payload';

// Business logic for the post domain. No HTTP — routes call these and map
// the result/throws to a response.

interface ListParams {
  role?: string;
  userId?: string;
}

/**
 * Returns posts scoped by caller:
 *  - admin           → all posts (any author/status)
 *  - regular user    → only their own posts (any status)
 *  - anonymous       → only published posts
 * Each post gets a derived totalComments field.
 */
async function listPosts({ role, userId }: ListParams) {
  let filter: Record<string, unknown>;
  if (role === 'admin') {
    filter = {};
  } else if (userId) {
    filter = { userId };
  } else {
    filter = { publish: 'published' };
  }

  const posts = await Post.find(filter).lean();
  return posts.map((post: any) => ({
    ...post,
    totalComments: post.comments ? post.comments.length : 0,
  }));
}

/**
 * Creates a post owned by `userId`, embedding the author snapshot. Throws
 * AppError 401 if the user no longer exists.
 */
async function createPost(userId: string, body: Record<string, any>) {
  const user = await User.findById(userId).select('name avatarURL');
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  const author = { name: user.name, avatarUrl: user.avatarURL };
  const payload = buildNewPostPayload(body, author, user._id);
  return Post.create(payload);
}

/** Loads a post and asserts the user owns it. Throws 401/404/403. */
async function loadOwnedPost(userId: string, postId: string) {
  const user = await User.findById(userId).select('name avatarURL');
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  const post = await Post.findById(postId);
  if (!post) {
    throw new AppError(HTTP.NOT_FOUND, 'Пост не найден');
  }
  if (post.userId.toString() !== String(user._id)) {
    throw new AppError(HTTP.FORBIDDEN, 'Нет доступа к данному посту');
  }
  return { user, post };
}

/** Deletes a post the user owns. */
async function deletePost(userId: string, postId: string) {
  await loadOwnedPost(userId, postId);
  await Post.findByIdAndDelete(postId);
}

/** Updates a post the user owns; returns the updated post. */
async function updatePost(userId: string, postId: string, body: Record<string, any>) {
  const { user, post } = await loadOwnedPost(userId, postId);
  const author = { name: user.name, avatarUrl: user.avatarURL };
  const updatedFields = buildPostPatchPayload(body, {
    author,
    coverUrlFallback: post.coverUrl,
    totalComments: post.comments.length,
  });
  const updated = await Post.findByIdAndUpdate(postId, updatedFields, { new: true });
  if (!updated) {
    throw new AppError(HTTP.NOT_FOUND, 'Пост не найден');
  }
  return updated;
}

interface SearchParams {
  query?: string;
  dashboard?: boolean;
  userId?: string;
}

/**
 * Searches posts by title (case-insensitive). In dashboard mode results are
 * scoped to the user's own posts (userId required); otherwise only published.
 */
async function searchPosts({ query, dashboard, userId }: SearchParams) {
  const filter: Record<string, unknown> = {};
  if (dashboard) {
    if (!userId) {
      throw new AppError(HTTP.UNAUTHORIZED, 'Отсутствует токен авторизации');
    }
    filter.userId = userId;
  } else {
    filter.publish = 'published';
  }
  const clean = (query ? `${query}` : '').toLowerCase().trim();
  if (clean !== '') {
    filter.title = { $regex: clean, $options: 'i' };
  }
  return Post.find(filter).lean();
}

/** Sets publish status ('draft' | 'published') on a post the user owns. */
async function setPublish(userId: string, postId: string, publish: string) {
  if (publish !== 'draft' && publish !== 'published') {
    throw new AppError(HTTP.BAD_REQUEST, 'Неверное значение поля publish');
  }
  const { post } = await loadOwnedPost(userId, postId);
  post.publish = publish;
  await post.save();
  return post;
}

/**
 * Atomically bumps a post's view counter. Single UPDATE so concurrent readers
 * never lose increments (no read-modify-write race). Returns the new count, or
 * null if the post doesn't exist. Public action — no ownership check.
 */
async function incrementViews(postId: string): Promise<number | null> {
  const result = await dbQuery<{ total_views: number }>(
    'UPDATE posts SET total_views = total_views + 1 WHERE id = $1 RETURNING total_views',
    [postId]
  );
  return result.rows[0]?.total_views ?? null;
}

export const postService = {
  listPosts,
  createPost,
  deletePost,
  updatePost,
  setPublish,
  searchPosts,
  incrementViews,
};
