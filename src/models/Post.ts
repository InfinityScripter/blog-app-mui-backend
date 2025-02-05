import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

export interface IComment extends Document {
  text: string;
  author: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPost extends Document {
    title: string;
    text: string;
    tags: string[];
    viewsCount: number;
    user: mongoose.Types.ObjectId;
    imageUrl?: string;
    comments: IComment[];
    createdAt: Date;
    updatedAt: Date;
}

const CommentSchema: Schema<IComment> = new Schema(
    {
        text: { type: String, required: true, trim: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

const PostSchema: Schema<IPost> = new Schema(
    {
        title: { type: String, required: true },
        text: { type: String, required: true },
        tags: { type: [String], default: [] },
        viewsCount: { type: Number, default: 0 },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        imageUrl: { type: String },
        comments: [CommentSchema],
    },
    { timestamps: true }
);

export const Post: Model<IPost> =
    mongoose.models.Post || mongoose.model<IPost>('Post', PostSchema);
