import '@jest/globals';
import User from '@/src/models/User';
import { adminService } from '@/src/services/admin';

describe('adminService.listUsers', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await User.create({
      _id: 'a',
      name: 'Alice',
      email: 'a@e.com',
      passwordHash: 'x',
      role: 'admin',
    });
    await User.create({ _id: 'b', name: 'Bob', email: 'b@e.com', passwordHash: 'x', role: 'user' });
  });

  it('returns all users mapped to camelCase', async () => {
    const users = await adminService.listUsers();
    expect(users).toHaveLength(2);
    const alice = users.find((u) => u.email === 'a@e.com');
    expect(alice?.role).toBe('admin');
    expect(alice).toHaveProperty('avatarURL');
    expect(alice).toHaveProperty('isEmailVerified');
  });
});
