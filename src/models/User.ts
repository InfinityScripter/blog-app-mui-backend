// src/models/User.ts
import mongoose, { Document, Model } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  avatarURL?: string;
  isEmailVerified?: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  lastLogin?: Date;
  failedLoginAttempts?: number;
  isLocked?: boolean;
}

const UserSchema = new mongoose.Schema<IUser>(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, unique: true },
        passwordHash: {
            type: String,
            required: function (this: IUser) {
                return !this.googleId;
            },
        },
        googleId: { type: String, sparse: true, unique: true },
        avatarURL: String,
        isEmailVerified: { type: Boolean, default: false },
        emailVerificationToken: { type: String, default: null },
        emailVerificationExpires: { type: Date, default: null },
        passwordResetToken: { type: String, default: null },
        passwordResetExpires: { type: Date, default: null },
        lastLogin: { type: Date, default: null },
        failedLoginAttempts: { type: Number, default: 0 },
        isLocked: { type: Boolean, default: false },
    },
    { timestamps: true }
);

const User: Model<IUser> =
    mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export default User;
