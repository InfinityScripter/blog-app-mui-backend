import mongoose from 'mongoose';
import { IPost, Post } from '@/src/models/Post';

describe('Post Model', () => {
  it('should create a post successfully', async () => {
    const postData: Partial<IPost> = {
      title: 'Test Post',
      description: 'Test Description',
      content: 'Test Content',
      coverUrl: 'http://test.com/image.jpg',
      tags: ['test', 'jest'],
      metaTitle: 'Test Meta Title',
      metaDescription: 'Test Meta Description',
      metaKeywords: ['test', 'keywords'],
      publish: 'published',
      userId: new mongoose.Types.ObjectId().toString(),
      author: {
        name: 'Test Author',
        avatarUrl: 'http://test.com/avatar.jpg',
      },
    };

    const post = await Post.create(postData);
    expect(post._id).toBeDefined();
    expect(post.title).toBe(postData.title);
    expect(post.tags).toEqual(expect.arrayContaining(postData.tags || []));
    expect(post.author.name).toBe(postData.author?.name);
  });

  it('should update totalComments when comments are added', async () => {
    const postData: Partial<IPost> = {
      title: 'Test Post',
      description: 'Test Description',
      userId: new mongoose.Types.ObjectId().toString(),
      author: {
        name: 'Test Author',
      },
      comments: [],
    };

    const post = await Post.create(postData);
    expect(post.totalComments).toBe(0);

    // Add a comment
    post.comments.push({
      id: '1',
      userId: new mongoose.Types.ObjectId().toString(),
      name: 'Commenter',
      avatarUrl: 'http://test.com/commenter.jpg',
      message: 'Test comment',
      postedAt: new Date(),
      replyComment: [],
    });

    await post.save();
    expect(post.totalComments).toBe(1);
  });

  it('should validate required fields', async () => {
    try {
      await Post.create({});
      fail('Should not create a post without required fields');
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.name).toBe('ValidationError');
    }
  });
});
