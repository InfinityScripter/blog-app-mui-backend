// Postgres unique_violation. Both the release and the timeline services turn
// it into a 409 instead of a 500.
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
