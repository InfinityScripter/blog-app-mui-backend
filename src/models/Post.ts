import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

// Define interfaces without extending Document
export interface IReplyComment {
  userAvatar?: string;
  userName?: string;
  id: string;
  userId: string;
  name: string;
  avatarUrl: string;
  message: string;
  tagUser?: string;
  postedAt: Date;
}

export interface IComment {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string;
  message: string;
  postedAt: Date;
  replyComment: IReplyComment[];
}

export interface IFavoritePerson {
  name: string;
  avatarUrl: string;
}

// Define the base Post interface
export interface IPost {
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
}

// Define the Document type that will be used with Mongoose
export interface PostDocument extends Document, IPost {
  createdAt: Date;
  updatedAt: Date;
}

// Define schemas
const ReplyCommentSchema = new Schema<IReplyComment>({
  id: { type: String, required: true },
  userId: { type: String, required: true },
  name: { type: String, required: true },
  avatarUrl: { type: String, required: true },
  message: { type: String, required: true },
  tagUser: { type: String },
  postedAt: { type: Date, default: Date.now },
});

const CommentSchema = new Schema<IComment>({
  id: { type: String, required: true },
  userId: { type: String, required: true },
  name: { type: String, required: true },
  avatarUrl: { type: String },
  message: { type: String, required: true },
  postedAt: { type: Date, default: Date.now },
  replyComment: [ReplyCommentSchema],
});

const PostSchema = new Schema<PostDocument>(
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
    comments: { type: [CommentSchema], default: [] },
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

// Add a pre-save middleware to ensure totalComments is set to the comments array length
PostSchema.pre('save', function saveHook(next) {
  if (this.comments) {
    this.totalComments = this.comments.length;
  }
  next();
});

// Create the model
export const Post: Model<PostDocument> = mongoose.models.Post as Model<PostDocument> || 
  mongoose.model<PostDocument>('Post', PostSchema);
