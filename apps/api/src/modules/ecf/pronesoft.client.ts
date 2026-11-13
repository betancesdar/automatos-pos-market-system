import { Injectable, Logger } from '@nestjs/common';

/**
 * HTTP client for the Pronesoft e-CF REST API — MODELO MATRIZ / MULTIEMPRESA.
 *
 * Verificado en https://docs.ecf.pronesoft.com (2026-11):
 * - OAuth 2.0 client credentials (una sola App de la MATRIZ):
 *     POST {base}/oauth/token  {clientId, clientSecret} → { accessToken, expiresIn: 86400 }
 *   El token de la matriz opera por TODAS sus empresas asociadas mediante el
 *   header `x-tenant-id: <id asociada>`. Un solo token compartido.
 * - Base URLs (incluyen /api/v1):
 *     sandbox: https://api.ecf.sandbox.pronesoft.com/api/v1
 *     prod:    https://api.ecf.pronesoft.com/api/v1
 * - Ambiente en el PATH (submit/status): TesteCF | CerteCF | eCF.
 * - Emitir:  POST {base}/{env}/ecf/submit   (+ x-tenant-id)
 * - Estado:  GET  {base}/{env}/ecf/status/{id}  (+ x-tenant-id)
 * - Asociadas: GET {base}/associated-companies?page&limit
 * - Secuencias (ambiente = query): GET {base}/tax-sequences, GET /tax-sequences/next,
 *     POST /tax-sequences/create, POST /tax-sequences/void.
 *
 * El token se cachea por AMBIENTE (una credencial matriz), no por comercio.
 */

const SANDBOX_BASE_URL = 'https://api.ecf.sandbox.pronesoft.com/api/v1';
const PROD_BASE_URL = 'https://api.ecf.pronesoft.com/api/v1';
const TOKEN_SKEW_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Credencial de la App matriz para un ambiente dado. */
export interface MatrizCreds {
  environment: string; // "sandbox" | "prod"
  clientId: string;
  clientSecret: string;
}

export class PronesoftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

@Injectable()
export class PronesoftClient {
  private readonly logger = new Logger(PronesoftClient.name);
  // cache por ambiente (p. ej. "sandbox" / "prod")
  private tokenCache = new Map<string, CachedToken>();

  private baseUrl(environment: string): string {
    if (environment === 'prod') return process.env.PRONESOFT_PROD_URL || PROD_BASE_URL;
    return process.env.PRONESOFT_SANDBOX_URL || SANDBOX_BASE_URL;
  }

  /** Segmento de ambiente para submit/status. */
  envPath(environment: string): string {
    if (environment === 'prod') return process.env.PRONESOFT_PROD_ENV_PATH || 'eCF';
    return process.env.PRONESOFT_SANDBOX_ENV_PATH || 'TesteCF';
  }

  invalidateToken(environment: string) {
    this.tokenCache.delete(environment);
  }

  private async getToken(creds: MatrizCreds): Promise<string> {
    const cached = this.tokenCache.get(creds.environment);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await fetch(`${this.baseUrl(creds.environment)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PronesoftApiError(`Autenticación Pronesoft falló (${res.status})`, res.status, body);
    }
    const token =
      (body.accessToken as string) ?? (body.access_token as string) ?? (body.token as string);
    if (!token) throw new PronesoftApiError('Pronesoft: no se recibió token', res.status, body);

    const expiresInSec = Number(body.expiresIn ?? body.expires_in ?? 86400);
    this.tokenCache.set(creds.environment, {
      token,
      expiresAt: Date.now() + expiresInSec * 1000 - TOKEN_SKEW_MS,
    });
    return token;
  }

  /** Fetch autenticado con la credencial matriz; opcionalmente actúa por una asociada. */
  private async authedFetch(
    creds: MatrizCreds,
    path: string,
    init: RequestInit,
    businessId?: string | null,
  ): Promise<Record<string, unknown>> {
    const doFetch = async (): Promise<Response> => {
      const token = await this.getToken(creds);
      return fetch(`${this.baseUrl(creds.environment)}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(businessId ? { 'x-tenant-id': businessId } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    };

    let res = await doFetch();
    if (res.status === 401) {
      this.logger.warn(`Pronesoft 401 (${creds.environment}) — renovando token`);
      this.invalidateToken(creds.environment);
      res = await doFetch();
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PronesoftApiError(
        `Pronesoft ${init.method} ${path} falló (${res.status}): ${JSON.stringify(body).slice(0, 500)}`,
        res.status,
        body,
      );
    }
    return body;
  }

  /** Emite un e-CF en nombre de la empresa asociada (businessId → x-tenant-id). */
  async submit(creds: MatrizCreds, payload: Record<string, unknown>, businessId?: string | null) {
    return this.authedFetch(
      creds,
      `/${this.envPath(creds.environment)}/ecf/submit`,
      { method: 'POST', body: JSON.stringify(payload) },
      businessId,
    );
  }

  /** Consulta el estado de un documento. */
  async status(creds: MatrizCreds, documentId: string, businessId?: string | null) {
    return this.authedFetch(
      creds,
      `/${this.envPath(creds.environment)}/ecf/status/${documentId}`,
      { method: 'GET' },
      businessId,
    );
  }

  /** Lista las empresas asociadas a la cuenta matriz. */
  async listAssociatedCompanies(creds: MatrizCreds, page = 1, limit = 100) {
    return this.authedFetch(
      creds,
      `/associated-companies?page=${page}&limit=${limit}`,
      { method: 'GET' },
    );
  }

  /** Secuencias e-NCF de una asociada (saldo/estado). */
  async getSequences(creds: MatrizCreds, businessId: string | null, type?: string) {
    const env = this.envPath(creds.environment);
    const q = `environment=${env}${type ? `&type=${type}` : ''}`;
    return this.authedFetch(creds, `/tax-sequences?${q}`, { method: 'GET' }, businessId);
  }

  async getNextSequence(creds: MatrizCreds, businessId: string | null, type: string) {
    const env = this.envPath(creds.environment);
    return this.authedFetch(
      creds,
      `/tax-sequences/next?type=${type}&environment=${env}`,
      { method: 'GET' },
      businessId,
    );
  }

  async createSequence(creds: MatrizCreds, businessId: string | null, body: Record<string, unknown>) {
    const env = this.envPath(creds.environment);
    return this.authedFetch(
      creds,
      `/tax-sequences/create`,
      { method: 'POST', body: JSON.stringify({ environment: env, ...body }) },
      businessId,
    );
  }
}
