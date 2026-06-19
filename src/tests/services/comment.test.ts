import '@jest/globals';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { commentService } from '@/src/services/comment';

describe('commentService', () => {
  let postId: string;

  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({
      _id: 'author',
      name: 'Author',
      email: 'author@e.com',
      passwordHash: 'x',
      avatarURL: 'http://x/a.png',
    });
    await User.create({ _id: 'other', name: 'Other', email: 'other@e.com', passwordHash: 'x' });
    const post = await Post.create({ title: 'Post', userId: 'author', author: { name: 'Author' } });
    postId = post._id;
  });

  describe('addComment', () => {
    it('adds a top-level comment with author snapshot and bumps totalComments', async () => {
      const post = await commentService.addComment({
        userId: 'author',
        postId,
        message: 'Hello',
      });
      expect(post.comments).toHaveLength(1);
      expect(post.comments[0].message).toBe('Hello');
      expect(post.comments[0].name).toBe('Author');
      expect(post.comments[0].avatarUrl).toBe('http://x/a.png');
      expect(post.comments[0].userId).toBe('author');
      expect(post.totalComments).toBe(1);
    });

    it('adds a reply under an existing comment and counts it in totalComments', async () => {
      const withComment = await commentService.addComment({
        userId: 'author',
        postId,
        message: 'Top',
      });
      const parentId = withComment.comments[0].id;
      const post = await commentService.addComment({
        userId: 'other',
        postId,
        message: 'A reply',
        parentCommentId: parentId,
      });
      expect(post.comments[0].replyComment).toHaveLength(1);
      expect(post.comments[0].replyComment[0].message).toBe('A reply');
      expect(post.totalComments).toBe(2);
    });

    it('throws AppError 401 when the user does not exist', async () => {
      await expect(
        commentService.addComment({ userId: 'ghost', postId, message: 'x' })
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws AppError 404 when the post does not exist', async () => {
      await expect(
        commentService.addComment({ userId: 'author', postId: 'no-post', message: 'x' })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('throws AppError 400 when the message is empty', async () => {
      await expect(
        commentService.addComment({ userId: 'author', postId, message: '' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws AppError 404 when the parent comment does not exist', async () => {
      await expect(
        commentService.addComment({
          userId: 'author',
          postId,
          message: 'x',
          parentCommentId: 'missing',
        })
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('editComment', () => {
    let commentId: string;

    beforeEach(async () => {
      const post = await commentService.addComment({ userId: 'author', postId, message: 'Orig' });
      commentId = post.comments[0].id;
    });

    it('owner edits a top-level comment', async () => {
      const post = await commentService.editComment({
        userId: 'author',
        postId,
        commentId,
        message: 'Edited',
      });
      expect(post.comments[0].message).toBe('Edited');
    });

    it('non-owner editing → AppError 403', async () => {
      await expect(
        commentService.editComment({ userId: 'other', postId, commentId, message: 'Hack' })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('missing fields → AppError 400', async () => {
      await expect(
        commentService.editComment({ userId: 'author', postId, commentId: '', message: '' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('unknown comment → AppError 404', async () => {
      await expect(
        commentService.editComment({ userId: 'author', postId, commentId: 'nope', message: 'x' })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('owner edits a reply', async () => {
      const withReply = await commentService.addComment({
        userId: 'other',
        postId,
        message: 'Reply',
        parentCommentId: commentId,
      });
      const replyId = withReply.comments[0].replyComment[0].id;
      const post = await commentService.editComment({
        userId: 'other',
        postId,
        commentId: replyId,
        message: 'Reply edited',
        isReply: true,
        parentCommentId: commentId,
      });
      expect(post.comments[0].replyComment[0].message).toBe('Reply edited');
    });
  });

  describe('deleteComment', () => {
    let commentId: string;

    beforeEach(async () => {
      const post = await commentService.addComment({ userId: 'author', postId, message: 'Orig' });
      commentId = post.comments[0].id;
    });

    it('owner deletes a top-level comment', async () => {
      const post = await commentService.deleteComment({ userId: 'author', postId, commentId });
      expect(post.comments).toHaveLength(0);
      expect(post.totalComments).toBe(0);
    });

    it('non-owner deleting → AppError 403', async () => {
      await expect(
        commentService.deleteComment({ userId: 'other', postId, commentId })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('missing commentId → AppError 400', async () => {
      await expect(
        commentService.deleteComment({ userId: 'author', postId, commentId: '' })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('unknown comment → AppError 404', async () => {
      await expect(
        commentService.deleteComment({ userId: 'author', postId, commentId: 'nope' })
      ).rejects.toMatchObject({ status: 404 });
    });

    it('owner deletes a reply', async () => {
      const withReply = await commentService.addComment({
        userId: 'other',
        postId,
        message: 'Reply',
        parentCommentId: commentId,
      });
      const replyId = withReply.comments[0].replyComment[0].id;
      const post = await commentService.deleteComment({
        userId: 'other',
        postId,
        commentId: replyId,
        isReply: true,
        parentCommentId: commentId,
      });
      expect(post.comments[0].replyComment).toHaveLength(0);
    });
  });
});
