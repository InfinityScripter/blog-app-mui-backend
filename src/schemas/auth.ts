import { z } from 'zod';

// Request body schemas for the auth endpoints.

export const signUpSchema = z.object({
  // Emails are case-insensitive: normalize on the way in. See normalize-email.ts.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
});

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type SignUpBody = z.infer<typeof signUpSchema>;
export type SignInBody = z.infer<typeof signInSchema>;
