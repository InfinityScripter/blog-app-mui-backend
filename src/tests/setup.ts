import '@jest/globals';
import dotenv from 'dotenv';
import { resetDatabase } from '@/src/lib/db';
import { resetDogsDatabase } from '@/src/lib/dogs-db';

dotenv.config({ path: '.env.test' });

beforeEach(async () => {
  await resetDatabase();
  await resetDogsDatabase();
});
