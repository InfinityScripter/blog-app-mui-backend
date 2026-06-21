import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for proxying the admin panel to the bot's localhost control
// server. No HTTP-framework types here — routes adapt the result.

export type ControlProviderName = 'glm' | 'deepseek' | 'mock';

export interface BotModel {
  id: string;
  tier: 'free' | 'paid';
  note?: string;
}
export interface BotProvider {
  name: ControlProviderName;
  label: string;
  hasKey: boolean;
}
export interface BotStatus {
  isAlive: boolean;
  provider?: string;
  model?: string;
  isMockEnabled?: boolean;
}

const TIMEOUT_MS = 8_000;

function baseUrl(): string {
  const url = process.env.BOT_CONTROL_URL;
  if (!url) throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Бот не настроен (BOT_CONTROL_URL)');
  return url.replace(/\/$/, '');
}

function token(): string {
  const value = process.env.BOT_CONTROL_TOKEN;
  if (!value) throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Бот не настроен (BOT_CONTROL_TOKEN)');
  return value;
}

/** Reads a string property off an unknown object, or undefined. */
function strProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/**
 * True if a thrown fetch error means the bot is unreachable (refused/timeout).
 * Avoids `instanceof Error` on purpose — under Jest's module realms an undici
 * error can fail `instanceof` against the test realm's Error, which would
 * silently drop the refusal to a 500. Inspects structurally instead. undici
 * wraps ECONNREFUSED in error.cause.code, NOT the top-level error.
 */
function isUnreachable(error: unknown): boolean {
  if (strProp(error, 'name') === 'AbortError') return true;
  if (error && typeof error === 'object' && 'cause' in error) {
    const code = strProp((error as { cause: unknown }).cause, 'code');
    return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';
  }
  return false;
}

interface RequestInitLite {
  method?: string;
  body?: unknown;
}

interface ParsedResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

/** Calls the bot control server; throws AppError(503) when unreachable. */
async function call(path: string, init: RequestInitLite = {}): Promise<ParsedResponse> {
  const { method = 'GET', body } = init;
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (isUnreachable(error)) {
      throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Бот недоступен');
    }
    throw error;
  }
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Бот ответил ${response.status}`;
    throw new AppError(
      response.status === HTTP.BAD_REQUEST ? HTTP.BAD_REQUEST : HTTP.SERVICE_UNAVAILABLE,
      message
    );
  }
  return { status: response.status, ok: response.ok, data };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function getStatus(): Promise<BotStatus> {
  try {
    const { data } = await call('/control/status');
    const raw = asRecord(data);
    return {
      isAlive: true,
      provider: typeof raw.provider === 'string' ? raw.provider : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      isMockEnabled: typeof raw.isMockEnabled === 'boolean' ? raw.isMockEnabled : undefined,
    };
  } catch (error) {
    // Status is the ONE route that swallows unreachable into isAlive:false so
    // the UI can render a "down" chip. Other (non-503) errors still throw.
    if (error instanceof AppError && error.status === HTTP.SERVICE_UNAVAILABLE) {
      return { isAlive: false };
    }
    throw error;
  }
}

async function listProviders(): Promise<BotProvider[]> {
  const { data } = await call('/control/providers');
  const raw = asRecord(data);
  return Array.isArray(raw.providers) ? (raw.providers as BotProvider[]) : [];
}

async function listModels(provider: string): Promise<BotModel[]> {
  const { data } = await call(`/control/models?provider=${encodeURIComponent(provider)}`);
  const raw = asRecord(data);
  return Array.isArray(raw.models) ? (raw.models as BotModel[]) : [];
}

async function setModel(provider: string, model: string): Promise<{ validation: string }> {
  const { data } = await call('/control/model', { method: 'POST', body: { provider, model } });
  const raw = asRecord(data);
  return { validation: typeof raw.validation === 'string' ? raw.validation : 'pinged' };
}

async function setMock(enabled: boolean): Promise<{ isMockEnabled: boolean }> {
  const { data } = await call('/control/mock', { method: 'POST', body: { enabled } });
  const raw = asRecord(data);
  return { isMockEnabled: typeof raw.isMockEnabled === 'boolean' ? raw.isMockEnabled : enabled };
}

export const botControlService = { getStatus, listProviders, listModels, setModel, setMock };
