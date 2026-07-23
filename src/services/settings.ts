import { dbQuery } from '@/src/lib/db';
import { FEATURES } from '@/src/config-global';

// Runtime feature flags, backed by the app_settings key→value table so an admin
// can toggle them without a redeploy (the env var is only the first-run seed).
// getFlag reads through a short in-memory cache to keep the public/gated request
// path off the DB on every hit; setFlag writes and drops the cache immediately.
//
// Extending: add a key to FlagKey + FLAG_DEFAULTS and it participates in
// getFlags() and the admin surface automatically.

export type FlagKey = 'pdCollection' | 'dogsBooking' | 'autoPublishReleases' | 'autoPublishNews';

// Seed value used the first time a flag is read and no row exists yet. Sourced
// from the build-time env flag so an existing deploy keeps its current behaviour
// until the first admin toggle, after which the DB row is the source of truth.
const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  pdCollection: FEATURES.pdCollection,
  dogsBooking: FEATURES.dogsBooking,
  autoPublishReleases: FEATURES.autoPublishReleases,
  autoPublishNews: FEATURES.autoPublishNews,
};

const ALL_FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as FlagKey[];

// Process-local read-through cache. TTL is short so a toggle on another instance
// (were there one) converges quickly; on the single VDS process a write drops
// the entry outright, so reads there are always fresh.
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<FlagKey, CacheEntry>();

function serialize(value: boolean): string {
  return value ? 'true' : 'false';
}

async function readStored(key: FlagKey): Promise<boolean | null> {
  const result = await dbQuery<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
    key,
  ]);
  if (!result.rows.length) {
    return null;
  }
  return result.rows[0].value === 'true';
}

async function writeStored(key: FlagKey, value: boolean): Promise<void> {
  await dbQuery(
    `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, serialize(value)]
  );
}

async function getFlag(key: FlagKey): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let value = await readStored(key);
  if (value === null) {
    // First read: persist the env-seeded default so the admin UI reflects a real
    // stored value and later reads are pure DB.
    value = FLAG_DEFAULTS[key];
    await writeStored(key, value);
  }

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function setFlag(key: FlagKey, value: boolean): Promise<void> {
  await writeStored(key, value);
  cache.delete(key);
}

async function getFlags(): Promise<Record<FlagKey, boolean>> {
  const entries = await Promise.all(
    ALL_FLAG_KEYS.map(async (key) => [key, await getFlag(key)] as const)
  );
  return Object.fromEntries(entries) as Record<FlagKey, boolean>;
}

export const settingsService = {
  getFlag,
  setFlag,
  getFlags,
  // Test-only: the cache is process-local state that would otherwise leak across
  // cases (resetDatabase wipes rows, not this map). Never called from prod code.
  __resetCacheForTests(): void {
    cache.clear();
  },
};
