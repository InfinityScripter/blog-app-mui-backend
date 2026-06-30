// HTTP status codes. Use these instead of magic numbers in routes/services.

export const HTTP = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type HttpStatus = (typeof HTTP)[keyof typeof HTTP];

// HTTP methods. Use these instead of bare 'GET'/'POST' string literals in
// route handlers, middleware, services and tests.

export const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];
