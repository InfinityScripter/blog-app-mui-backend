import { z } from 'zod';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

// Request body schemas for the auth endpoints.

export const signUpSchema = z.object({
  // Emails are case-insensitive: normalize on the way in. See normalize-email.ts.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  personalDataConsent: z.literal(true),
  personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION),
});

export const signInSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
    personalDataConsent: z.literal(true).optional(),
    personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION).optional(),
  })
  .refine(
    (value) => Boolean(value.personalDataConsent) === Boolean(value.personalDataConsentVersion),
    { message: 'Consent and its version must be provided together' }
  );

export type SignUpBody = z.infer<typeof signUpSchema>;
export type SignInBody = z.infer<typeof signInSchema>;
