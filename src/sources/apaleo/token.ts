import { z } from 'zod';
import { ApaleoError, CREDENTIALS_HINT, redact } from './errors.js';
import { fetchWithRetry, type HttpOptions } from './http.js';

/** A cached token is renewed this long before apaleo says it expires. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenOptions {
  identityUrl: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated; sent only when set. */
  scopes?: string | undefined;
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const oauthError = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/) });

/**
 * OAuth client-credentials tokens from apaleo identity, sent with
 * `client_secret_basic`. The token is cached in memory until 60 s before it
 * expires; parallel callers share one request.
 */
export class TokenClient {
  private cached: { token: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(
    private readonly options: TokenOptions,
    private readonly http: HttpOptions,
  ) {}

  /** The current token, if one was fetched, so callers can redact it from messages. */
  get currentToken(): string | undefined {
    return this.cached?.token;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.http.now().getTime() < this.cached.expiresAt - EXPIRY_MARGIN_MS) return this.cached.token;
    this.pending ??= this.requestToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Forgets the cached token, for example after apaleo answered 401. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async requestToken(): Promise<string> {
    const { identityUrl, clientId, clientSecret, scopes } = this.options;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (scopes) body.set('scope', scopes);
    const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
    const response = await fetchWithRetry(
      `${identityUrl}/connect/token`,
      {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      },
      'apaleo login (token request)',
      this.http,
    );
    const json = parseJson(response.text);
    if (!response.ok) throw this.loginError(response.status, json);

    const parsed = tokenResponse.safeParse(json);
    if (!parsed.success) throw new ApaleoError('apaleo login: the token response has no access_token or expires_in.');
    this.cached = {
      token: parsed.data.access_token,
      expiresAt: this.http.now().getTime() + parsed.data.expires_in * 1000,
    };
    return parsed.data.access_token;
  }

  private loginError(status: number, json: unknown): ApaleoError {
    const code = oauthError.safeParse(json);
    const detail = code.success ? `, ${code.data.error}` : '';
    const message =
      status === 400 || status === 401
        ? `apaleo did not accept the client credentials (HTTP ${status}${detail}). ${CREDENTIALS_HINT}`
        : `apaleo login failed (HTTP ${status}${detail}).`;
    return new ApaleoError(redact(message, [this.options.clientSecret]), status);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
