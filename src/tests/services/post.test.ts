import '@jest/globals';
import User from '@/src/models/User';
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
    const posts = await postService.listPosts({});
    expect(posts.every((p: any) => p.publish === 'published')).toBe(true);
    expect(posts).toHaveLength(2);
  });

  it('admin → all posts regardless of author/status', async () => {
    const posts = await postService.listPosts({ role: 'admin', userId: 'someone' });
    expect(posts).toHaveLength(3);
  });

  it('regular user → only own posts (any status)', async () => {
    const posts = await postService.listPosts({ role: 'user', userId: 'user-a' });
    expect(posts).toHaveLength(2);
    expect(posts.every((p: any) => p.userId === 'user-a')).toBe(true);
  });

  it('attaches totalComments', async () => {
    const posts = await postService.listPosts({});
    expect(posts[0]).toHaveProperty('totalComments');
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
});
