import { Post } from '@/src/models/Post';

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

export const postService = { listPosts };
