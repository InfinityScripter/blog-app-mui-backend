import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { commentService } from '@/src/services/comment';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth → commentService.{add,edit,delete} → respond.
// The frontend reads the returned `post`, so that key is preserved.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = String(req.user!._id);
  const { id: postId } = req.query as { id: string };

  try {
    if (req.method === HTTP_METHOD.POST) {
      const { message, parentCommentId, tagUser } = req.body;
      const post = await commentService.addComment({
        userId,
        postId,
        message,
        parentCommentId,
        tagUser,
      });
      emitAudit(req, {
        action: 'comment.created',
        targetType: 'comment',
        targetId: postId,
        metadata: { postId, isReply: Boolean(parentCommentId) },
      });
      return res.status(HTTP.OK).json({ message: 'Comment added successfully', post });
    }

    if (req.method === HTTP_METHOD.PUT) {
      const { commentId, message, isReply, parentCommentId } = req.body;
      const post = await commentService.editComment({
        userId,
        postId,
        commentId,
        message,
        isReply,
        parentCommentId,
      });
      emitAudit(req, {
        action: 'comment.updated',
        targetType: 'comment',
        targetId: commentId,
        metadata: { postId, isReply: Boolean(isReply) },
      });
      return res.status(HTTP.OK).json({ message: 'Comment updated successfully', post });
    }

    if (req.method === HTTP_METHOD.DELETE) {
      const { commentId, isReply, parentCommentId } = req.body;
      const post = await commentService.deleteComment({
        userId,
        postId,
        commentId,
        isReply,
        parentCommentId,
      });
      emitAudit(req, {
        action: 'comment.deleted',
        targetType: 'comment',
        targetId: commentId,
        metadata: { postId, isReply: Boolean(isReply) },
      });
      return res.status(HTTP.OK).json({ message: 'Comment deleted successfully', post });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
