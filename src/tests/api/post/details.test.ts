import '@jest/globals';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/details';
import { HTTP_METHOD } from '@/src/constants/http';
import { commentService } from '@/src/services/comment';

const AUTHOR_ID = '7060694b2c21843bf8307f99';
const REPLIER_ID = '7060694b2c21843bf8307f00';

describe('GET /api/post/details', () => {
  let postId: string;

  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({ _id: AUTHOR_ID, name: 'Author', email: 'a@e.com', passwordHash: 'x' });
    await User.create({
      _id: REPLIER_ID,
      name: 'Replier',
      email: 'r@e.com',
      passwordHash: 'x',
      avatarURL: 'http://x/r.png',
    });
    const post = await Post.create({
      title: 'Post',
      publish: 'published',
      userId: AUTHOR_ID,
      author: { name: 'Author' },
    });
    postId = post._id;
    // Seed a top-level comment, then a reply from a different user.
    const withComment = await commentService.addComment({
      userId: AUTHOR_ID,
      postId,
      message: 'Top',
    });
    await commentService.addComment({
      userId: REPLIER_ID,
      postId,
      message: 'A reply',
      parentCommentId: withComment.comments[0].id,
    });
  });

  it('populates reply author name/avatar (batched lookup) on the returned post', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { id: postId } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { post } = JSON.parse(res._getData());
    const reply = post.comments[0].replyComment[0];
    expect(reply.userName).toBe('Replier');
    expect(reply.userAvatar).toBe('http://x/r.png');
  });

  it('404 for an unknown id', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { id: 'nope' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});
