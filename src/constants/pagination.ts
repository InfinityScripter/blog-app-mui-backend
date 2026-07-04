// Shared paging caps for list endpoints (posts, audit logs, model releases).
// `limit` query params are clamped to MAX_LIMIT; DEFAULT_LIMIT applies when a
// paginated endpoint gets no explicit limit.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
