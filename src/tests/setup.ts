import '@jest/globals';
import dotenv from 'dotenv';
import { resetDatabase } from '@/src/lib/db';

dotenv.config({ path: '.env.test' });

beforeEach(async () => {
  await resetDatabase();
});
