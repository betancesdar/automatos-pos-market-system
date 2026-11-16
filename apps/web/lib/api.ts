export const COOKIE_NAMES = {
  accessToken: 'mm_access_token',
  tenantId: 'mm_tenant_id',
} as const;

export const LICENSE_BLOCKED_CODE = 'LICENSE_BLOCKED';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER' | 'BILLER' | 'ACCOUNTANT';
  tenantId: string | null;
  // Permisos efectivos (RBAC). '*' = todos (SUPER_ADMIN).
  permissions?: string[];
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
  // Some endpoints (e.g. a controller returning `null`) yield an empty body,
  // which would throw on JSON.parse. Treat empty bodies as `null`.
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 403 && data?.code === LICENSE_BLOCKED_CODE) {
      throw new LicenseBlockedError(parseError(data));
    }
    throw new Error(parseError(data ?? {}));
  }
  return data as T;
}

export async function apiFetch<T>(
  path: string,
  tenantId: string,
  options?: RequestInit,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  
  // Check for impersonation token
  const impersonationToken = typeof window !== 'undefined' 
    ? localStorage.getItem('impersonation_token') 
    : null;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers as Record<string, string>,
  };
  
  // Add Bearer token if impersonating
  if (impersonationToken) {
    headers['Authorization'] = `Bearer ${impersonationToken}`;
  }
  
  const res = await fetch(`/api/proxy${path}${separator}tenantId=${encodeURIComponent(tenantId)}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  return handleResponse<T>(res);
}

/** Descarga autenticada (CSV/XLSX/PDF): trae el blob y dispara la descarga en el navegador. */
export async function apiDownload(path: string, tenantId: string, fallbackName = 'archivo'): Promise<void> {
  const separator = path.includes('?') ? '&' : '?';
  const impersonationToken = typeof window !== 'undefined' ? localStorage.getItem('impersonation_token') : null;
  const headers: Record<string, string> = {};
  if (impersonationToken) headers['Authorization'] = `Bearer ${impersonationToken}`;

  const res = await fetch(`/api/proxy${path}${separator}tenantId=${encodeURIComponent(tenantId)}`, {
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = 'Error al descargar';
    try { msg = parseError(JSON.parse(text)); } catch { /* keep default */ }
    throw new Error(msg);
  }
  const cd = res.headers.get('content-disposition') || '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Subida autenticada de un archivo (multipart). No fija Content-Type (lo pone el navegador). */
export async function apiUpload<T>(path: string, tenantId: string, formData: FormData): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const impersonationToken = typeof window !== 'undefined' ? localStorage.getItem('impersonation_token') : null;
  const headers: Record<string, string> = {};
  if (impersonationToken) headers['Authorization'] = `Bearer ${impersonationToken}`;

  const res = await fetch(`/api/proxy${path}${separator}tenantId=${encodeURIComponent(tenantId)}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
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

export async function authLogin(identifier: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const data = await handleResponse<{ user: AuthUser }>(res);
  return data.user;
}

export async function authMe(): Promise<AuthUser | null> {
  // Check for impersonation token
  const impersonationToken = typeof window !== 'undefined' 
    ? localStorage.getItem('impersonation_token') 
    : null;
  
  const headers: Record<string, string> = {};
  if (impersonationToken) {
    headers['Authorization'] = `Bearer ${impersonationToken}`;
  }
  
  const res = await fetch('/api/auth/me', { 
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
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
