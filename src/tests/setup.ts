import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import '@jest/globals';

dotenv.config({ path: '.env.test' });

let mongo: MongoMemoryServer;

// Setup before tests
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const mongoUri = mongo.getUri();
  
  // Set the MongoDB connection string to our in-memory database
  process.env.MONGODB_URI = mongoUri;
  
  await mongoose.connect(mongoUri);
});

// Clean up after each test
beforeEach(async () => {
  const collections = await mongoose.connection.db?.collections();
  
  if (collections) {
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
});

// Clean up after all tests
afterAll(async () => {
  await mongoose.connection.close();
  await mongo.stop();
});
