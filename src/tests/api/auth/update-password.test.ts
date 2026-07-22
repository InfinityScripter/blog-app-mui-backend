import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import { authService } from '@/src/services/auth';
import { HTTP_METHOD } from '@/src/constants/http';
import handler from '@/src/pages/api/auth/update-password';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

describe('POST /api/auth/update-password', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    const passwordHash = await bcrypt.hash('oldpassword', 10);
    await User.create({
      name: 'Reset User',
      email: 'reset@example.com',
      passwordHash,
      isEmailVerified: true,
      passwordResetCode: '123456',
      passwordResetExpires: new Date(Date.now() + 3600000),
      personalDataConsentAt: new Date(),
      personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
    });
  });

  it('sets the new password and clears the reset code', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'reset@example.com', code: '123456', password: 'newpassword' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const updated = await User.findOne({ email: 'reset@example.com' });
    expect(updated?.passwordResetCode).toBeNull();
    expect(await bcrypt.compare('newpassword', updated?.passwordHash ?? '')).toBe(true);
  });

  it('unlocks a locked account so the user can sign in with the new password', async () => {
    // Lock the account the way the app does: 5 consecutive failed sign-ins.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        authService.signIn({ email: 'reset@example.com', password: 'wrong' })
      ).rejects.toMatchObject({ status: 400 });
    }
    const locked = await User.findOne({ email: 'reset@example.com' });
    expect(locked?.isLocked).toBe(true);

    // The lock message tells the user to reset their password to unlock — do that.
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'reset@example.com', code: '123456', password: 'newpassword' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    // The account must now be unlocked and the counter cleared.
    const unlocked = await User.findOne({ email: 'reset@example.com' });
    expect(unlocked?.isLocked).toBe(false);
    expect(unlocked?.failedLoginAttempts).toBe(0);

    // End-to-end: signing in with the new password succeeds, not a 403 lock.
    const result = await authService.signIn({
      email: 'reset@example.com',
      password: 'newpassword',
    });
    expect(result.accessToken).toBeTruthy();
  });

  it('matches the account case-insensitively when the typed email differs in case', async () => {
    // The model's email clause is LOWER(email)=LOWER($n), so a mixed-case input
    // resolves to the stored lowercase account. This locks in that contract.
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'Reset@Example.com', code: '123456', password: 'newpassword' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const updated = await User.findOne({ email: 'reset@example.com' });
    expect(await bcrypt.compare('newpassword', updated?.passwordHash ?? '')).toBe(true);
  });

  it('returns 400 for an invalid reset code', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'reset@example.com', code: '000000', password: 'newpassword' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Invalid or expired reset code');
  });
});
