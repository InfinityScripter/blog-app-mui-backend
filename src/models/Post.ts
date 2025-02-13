import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

export interface IReplyComment extends Document {
  userId: mongoose.Types.ObjectId;
  message: string;
  tagUser?: string;
  postedAt: Date;
}

export interface IComment extends Document {
    id: string;
    name: string;
    avatarUrl: string;
    message: string;
    postedAt: Date;
    users: Array<{
        id: string;
        name: string;
        avatarUrl: string;
    }>;
    replyComment: IReplyComment[];
}

export interface IFavoritePerson {
    name: string;
    avatarUrl: string;
}

export interface IPost extends Document {
    publish: 'draft' | 'published';
    title: string;
    description: string;
    content: string;
    coverUrl: string;
    tags: string[];
    metaTitle: string;
    metaDescription: string;
    metaKeywords: string[];
    userId: mongoose.Types.ObjectId;
    author: {
        name: string;
        avatarUrl: string;
    };
    totalViews: number;
    totalShares: number;
    totalComments: number;
    totalFavorites: number;
    comments: IComment[];
    favoritePerson: IFavoritePerson[];
    createdAt: Date;
    updatedAt: Date;
}

const ReplyCommentSchema: Schema<IReplyComment> = new Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    tagUser: { type: String },
    postedAt: { type: Date, default: Date.now },
});

const CommentSchema: Schema<IComment> = new Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    avatarUrl: { type: String },
    message: { type: String, required: true },
    postedAt: { type: Date, default: Date.now },
    users: [
        {
            id: { type: String },
            name: { type: String },
            avatarUrl: { type: String },
        },
    ],
    replyComment: [ReplyCommentSchema],
});

const PostSchema: Schema<IPost> = new Schema(
    {
        publish: {
            type: String,
            enum: ['draft', 'published'],
            default: 'draft',
        },
        title: { type: String, required: true },
        description: { type: String, required: true },
        content: { type: String, required: true },
        coverUrl: { type: String },
        tags: { type: [String], default: [] },
        metaTitle: { type: String },
        metaDescription: { type: String },
        metaKeywords: { type: [String], default: [] },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        author: {
            name: { type: String, required: true },
            avatarUrl: { type: String },
        },
        totalViews: { type: Number, default: 0 },
        totalShares: { type: Number, default: 0 },
        totalComments: { type: Number, default: 0 },
        totalFavorites: { type: Number, default: 0 },
        comments: [CommentSchema],
        favoritePerson: [
            {
                name: { type: String },
                avatarUrl: { type: String },
            },
        ],
    },
    { timestamps: true }
);

export const Post: Model<IPost> =
    mongoose.models.Post || mongoose.model<IPost>('Post', PostSchema);
