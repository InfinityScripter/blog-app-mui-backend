// API
// ----------------------------------------------------------------------

export const HOST_API =
  process.env.NODE_ENV === 'production' ? process.env.PRODUCTION_API : process.env.DEV_API;

// Feature flags
// ----------------------------------------------------------------------

export const FEATURES = {
  // Personal-data collection (registration, OAuth sign-up, newsletter subscribe).
  // Off by default so a public deploy collects no personal data (152-ФЗ). Flip
  // PD_COLLECTION_ENABLED=true to re-enable; the code stays in place either way.
  pdCollection: process.env.PD_COLLECTION_ENABLED === 'true',
} as const;
