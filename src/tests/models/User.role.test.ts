import '@jest/globals';
import User from '@/src/models/User';

describe('User role field', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('should default role to "user"', async () => {
    const user = await User.create({ name: 'Test', email: 'test@example.com' });
    expect(user.role).toBe('user');
  });

  it('should persist role "admin"', async () => {
    await User.create({ name: 'Admin', email: 'admin@example.com', role: 'admin' });
    const found = await User.findOne({ email: 'admin@example.com' });
    expect(found?.role).toBe('admin');
  });
});
