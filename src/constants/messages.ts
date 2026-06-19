// User-facing API messages. Centralised so routes/services never inline
// strings and wording stays consistent.

export const MSG = {
  METHOD_NOT_ALLOWED: 'Method not allowed',
  INTERNAL: 'Internal server error',
  UNAUTHORIZED: 'Unauthorized',

  // auth
  WRONG_CREDENTIALS: 'Wrong email or password',
  NO_PASSWORD_SET: 'No password set for this user',
  EMAIL_NOT_VERIFIED: 'Please verify your email before signing in',
  EMAIL_SERVICE_UNAVAILABLE:
    'Email service is not configured. Registration is temporarily unavailable.',
  USER_EXISTS: 'User with this email already exists',
  USER_NOT_FOUND: 'Пользователь не найден',
  SIGN_UP_SUCCESS: 'User created successfully. Please check your email for verification code.',
} as const;
