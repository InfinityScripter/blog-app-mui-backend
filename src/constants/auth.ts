// bcrypt cost factor. Shared by sign-up, password reset and change-password so
// every stored hash carries the same work factor.
export const SALT_ROUNDS = 10;

// Lock an account after this many consecutive failed sign-ins (brute-force
// guard). The counter resets on any successful sign-in.
export const MAX_FAILED_ATTEMPTS = 5;
