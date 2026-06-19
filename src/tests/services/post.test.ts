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
