import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal HTTP client for the Pronesoft e-CF API.
 *
 * Verified against the official SDK docs (pronesoft-rd/ecf-sdk-php):
 * - OAuth 2.0 client credentials: POST /oauth/token {clientId, clientSecret}
 *   → Bearer JWT valid 24h.
 * - Submission: POST /{environment}/ecf/submit — Pronesoft signs the XML and
 *   talks to DGII. In sandbox the body must carry environment: "TesteCF".
 *
 * Tokens are cached in-memory per tenant (24h validity; a process restart
 * simply re-authenticates). Single-instance deployment makes this safe.
 */

const SANDBOX_BASE_URL = 'https://api.ecf.sandbox.pronesoft.com/api/v1';

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
    if (environment === 'prod') {
      // Production base URL is configurable until confirmed with Pronesoft.
      return process.env.PRONESOFT_PROD_URL || 'https://api.ecf.pronesoft.com/api/v1';
    }
    return process.env.PRONESOFT_SANDBOX_URL || SANDBOX_BASE_URL;
  }

  /** Path segment for POST /{environment}/ecf/submit. */
  private envPath(environment: string): string {
    if (environment === 'prod') {
      return process.env.PRONESOFT_PROD_ENV_PATH || 'eCF';
    }
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
      body: JSON.stringify({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PronesoftApiError(
        `Pronesoft auth failed (${res.status})`,
        res.status,
        body,
      );
    }

    const token =
      (body.access_token as string) ??
      (body.accessToken as string) ??
      (body.token as string);
    if (!token) {
      throw new PronesoftApiError('Pronesoft auth: no token in response', res.status, body);
    }

    // Docs: token valid 24h — cache for 23h to stay safe.
    this.tokenCache.set(config.tenantId, {
      token,
      expiresAt: Date.now() + 23 * 60 * 60 * 1000,
    });
    return token;
  }

  /**
   * Submits an e-CF document. Returns the raw API response (trackId etc.).
   * Retries once on 401 after invalidating the cached token.
   */
  async submit(
    config: PronesoftConfig,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const doSubmit = async (): Promise<Response> => {
      const token = await this.getToken(config);
      return fetch(
        `${this.baseUrl(config.environment)}/${this.envPath(config.environment)}/ecf/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
    };

    let res = await doSubmit();
    if (res.status === 401) {
      this.logger.warn(`Pronesoft 401 for tenant ${config.tenantId} — refreshing token`);
      this.invalidateToken(config.tenantId);
      res = await doSubmit();
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PronesoftApiError(
        `Pronesoft submit failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`,
        res.status,
        body,
      );
    }
    return body;
  }
}
