import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.json({ user: data.user });
  const isProd = process.env.NODE_ENV === 'production';

  response.cookies.set('mm_access_token', data.token, cookieOptions(isProd));
  if (data.user?.tenantId) {
    response.cookies.set('mm_tenant_id', data.user.tenantId, cookieOptions(isProd));
  }

  return response;
}
