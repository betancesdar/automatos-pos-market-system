export const COOKIE_NAMES = {
  accessToken: 'mm_access_token',
  tenantId: 'mm_tenant_id',
} as const;

export const LICENSE_BLOCKED_CODE = 'LICENSE_BLOCKED';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER';
  tenantId: string | null;
}

export class LicenseBlockedError extends Error {
  code = LICENSE_BLOCKED_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'LicenseBlockedError';
  }
}

function parseError(data: Record<string, unknown>): string {
  const msg = data.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string') return msg;
  return (data.error as string) || 'Request failed';
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 403 && data.code === LICENSE_BLOCKED_CODE) {
      throw new LicenseBlockedError(parseError(data));
    }
    throw new Error(parseError(data));
  }
  return data as T;
}

export async function apiFetch<T>(
  path: string,
  tenantId: string,
  options?: RequestInit,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const res = await fetch(`/api/proxy${path}${separator}tenantId=${encodeURIComponent(tenantId)}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return handleResponse<T>(res);
}

export async function superadminFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return handleResponse<T>(res);
}

export async function authLogin(email: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

export async function authMe(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  return handleResponse<AuthUser>(res);
}

export async function authLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
