import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { authService } from '@/src/services/auth';

describe('authService.signIn', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      name: 'Svc User',
      email: 'svc@example.com',
      passwordHash,
      isEmailVerified: true,
    });
  });

  it('returns an accessToken + public user for valid credentials', async () => {
    const result = await authService.signIn({ email: 'svc@example.com', password: 'password123' });
    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe('svc@example.com');
    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('throws AppError 400 for a wrong password', async () => {
    await expect(
      authService.signIn({ email: 'svc@example.com', password: 'nope' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws AppError 400 for an unknown email', async () => {
    await expect(
      authService.signIn({ email: 'ghost@example.com', password: 'x' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('throws AppError 403 when email is not verified', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      name: 'Unverified',
      email: 'unv@example.com',
      passwordHash,
      isEmailVerified: false,
    });
    await expect(
      authService.signIn({ email: 'unv@example.com', password: 'password123' })
    ).rejects.toMatchObject({ status: 403 });
  });
});
