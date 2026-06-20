// Single source of truth for email canonicalisation. Emails are treated
// case-insensitively: stored and looked up lowercased + trimmed so that
// `Mtal-va@mail.ru` and `mtal-va@mail.ru` are the same account.
//
// Use this at EVERY entry point that has no zod schema (OAuth callbacks,
// legacy routes). zod schemas should additionally apply `.trim().toLowerCase()`.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
