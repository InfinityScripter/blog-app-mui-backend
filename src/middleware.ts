import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const allowedOrigins = [
  'http://localhost:3033',
  'http://localhost:7272',
  'https://api-dev-minimal-v6.vercel.app',
];

const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
};

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowedOrigin = allowedOrigins.includes(origin);
    console.log('origin is here', origin);
    if (request.method === 'OPTIONS') {
        console.log('preflight request is here' );
        const preflightHeaders = {
            ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
            ...corsHeaders,
        };
        return NextResponse.json({}, { headers: preflightHeaders });
    }

    const response = NextResponse.next();
    if (isAllowedOrigin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
    }
    Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
    });

    return response;
}

export const config = {
    matcher: '/api/:path*',
};
