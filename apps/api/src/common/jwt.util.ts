import { sign, verify, type JwtPayload } from 'jsonwebtoken';

export const LICENSE_BLOCKED_MESSAGE =
  'Su licencia de MiniMarket OS ha expirado o se encuentra suspendida. Contacte al administrador (Darío Betances)';

export interface TokenPayload extends JwtPayload {
  sub: string;
  email?: string | null;
  username: string;
  role: string;
  tenantId?: string | null;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload {
  return verify(token, getSecret()) as TokenPayload;
}

export const COOKIE_NAMES = {
  accessToken: 'mm_access_token',
  tenantId: 'mm_tenant_id',
} as const;
