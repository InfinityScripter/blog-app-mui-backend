// Frozen public contract of the AI-model release changelog (camelCase, ISO
// timestamps, null for unknowns). The service lives in
// src/services/model-release.ts.

export interface ModelRelease {
  id: string;
  slug: string;
  vendor: string;
  model: string;
  version: string;
  releasedAt: string;
  contextTokens: number | null;
  priceIn: number | null;
  priceOut: number | null;
  changes: string[];
  verdict: string | null;
  sourceUrl: string;
  sourceName: string | null;
  createdAt: string;
  updatedAt: string;
}
