/**
 * Script to migrate existing files from the filesystem to MongoDB
 * 
 * Usage: 
 * 1. Make sure MongoDB connection is configured in .env
 * 2. Run: node scripts/migrate-files-to-mongodb.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Post } = require('../src/models/Post');

// Define File model inline for the script
const FileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalname: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  uploadDate: { type: Date, default: Date.now },
  userId: { type: String, required: true },
}, { timestamps: true });

const File = mongoose.models.File || mongoose.model('File', FileSchema);

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/blog-app';

async function connectToDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Function to get MIME type based on file extension
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Function to migrate a single file
async function migrateFile(filePath, filename, userId) {
  try {
    // Read file from filesystem
    const data = fs.readFileSync(filePath);
    
    // Create file document in MongoDB
    const file = new File({
      filename,
      originalname: filename,
      mimetype: getMimeType(filename),
      size: data.length,
      data,
      userId,
    });
    
    // Save to MongoDB
    const savedFile = await file.save();
    console.log(`Migrated file: ${filename}, ID: ${savedFile._id}`);
    
    return savedFile;
  } catch (error) {
    console.error(`Failed to migrate file ${filename}:`, error);
    return null;
  }
}

// Function to update post references
async function updatePostReferences(oldPath, newPath) {
  try {
    // Find posts with the old path
    const posts = await Post.find({ coverUrl: oldPath });
    console.log(`Found ${posts.length} posts with coverUrl: ${oldPath}`);
    
    // Update each post
    for (const post of posts) {
      post.coverUrl = newPath;
      await post.save();
      console.log(`Updated post ${post._id} with new coverUrl: ${newPath}`);
    }
  } catch (error) {
    console.error(`Failed to update post references:`, error);
  }
}

// Main migration function
async function migrateFilesToMongoDB() {
  try {
    await connectToDatabase();
    
    // Path to uploads directory
    const uploadsDir = path.join(process.cwd(), 'public/uploads');
    
    // Check if directory exists
    if (!fs.existsSync(uploadsDir)) {
      console.log('Uploads directory does not exist. Nothing to migrate.');
      return;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(uploadsDir);
    console.log(`Found ${files.length} files to migrate`);
    
    // Get all posts to find the owner of each file
    const posts = await Post.find({});
    const fileOwners = {};
    
    // Map files to their owners
    for (const post of posts) {
      if (post.coverUrl && post.coverUrl.startsWith('/uploads/')) {
        const filename = decodeURIComponent(post.coverUrl.split('/').pop());
        fileOwners[filename] = post.userId;
      }
    }
    
    // Migrate each file
    for (const filename of files) {
      const filePath = path.join(uploadsDir, filename);
      
      // Skip directories
      if (fs.statSync(filePath).isDirectory()) {
        continue;
      }
      
      // Use the owner if known, otherwise use a default ID
      const userId = fileOwners[filename] || '000000000000000000000000';
      
      // Migrate the file
      const savedFile = await migrateFile(filePath, filename, userId);
      
      if (savedFile) {
        // Update post references
        const oldPath = `/uploads/${encodeURIComponent(filename)}`;
        const newPath = `/api/file/${savedFile._id}`;
        await updatePostReferences(oldPath, newPath);
      }
    }
    
    console.log('Migration completed');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
migrateFilesToMongoDB();
