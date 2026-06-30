import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';
import { HTTP_METHOD } from '@/src/constants/http';
import { isAllowedOrigin } from '@/src/utils/allowed-origin';

const baseCorsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '';

  const headers: Record<string, string> = { ...baseCorsHeaders };
  // Credentialed headers (Allow-Origin + Allow-Credentials) are only sent for
  // allow-listed origins — never echo an arbitrary origin.
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (request.method === HTTP_METHOD.OPTIONS) {
    return NextResponse.json({}, { headers });
  }

  const response = NextResponse.next();
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
