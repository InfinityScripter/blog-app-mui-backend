import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IFile extends Document {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  data: Buffer;
  uploadDate: Date;
  userId: string;
}

const FileSchema = new Schema<IFile>(
  {
    filename: { type: String, required: true },
    originalname: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    uploadDate: { type: Date, default: Date.now },
    userId: { type: String, required: true },
  },
  {
    timestamps: true,
  }
);

export const File: Model<IFile> = mongoose.models.File as Model<IFile> || 
  mongoose.model<IFile>('File', FileSchema);
