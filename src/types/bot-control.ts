// Contracts of the bot control proxy (admin panel ↔ news-bot localhost
// server). The service lives in src/services/bot-control.ts.

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

export interface BotModelHealthCheck {
  provider: string;
  label: string;
  model: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface BotModelsHealth {
  healthy: boolean;
  checks: BotModelHealthCheck[];
}
