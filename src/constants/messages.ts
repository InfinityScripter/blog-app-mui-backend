// User-facing API messages. Centralised so routes/services never inline
// strings and wording stays consistent.

export const MSG = {
  METHOD_NOT_ALLOWED: 'Method not allowed',
  INTERNAL: 'Internal server error',
  UNAUTHORIZED: 'Unauthorized',
  TOO_MANY_REQUESTS: 'Too many requests, please try again later.',

  // auth
  WRONG_CREDENTIALS: 'Wrong email or password',
  NO_PASSWORD_SET: 'No password set for this user',
  ACCOUNT_LOCKED:
    'Account locked due to too many failed sign-in attempts. Reset your password to unlock.',
  EMAIL_NOT_VERIFIED: 'Please verify your email before signing in',
  EMAIL_SERVICE_UNAVAILABLE:
    'Email service is not configured. Registration is temporarily unavailable.',
  USER_EXISTS: 'User with this email already exists',
  USER_NOT_FOUND: 'Пользователь не найден',
  SIGN_UP_SUCCESS: 'User created successfully. Please check your email for verification code.',
  NO_PASSWORD_FOR_CHANGE: 'Cannot change password: no password is set for this account',
  CURRENT_PASSWORD_INCORRECT: 'Current password is incorrect',

  // user profile
  PROFILE_UPDATED: 'Profile updated successfully',
  PASSWORD_CHANGED: 'Password changed successfully',
  AVATAR_UPDATED: 'Avatar updated successfully',
  AVATAR_REMOVED: 'Avatar removed successfully',
} as const;
