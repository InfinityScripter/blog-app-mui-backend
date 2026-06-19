import type { HttpStatus } from '@/src/constants/http';

// Standard API response envelope.
export interface ApiSuccess<T = unknown> {
  success: true;
  message?: string;
  data?: T;
}

export interface ApiError {
  success: false;
  message: string;
}

/**
 * Thrown by services to signal an HTTP-mappable failure. Carries the status
 * so routes don't branch on it — sendError(res, err) maps it. Optional
 * `extra` is merged into the JSON body (e.g. { requiresVerification: true }).
 */
export class AppError extends Error {
  status: HttpStatus;

  extra?: Record<string, unknown>;

  constructor(status: HttpStatus, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.extra = extra;
    // Restore prototype chain — required for `instanceof` to work when the
    // build target is ES5 (extending built-in Error breaks it otherwise).
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError || (error instanceof Error && error.name === 'AppError');
}
