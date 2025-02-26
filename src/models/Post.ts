import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

export interface IReplyComment extends Document {
  userAvatar: string | undefined;
  userName: string;
  id: string; // Client-side ID (UUID) for frontend operations
  _id?: string; // MongoDB generated ID
  userId: string; // User ID of the comment creator
  name: string; // Display name of the commenter
  avatarUrl: string; // Avatar URL of the commenter
  message: string; // Comment content
  tagUser?: string; // Tagged user in reply
  postedAt: Date; // Comment creation time
}

export interface IComment extends Document {
    id: string;         // Client-side ID (UUID) for frontend operations
    _id?: string;       // MongoDB generated ID
    userId: string;     // User ID of the comment creator
    name: string;       // Display name of the commenter
    avatarUrl: string;  // Avatar URL of the commenter
    message: string;    // Comment content
    postedAt: Date;     // Comment creation time
    replyComment: IReplyComment[];  // Nested replies to this comment
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
    totalViews: number;
    totalShares: number;
    totalComments: number;
    totalFavorites: number;
    favoritePerson: IFavoritePerson[];
    comments: IComment[];
    userId: string;
    author: {
        name: string;
        avatarUrl?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

const ReplyCommentSchema: Schema<IReplyComment> = new Schema({
    id: { type: String, required: true },      // Client-side UUID
    userId: { type: String, required: true },  // User ID of the comment creator
    name: { type: String, required: true },
    avatarUrl: { type: String, required: true },
    message: { type: String, required: true },
    tagUser: { type: String },
    postedAt: { type: Date, default: Date.now },
});

const CommentSchema: Schema<IComment> = new Schema({
    id: { type: String, required: true },      // Client-side UUID
    userId: { type: String, required: true },  // User ID of the comment creator
    name: { type: String, required: true },
    avatarUrl: { type: String },
    message: { type: String, required: true },
    postedAt: { type: Date, default: Date.now },
    replyComment: [ReplyCommentSchema],
});

const PostSchema = new Schema<IPost>(
    {
        publish: {
            type: String,
            enum: ['draft', 'published'],
            default: 'draft',
        },
        title: { type: String, required: true },
        description: { type: String },
        content: { type: String },
        coverUrl: { type: String },
        tags: { type: [String], default: [] },
        metaTitle: { type: String },
        metaDescription: { type: String },
        metaKeywords: { type: [String], default: [] },
        totalViews: { type: Number, default: 0 },
        totalShares: { type: Number, default: 0 },
        totalComments: { type: Number, default: 0 },
        totalFavorites: { type: Number, default: 0 },
        favoritePerson: {
            type: [
                {
                    name: { type: String },
                    avatarUrl: { type: String },
                },
            ],
            default: [],
        },
        comments: [CommentSchema],
        userId: { type: String, required: true },
        author: {
            name: { type: String, required: true },
            avatarUrl: { type: String },
        },
    },
    {
        timestamps: true,
    }
);

// Add a pre-find middleware to ensure totalComments is set to the comments array length
PostSchema.pre('find', function() {
    // We can't modify documents here directly, but we'll handle it in the API layer
});

PostSchema.pre('findOne', function() {
    // We can't modify documents here directly, but we'll handle it in the API layer
});

// Add a pre-save middleware to ensure totalComments is set to the comments array length
PostSchema.pre('save', function(next) {
    if (this.comments) {
        this.totalComments = this.comments.length;
    }
    next();
});

export const Post: Model<IPost> =
    mongoose.models.Post || mongoose.model<IPost>('Post', PostSchema);
