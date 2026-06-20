import '@jest/globals';
import User from '@/src/models/User';
import { normalizeEmail } from '@/src/utils/normalize-email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Mtal-VA@Mail.RU ')).toBe('mtal-va@mail.ru');
  });
});

describe('User email is case-insensitive', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await User.create({
      _id: 'u1',
      name: 'Mixed',
      email: 'mtal-va@mail.ru',
      passwordHash: 'x',
    });
  });

  it('findOne matches regardless of the lookup case', async () => {
    const upper = await User.findOne({ email: 'MTAL-VA@MAIL.RU' });
    const mixed = await User.findOne({ email: 'Mtal-Va@Mail.ru' });
    expect(upper?._id).toBe('u1');
    expect(mixed?._id).toBe('u1');
  });

  it('the DB rejects a duplicate that differs only by case', async () => {
    await expect(
      User.create({ _id: 'u2', name: 'Dup', email: 'MTAL-VA@MAIL.RU', passwordHash: 'y' })
    ).rejects.toBeDefined();
  });
});
