import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { buildNewPostPayload } from '@/src/utils/post-payload';

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

export const postService = { listPosts, createPost };
