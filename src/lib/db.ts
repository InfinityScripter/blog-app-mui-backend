// src/lib/db.ts
import mongoose from 'mongoose';

const MONGO_DB_URI = process.env.MONGO_DB_URI;
if (!MONGO_DB_URI) {
    throw new Error('Please define the MONGO_DB_URI environment variable inside .env.local');
}

let cached = (global as any).mongoose;
if (!cached) {
    cached = (global as any).mongoose = { conn: null, promise: null };
}

async function dbConnect() {
    if (cached.conn) {
        return cached.conn;
    }
    if (!cached.promise) {
        const opts = { bufferCommands: false };
        // @ts-ignore
        cached.promise = mongoose.connect(MONGO_DB_URI, opts).then((mongoose) => {
            return mongoose;
        });
    }
    cached.conn = await cached.promise;
    return cached.conn;
}

export default dbConnect;
