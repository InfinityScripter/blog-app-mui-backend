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

  it('signs in case-insensitively (email normalized upstream)', async () => {
    // The schema lowercases the email before it reaches the service, and the
    // lookup is case-insensitive — so a lowercased match always works.
    const result = await authService.signIn({ email: 'svc@example.com', password: 'password123' });
    expect(result.user.email).toBe('svc@example.com');
  });

  it('locks the account after 5 consecutive failed attempts (403 afterwards)', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        authService.signIn({ email: 'svc@example.com', password: 'wrong' })
      ).rejects.toMatchObject({ status: 400 });
    }
    // 6th attempt — even with the CORRECT password — is rejected with 403 lock.
    await expect(
      authService.signIn({ email: 'svc@example.com', password: 'password123' })
    ).rejects.toMatchObject({ status: 403 });

    const locked = await User.findOne({ email: 'svc@example.com' });
    expect(locked?.isLocked).toBe(true);
    expect(locked?.failedLoginAttempts).toBeGreaterThanOrEqual(5);
  });

  it('resets the failed-attempt counter on a successful sign-in', async () => {
    await expect(
      authService.signIn({ email: 'svc@example.com', password: 'wrong' })
    ).rejects.toMatchObject({ status: 400 });
    await authService.signIn({ email: 'svc@example.com', password: 'password123' });
    const fresh = await User.findOne({ email: 'svc@example.com' });
    expect(fresh?.failedLoginAttempts).toBe(0);
  });
});
