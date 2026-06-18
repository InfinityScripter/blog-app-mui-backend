import { z } from 'zod';

// Request body schemas for the auth endpoints.

export const signUpSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
});

export const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export type SignUpBody = z.infer<typeof signUpSchema>;
export type SignInBody = z.infer<typeof signInSchema>;
