import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { settingsService } from '@/src/services/settings';

// settingsService backs the runtime feature-flag toggle: getFlag reads the
// app_settings row (seeding from the env default on first read), setFlag UPSERTs
// and invalidates the in-memory cache. The cache is process-local, so tests must
// clear it between cases (prod never resets it — it just expires).

describe('settingsService', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM app_settings');
    settingsService.__resetCacheForTests();
  });

  it('seeds pdCollection from the env default and persists it on first read', async () => {
    // .env.test sets PD_COLLECTION_ENABLED=true → the seed is true.
    const value = await settingsService.getFlag('pdCollection');
    expect(value).toBe(true);

    // The seed was written through, so the admin UI reads a real stored row.
    const row = await dbQuery<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
      'pdCollection',
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].value).toBe('true');
  });

  it('setFlag persists the new value and getFlag reads it back', async () => {
    await settingsService.setFlag('pdCollection', false);

    const stored = await dbQuery<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = $1',
      ['pdCollection']
    );
    expect(stored.rows[0].value).toBe('false');

    expect(await settingsService.getFlag('pdCollection')).toBe(false);
  });

  it('setFlag invalidates the cache so a later read is not stale', async () => {
    // Prime the cache with the seeded true.
    expect(await settingsService.getFlag('pdCollection')).toBe(true);

    // Flip via setFlag — the immediate next read must reflect the change, not the
    // cached true.
    await settingsService.setFlag('pdCollection', false);
    expect(await settingsService.getFlag('pdCollection')).toBe(false);

    await settingsService.setFlag('pdCollection', true);
    expect(await settingsService.getFlag('pdCollection')).toBe(true);
  });

  it('getFlags returns every flag in the snapshot', async () => {
    // Set every flag explicitly so the assertion is independent of the env-seeded
    // defaults; getFlags must surface the full FlagKey set, not just one. This
    // toEqual is a strict full-set match — a new FlagKey must be added here too.
    await settingsService.setFlag('pdCollection', false);
    await settingsService.setFlag('dogsBooking', true);
    await settingsService.setFlag('autoPublishReleases', true);
    await settingsService.setFlag('autoPublishNews', false);
    const flags = await settingsService.getFlags();
    expect(flags).toEqual({
      pdCollection: false,
      dogsBooking: true,
      autoPublishReleases: true,
      autoPublishNews: false,
    });
  });

  it('reads an existing row instead of re-seeding when one is already stored', async () => {
    // A stored false must win over the true env default.
    await dbQuery('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [
      'pdCollection',
      'false',
    ]);
    settingsService.__resetCacheForTests();
    expect(await settingsService.getFlag('pdCollection')).toBe(false);
  });
});
