// Public contract of a timeline entry (camelCase, ISO timestamps, null for
// unknowns). Mirrors the frontend LlmModel plus created/updated stamps.
export interface LlmTimelineModel {
  id: string;
  slug: string;
  vendor: string;
  name: string;
  releaseDate: string;
  contextTokens: number | null;
  params: string | null;
  highlight: string;
  description: string;
  capabilities: string[];
  sourceUrl: string;
  wikiUrl: string | null;
  funFact: string | null;
  createdAt: string;
  updatedAt: string;
}
