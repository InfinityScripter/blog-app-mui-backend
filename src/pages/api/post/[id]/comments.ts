import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { commentService } from '@/src/services/comment';

// Thin route: requireAuth → commentService.{add,edit,delete} → respond.
// The frontend reads the returned `post`, so that key is preserved.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = String(req.user!._id);
  const { id: postId } = req.query as { id: string };

  try {
    if (req.method === 'POST') {
      const { message, parentCommentId, tagUser } = req.body;
      const post = await commentService.addComment({
        userId,
        postId,
        message,
        parentCommentId,
        tagUser,
      });
      return res.status(HTTP.OK).json({ message: 'Comment added successfully', post });
    }

    if (req.method === 'PUT') {
      const { commentId, message, isReply, parentCommentId } = req.body;
      const post = await commentService.editComment({
        userId,
        postId,
        commentId,
        message,
        isReply,
        parentCommentId,
      });
      return res.status(HTTP.OK).json({ message: 'Comment updated successfully', post });
    }

    if (req.method === 'DELETE') {
      const { commentId, isReply, parentCommentId } = req.body;
      const post = await commentService.deleteComment({
        userId,
        postId,
        commentId,
        isReply,
        parentCommentId,
      });
      return res.status(HTTP.OK).json({ message: 'Comment deleted successfully', post });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
