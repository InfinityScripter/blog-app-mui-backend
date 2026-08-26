import { z } from 'zod';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

// Request body schemas for the auth endpoints.

// Emails are case-insensitive: normalize on the way in. See normalize-email.ts.
export const emailField = z.string().trim().toLowerCase().email();

// Verification / reset codes are 6-digit strings, but clients have sent them
// as numbers — accept both and normalize to a trimmed string.
const codeField = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1));

export const signUpSchema = z.object({
  email: emailField,
  password: z.string().min(6),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  personalDataConsent: z.literal(true),
  personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION),
});

export const signInSchema = z
  .object({
    email: emailField,
    password: z.string().min(1),
    personalDataConsent: z.literal(true).optional(),
    personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION).optional(),
  })
  .refine(
    (value) => Boolean(value.personalDataConsent) === Boolean(value.personalDataConsentVersion),
    { message: 'Consent and its version must be provided together' }
  );

/** POST /api/auth/reset-password — sends the reset code. */
export const resetPasswordSchema = z.object({
  email: emailField,
});

/** POST /api/auth/update-password — exchanges a valid code for a new password.
 * min(6) mirrors signUpSchema: the reset flow must not accept a password the
 * sign-up flow would reject. */
export const updatePasswordSchema = z.object({
  email: emailField,
  code: codeField,
  password: z.string().min(6),
});

/** POST /api/auth/resend-verification. */
export const resendVerificationSchema = z.object({
  email: emailField,
});

/** POST /api/auth/verify — email + 6-digit code. */
export const verifyEmailSchema = z.object({
  email: emailField,
  code: codeField,
});

export type SignUpBody = z.infer<typeof signUpSchema>;
export type SignInBody = z.infer<typeof signInSchema>;
