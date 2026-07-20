import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'mm_access_token';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

function homeForRole(role: string): string {
  if (role === 'SUPER_ADMIN') return '/superadmin';
  if (role === 'CASHIER') return '/pos';
  return '/admin';
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;

  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/pos') ||
    pathname.startsWith('/superadmin');

  if (pathname === '/login' && token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      return NextResponse.redirect(new URL(homeForRole(payload.role as string), request.url));
    } catch {
      return NextResponse.next();
    }
  }

  if (!isProtected) return NextResponse.next();

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role as string;

    if (pathname.startsWith('/superadmin') && role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }

    if (pathname.startsWith('/admin') && role === 'CASHIER') {
      return NextResponse.redirect(new URL('/pos', request.url));
    }

    if (pathname.startsWith('/admin') && role === 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/superadmin', request.url));
    }

    return NextResponse.next();
  } catch {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/admin/:path*', '/pos/:path*', '/superadmin/:path*', '/login'],
};
