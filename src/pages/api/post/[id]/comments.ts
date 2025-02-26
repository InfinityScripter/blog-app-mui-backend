import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from 'src/lib/db';
import { Post } from 'src/models/Post';
import { verify } from 'jsonwebtoken';
import uuidv4 from 'src/utils/uuidv4';
import User from '@/src/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        await dbConnect();

        // Verify authentication
        const { authorization } = req.headers;
        if (!authorization) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const token = authorization.split(' ')[1];
        let decoded: any;
        try {
            decoded = verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        const userId = String(decoded.userId); // Convert to string for consistent comparison
        console.log(userId + ' userID is making a comment');
        // Find the user to get their name and avatarURL
        const user = await User.findOne({ _id: decoded.userId });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get postId from query parameters
        const { id: postId } = req.query;
        if (!postId || typeof postId !== 'string') {
            return res.status(400).json({ message: 'Invalid post id' });
        }

        // Find the post
        const post = await Post.findOne({ _id: postId });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        if (req.method === 'POST') {
            // Parse request body
            const { message, parentCommentId, tagUser } = req.body;
            if (!message) {
                return res.status(400).json({ message: 'Message is required' });
            }

            // Generate unique id for new comment or reply
            const clientId = uuidv4(); // This is the id field used for frontend operations

            if (!parentCommentId) {
                // Adding a new top-level comment
                const newComment = {
                    id: clientId,           // Frontend UUID for operations
                    userId: userId,         // String ID of the comment creator
                    name: user.name,
                    avatarUrl: user.avatarURL || '',
                    message,
                    postedAt: new Date(),
                    replyComment: [],
                };
                post.comments.push(newComment);
                post.totalComments = post.comments.length;
            } else {
                // Adding a new reply to a comment
                const parentComment = post.comments.find((comment) => comment.id === parentCommentId);
                if (!parentComment) {
                    return res.status(404).json({ message: 'Comment not found' });
                }
                const newReply = {
                    id: clientId,           // Frontend UUID for operations
                    userId: userId,         // String ID of the reply creator
                    name: user.name,
                    avatarUrl: user.avatarURL || '',
                    message,
                    tagUser: tagUser || null,
                    postedAt: new Date(),
                };
                parentComment.replyComment.push(newReply);
            }

            // Save the updated post
            await post.save();

            // Return the updated post for frontend to update state
            return res.status(200).json({ message: 'Comment added successfully', post });
        }

        if (req.method === 'PUT') {
            const { commentId, message, isReply, parentCommentId } = req.body;
            if (!commentId || !message) {
                return res.status(400).json({ message: 'Comment ID and message are required' });
            }

            if (isReply && parentCommentId) {
                // Edit reply
                const parentComment = post.comments.find((comment) => comment.id === parentCommentId);
                if (!parentComment) {
                    return res.status(404).json({ message: 'Parent comment not found' });
                }
                const reply = parentComment.replyComment.find((reply) => reply.id === commentId);
                if (!reply) {
                    return res.status(404).json({ message: 'Reply not found' });
                }
                if (reply.userId !== userId) {
                    return res.status(403).json({ message: 'Not authorized to edit this reply' });
                }
                reply.message = message;
            } else {
                // Edit main comment
                const comment = post.comments.find((comment) => comment.id === commentId);
                if (!comment) {
                    return res.status(404).json({ message: 'Comment not found' });
                }
                if (comment.userId !== userId) {
                    return res.status(403).json({ message: 'Not authorized to edit this comment' });
                }
                comment.message = message;
            }

            post.totalComments = post.comments.length;
            // Save the updated post
            await post.save();

            // Return the updated post for frontend to update state
            return res.status(200).json({ message: 'Comment updated successfully', post });
        }

        if (req.method === 'DELETE') {
            const { commentId, isReply, parentCommentId } = req.body;
            if (!commentId) {
                return res.status(400).json({ message: 'Comment ID is required' });
            }

            if (isReply && parentCommentId) {
                // Delete reply
                const parentComment = post.comments.find((comment) => comment.id === parentCommentId);
                if (!parentComment) {
                    return res.status(404).json({ message: 'Parent comment not found' });
                }
                const replyIndex = parentComment.replyComment.findIndex((reply) => reply.id === commentId);
                if (replyIndex === -1) {
                    return res.status(404).json({ message: 'Reply not found' });
                }
                if (parentComment.replyComment[replyIndex].userId !== userId) {
                    return res.status(403).json({ message: 'Not authorized to delete this reply' });
                }
                parentComment.replyComment.splice(replyIndex, 1);
            } else {
                // Delete main comment
                const commentIndex = post.comments.findIndex((comment) => comment.id === commentId);
                if (commentIndex === -1) {
                    return res.status(404).json({ message: 'Comment not found' });
                }
                if (post.comments[commentIndex].userId !== userId) {
                    return res.status(403).json({ message: 'Not authorized to delete this comment' });
                }
                post.comments.splice(commentIndex, 1);
            }

            post.totalComments = post.comments.length;
            // Save the updated post
            await post.save();

            // Return the updated post for frontend to update state
            return res.status(200).json({ message: 'Comment deleted successfully', post });
        }

        return res.status(405).json({ message: 'Method not allowed' });
    } catch (error) {
        console.error('[Comment API]:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
