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

  it('deleteUser: removes another user', async () => {
    await adminService.deleteUser('a', 'b');
    const users = await adminService.listUsers();
    expect(users.some((u) => u.id === 'b')).toBe(false);
  });

  it('deleteUser: cannot delete own account → AppError 400', async () => {
    await expect(adminService.deleteUser('a', 'a')).rejects.toMatchObject({ status: 400 });
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
