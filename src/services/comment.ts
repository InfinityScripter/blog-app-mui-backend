import User from '@/src/models/User';
import uuidv4 from '@/src/utils/uuidv4';
import { Post } from '@/src/models/Post';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

// Business logic for the comment domain (comments are embedded in posts).
// No HTTP — routes call these and map the result/throws to a response.

interface AddParams {
  userId: string;
  postId: string;
  message: string;
  parentCommentId?: string;
  tagUser?: string;
}

interface EditParams {
  userId: string;
  postId: string;
  commentId: string;
  message: string;
  isReply?: boolean;
  parentCommentId?: string;
}

interface DeleteParams {
  userId: string;
  postId: string;
  commentId: string;
  isReply?: boolean;
  parentCommentId?: string;
}

/** Loads the comment author and the target post; throws 401/404. */
async function loadUserAndPost(userId: string, postId: string) {
  const user = await User.findOne({ _id: String(userId) });
  if (!user) {
    throw new AppError(HTTP.UNAUTHORIZED, MSG.USER_NOT_FOUND);
  }
  const post = await Post.findOne({ _id: postId });
  if (!post) {
    throw new AppError(HTTP.NOT_FOUND, 'Post not found');
  }
  return { user, post };
}

/** Adds a top-level comment, or a reply when parentCommentId is given. */
async function addComment({ userId, postId, message, parentCommentId, tagUser }: AddParams) {
  if (!message) {
    throw new AppError(HTTP.BAD_REQUEST, 'Message is required');
  }
  const { user, post } = await loadUserAndPost(userId, postId);
  const id = uuidv4();
  const base = {
    id,
    userId: String(user._id),
    name: user.name,
    avatarUrl: user.avatarURL || '',
    message,
    postedAt: new Date(),
  };

  if (!parentCommentId) {
    post.comments.push({ ...base, replyComment: [] });
  } else {
    const parent = post.comments.find((comment) => comment.id === parentCommentId);
    if (!parent) {
      throw new AppError(HTTP.NOT_FOUND, 'Comment not found');
    }
    parent.replyComment.push({ ...base, tagUser: tagUser || undefined });
  }

  await post.saveComments();
  return post;
}

/** Edits a comment or reply the user owns; throws 400/403/404. */
async function editComment({
  userId,
  postId,
  commentId,
  message,
  isReply,
  parentCommentId,
}: EditParams) {
  if (!commentId || !message) {
    throw new AppError(HTTP.BAD_REQUEST, 'Comment ID and message are required');
  }
  const { post } = await loadUserAndPost(userId, postId);
  const owner = String(userId);

  if (isReply && parentCommentId) {
    const parent = post.comments.find((comment) => comment.id === parentCommentId);
    if (!parent) {
      throw new AppError(HTTP.NOT_FOUND, 'Parent comment not found');
    }
    const reply = parent.replyComment.find((item) => item.id === commentId);
    if (!reply) {
      throw new AppError(HTTP.NOT_FOUND, 'Reply not found');
    }
    if (reply.userId !== owner) {
      throw new AppError(HTTP.FORBIDDEN, 'Not authorized to edit this reply');
    }
    reply.message = message;
  } else {
    const comment = post.comments.find((item) => item.id === commentId);
    if (!comment) {
      throw new AppError(HTTP.NOT_FOUND, 'Comment not found');
    }
    if (comment.userId !== owner) {
      throw new AppError(HTTP.FORBIDDEN, 'Not authorized to edit this comment');
    }
    comment.message = message;
  }

  await post.saveComments();
  return post;
}

/** Deletes a comment or reply the user owns; throws 400/403/404. */
async function deleteComment({
  userId,
  postId,
  commentId,
  isReply,
  parentCommentId,
}: DeleteParams) {
  if (!commentId) {
    throw new AppError(HTTP.BAD_REQUEST, 'Comment ID is required');
  }
  const { post } = await loadUserAndPost(userId, postId);
  const owner = String(userId);

  if (isReply && parentCommentId) {
    const parent = post.comments.find((comment) => comment.id === parentCommentId);
    if (!parent) {
      throw new AppError(HTTP.NOT_FOUND, 'Parent comment not found');
    }
    const index = parent.replyComment.findIndex((item) => item.id === commentId);
    if (index === -1) {
      throw new AppError(HTTP.NOT_FOUND, 'Reply not found');
    }
    if (parent.replyComment[index].userId !== owner) {
      throw new AppError(HTTP.FORBIDDEN, 'Not authorized to delete this reply');
    }
    parent.replyComment.splice(index, 1);
  } else {
    const index = post.comments.findIndex((comment) => comment.id === commentId);
    if (index === -1) {
      throw new AppError(HTTP.NOT_FOUND, 'Comment not found');
    }
    if (post.comments[index].userId !== owner) {
      throw new AppError(HTTP.FORBIDDEN, 'Not authorized to delete this comment');
    }
    post.comments.splice(index, 1);
  }

  await post.saveComments();
  return post;
}

export const commentService = { addComment, editComment, deleteComment };
