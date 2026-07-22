import { z } from 'zod';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

// Newsletter (double-opt-in) request schemas. subscribe accepts an email;
// confirm/unsubscribe read an opaque uuid token from the query; send carries
// the pre-rendered digest (subject + html) authored by the bot/owner.

export const subscribeSchema = z.object({
  email: z.string().trim().email().max(255),
  personalDataConsent: z.literal(true),
  personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION),
});

// Query params arrive as string | string[] — collapse an array to its first
// element before validating the opaque token. We only require a non-empty
// string here (NOT a strict uuid): per the frozen contract §1, a syntactically
// present-but-unknown token must reach the service and surface as 404, not a
// 400 that leaks the zod message. A completely missing token still fails here.
const tokenQuery = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().trim().min(1)
);

export const tokenQuerySchema = z.object({ token: tokenQuery });

export const sendDigestSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  html: z.string().trim().min(1).max(200_000),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type TokenQuery = z.infer<typeof tokenQuerySchema>;
export type SendDigestInput = z.infer<typeof sendDigestSchema>;
