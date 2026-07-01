import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { postService } from '@/src/services/post';

describe('postService.listPosts', () => {
  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({ _id: 'user-a', name: 'A', email: 'a@e.com', passwordHash: 'x' });
    await User.create({ _id: 'user-b', name: 'B', email: 'b@e.com', passwordHash: 'x' });
    await Post.create({
      title: 'Pub by A',
      userId: 'user-a',
      publish: 'published',
      author: { name: 'A' },
    });
    await Post.create({
      title: 'Draft by A',
      userId: 'user-a',
      publish: 'draft',
      author: { name: 'A' },
    });
    await Post.create({
      title: 'Pub by B',
      userId: 'user-b',
      publish: 'published',
      author: { name: 'B' },
    });
  });

  it('anonymous → only published posts', async () => {
    const { posts, total, hasMore } = await postService.listPosts({});
    expect(posts.every((p: any) => p.publish === 'published')).toBe(true);
    expect(posts).toHaveLength(2);
    // Default (unpaginated) path: no pagination metadata.
    expect(total).toBeUndefined();
    expect(hasMore).toBeUndefined();
  });

  it('admin → all posts regardless of author/status', async () => {
    const { posts } = await postService.listPosts({ role: 'admin', userId: 'someone' });
    expect(posts).toHaveLength(3);
  });

  it('regular user → only own posts (any status)', async () => {
    const { posts } = await postService.listPosts({ role: 'user', userId: 'user-a' });
    expect(posts).toHaveLength(2);
    expect(posts.every((p: any) => p.userId === 'user-a')).toBe(true);
  });

  it('attaches totalComments', async () => {
    const { posts } = await postService.listPosts({});
    expect(posts[0]).toHaveProperty('totalComments');
  });

  it('page 1 limit 2 → 2 items, total 3, hasMore true (admin)', async () => {
    const { posts, total, hasMore } = await postService.listPosts({
      role: 'admin',
      userId: 'someone',
      page: 1,
      limit: 2,
    });
    expect(posts).toHaveLength(2);
    expect(total).toBe(3);
    expect(hasMore).toBe(true);
  });

  it('last page → hasMore false (admin)', async () => {
    const { posts, total, hasMore } = await postService.listPosts({
      role: 'admin',
      userId: 'someone',
      page: 2,
      limit: 2,
    });
    expect(posts).toHaveLength(1);
    expect(total).toBe(3);
    expect(hasMore).toBe(false);
  });

  it('paginated page 1 returns the NEWEST rows (created_at DESC), not the oldest', async () => {
    // Stamp deterministic, distinct timestamps so the sort is verifiable.
    await dbQuery(`UPDATE posts SET created_at = '2020-01-01T00:00:00Z' WHERE title = 'Pub by A'`);
    await dbQuery(
      `UPDATE posts SET created_at = '2020-06-01T00:00:00Z' WHERE title = 'Draft by A'`
    );
    await dbQuery(`UPDATE posts SET created_at = '2021-01-01T00:00:00Z' WHERE title = 'Pub by B'`);

    const { posts } = await postService.listPosts({
      role: 'admin',
      userId: 'someone',
      page: 1,
      limit: 1,
    });
    // Newest is 'Pub by B' (2021) — the OLD default-ASC slice would have returned 'Pub by A' (2020).
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('Pub by B');
  });

  it('default (unpaginated) path keeps created_at ASC order', async () => {
    await dbQuery(`UPDATE posts SET created_at = '2020-01-01T00:00:00Z' WHERE title = 'Pub by A'`);
    await dbQuery(`UPDATE posts SET created_at = '2021-01-01T00:00:00Z' WHERE title = 'Pub by B'`);

    const { posts } = await postService.listPosts({ role: 'admin', userId: 'someone' });
    const titles = posts.map((p: any) => p.title);
    // Oldest first — the FE sorts the full array client-side.
    expect(titles.indexOf('Pub by A')).toBeLessThan(titles.indexOf('Pub by B'));
  });
});

describe('postService.createPost', () => {
  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({
      _id: 'author-1',
      name: 'Author One',
      email: 'author@e.com',
      passwordHash: 'x',
      avatarURL: 'http://x/a.png',
    });
  });

  it('creates a post owned by the user with the author embedded', async () => {
    const post = await postService.createPost('author-1', {
      title: 'My Post',
      content: '<p>hi</p>',
      publish: 'draft',
    });
    expect(post.title).toBe('My Post');
    expect(post.userId).toBe('author-1');
    expect(post.author.name).toBe('Author One');
  });

  it('throws AppError 401 when the user does not exist', async () => {
    await expect(postService.createPost('ghost', { title: 'X' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('postService.deletePost / updatePost', () => {
  let postId: string;

  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({ _id: 'owner', name: 'Owner', email: 'o@e.com', passwordHash: 'x' });
    await User.create({ _id: 'intruder', name: 'Intruder', email: 'i@e.com', passwordHash: 'x' });
    const post = await postService.createPost('owner', { title: 'Mine', content: 'c' });
    postId = post._id;
  });

  it('deletePost: owner can delete', async () => {
    await postService.deletePost('owner', postId);
    expect(await Post.findById(postId)).toBeNull();
  });

  it('deletePost: non-owner → AppError 403', async () => {
    await expect(postService.deletePost('intruder', postId)).rejects.toMatchObject({ status: 403 });
  });

  it('deletePost: missing post → AppError 404', async () => {
    await expect(postService.deletePost('owner', 'no-such-id')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('updatePost: owner can update title', async () => {
    const updated = await postService.updatePost('owner', postId, { title: 'Renamed' });
    expect(updated.title).toBe('Renamed');
  });

  it('updatePost: non-owner → AppError 403', async () => {
    await expect(
      postService.updatePost('intruder', postId, { title: 'Hack' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('setPublish: owner toggles to published', async () => {
    const post = await postService.setPublish('owner', postId, 'published');
    expect(post.publish).toBe('published');
  });

  it('setPublish: invalid value → AppError 400', async () => {
    await expect(postService.setPublish('owner', postId, 'bogus')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('setPublish: non-owner → AppError 403', async () => {
    await expect(postService.setPublish('intruder', postId, 'draft')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('searchPosts: public mode returns only published matching the query', async () => {
    await postService.setPublish('owner', postId, 'published');
    const results = await postService.searchPosts({ query: 'Mine' });
    expect(results.every((p: any) => p.publish === 'published')).toBe(true);
    expect(results.some((p: any) => p.title === 'Mine')).toBe(true);
  });

  it('searchPosts: dashboard mode without userId → AppError 401', async () => {
    await expect(postService.searchPosts({ dashboard: true })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('searchPosts: dashboard mode scopes to the user own posts', async () => {
    const results = await postService.searchPosts({ dashboard: true, userId: 'owner' });
    expect(results.every((p: any) => p.userId === 'owner')).toBe(true);
  });
});
