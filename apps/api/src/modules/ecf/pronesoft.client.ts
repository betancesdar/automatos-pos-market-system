import { Injectable, Logger } from '@nestjs/common';

/**
 * HTTP client for the Pronesoft e-CF REST API.
 *
 * Verified against https://docs.ecf.pronesoft.com (2026-11):
 * - OAuth 2.0 client credentials:
 *     POST {base}/oauth/token  body JSON {clientId, clientSecret}
 *     → { accessToken, tokenType:"Bearer", expiresIn:86400, scope:[...] }
 *     No refresh token; re-request when near expiry (5-min skew) or on 401.
 * - Base URLs (include the /api/v1 segment):
 *     sandbox: https://api.ecf.sandbox.pronesoft.com/api/v1
 *     prod:    https://api.ecf.pronesoft.com/api/v1
 * - The ENVIRONMENT goes in the URL path, NOT the body: TesteCF | CerteCF | eCF.
 * - Submit: POST {base}/{env}/ecf/submit  (Bearer) → 201 { id, status:"REGISTERED", encf, ... }
 * - Status: GET  {base}/{env}/ecf/status/{id} (Bearer) → { status, legalStatus, trackId, encf, ... }
 *
 * Tokens are cached in-memory per tenant. Single-instance deployment makes
 * this safe; a restart simply re-authenticates.
 */

const SANDBOX_BASE_URL = 'https://api.ecf.sandbox.pronesoft.com/api/v1';
const PROD_BASE_URL = 'https://api.ecf.pronesoft.com/api/v1';
const TOKEN_SKEW_MS = 5 * 60 * 1000; // renovar 5 min antes de expirar

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface PronesoftConfig {
  tenantId: string;
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
  private tokenCache = new Map<string, CachedToken>();

  private baseUrl(environment: string): string {
    if (environment === 'prod') return process.env.PRONESOFT_PROD_URL || PROD_BASE_URL;
    return process.env.PRONESOFT_SANDBOX_URL || SANDBOX_BASE_URL;
  }

  /** URL path segment: sandbox → TesteCF, prod → eCF (CerteCF para certificación DGII). */
  private envPath(environment: string): string {
    if (environment === 'prod') return process.env.PRONESOFT_PROD_ENV_PATH || 'eCF';
    return process.env.PRONESOFT_SANDBOX_ENV_PATH || 'TesteCF';
  }

  invalidateToken(tenantId: string) {
    this.tokenCache.delete(tenantId);
  }

  private async getToken(config: PronesoftConfig): Promise<string> {
    const cached = this.tokenCache.get(config.tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await fetch(`${this.baseUrl(config.environment)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PronesoftApiError(`Autenticación Pronesoft falló (${res.status})`, res.status, body);
    }

    const token =
      (body.accessToken as string) ?? (body.access_token as string) ?? (body.token as string);
    if (!token) {
      throw new PronesoftApiError('Pronesoft: no se recibió token', res.status, body);
    }

    const expiresInSec = Number(body.expiresIn ?? body.expires_in ?? 86400);
    this.tokenCache.set(config.tenantId, {
      token,
      expiresAt: Date.now() + expiresInSec * 1000 - TOKEN_SKEW_MS,
    });
    return token;
  }

  private async authedFetch(config: PronesoftConfig, path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const doFetch = async (): Promise<Response> => {
      const token = await this.getToken(config);
      return fetch(`${this.baseUrl(config.environment)}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    };

    let res = await doFetch();
    if (res.status === 401) {
      this.logger.warn(`Pronesoft 401 (tenant ${config.tenantId}) — renovando token`);
      this.invalidateToken(config.tenantId);
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

  /** Envía un e-CF. Respuesta 201: { id, status:"REGISTERED", encf, ... }. */
  async submit(config: PronesoftConfig, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authedFetch(config, `/${this.envPath(config.environment)}/ecf/submit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Consulta el estado de un documento por su id de Pronesoft. */
  async status(config: PronesoftConfig, documentId: string): Promise<Record<string, unknown>> {
    return this.authedFetch(config, `/${this.envPath(config.environment)}/ecf/status/${documentId}`, {
      method: 'GET',
    });
  }
}
