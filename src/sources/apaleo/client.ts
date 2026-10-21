import { ApaleoError, ApaleoPermissionError, CREDENTIALS_HINT, redact } from './errors.js';
import { fetchWithRetry, type HttpOptions, type HttpResult } from './http.js';
import type { TokenClient } from './token.js';

const MAX_DETAIL_LENGTH = 300;

export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  query: Record<string, string>;
  headers?: Record<string, string>;
  /** Describes the call in error messages. */
  what: string;
}

export type ApiResult = { status: 204 } | { status: 200; json: unknown };

/**
 * Authenticated calls to the apaleo API. Retries come from `fetchWithRetry`; a
 * 401 renews the token once, a 403 fails with the permission list, and 204 is
 * returned as an empty result.
 */
export class ApaleoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenClient,
    private readonly http: HttpOptions,
    private readonly secrets: readonly string[],
  ) {}

  async call(request: ApiRequest): Promise<ApiResult> {
    try {
      return await this.send(request);
    } catch (error) {
      if (error instanceof ApaleoError) throw error;
      throw new ApaleoError(this.redact(`${request.what}: ${(error as Error).message}`));
    }
  }

  private async send(request: ApiRequest): Promise<ApiResult> {
    const url = `${this.baseUrl}${request.path}?${new URLSearchParams(request.query).toString()}`;
    for (let renewed = false; ; renewed = true) {
      const token = await this.tokens.getToken();
      const response = await fetchWithRetry(
        url,
        {
          method: request.method,
          headers: { ...request.headers, authorization: `Bearer ${token}`, accept: 'application/json' },
        },
        request.what,
        this.http,
      );
      if (response.status === 401 && !renewed) {
        this.tokens.invalidate();
        continue;
      }
      return this.interpret(response, request.what);
    }
  }

  private interpret(response: HttpResult, what: string): ApiResult {
    if (response.status === 204) return { status: 204 };
    if (response.status === 401) {
      throw new ApaleoError(`apaleo rejected the access token for ${what} (HTTP 401). ${CREDENTIALS_HINT}`, 401);
    }
    if (response.status === 403) throw new ApaleoPermissionError(what);
    const body = response.text;
    if (!response.ok) {
      const detail = body.trim() ? `: ${this.redact(body.trim()).slice(0, MAX_DETAIL_LENGTH)}` : '';
      throw new ApaleoError(`${what}: apaleo answered HTTP ${response.status}${detail}`, response.status);
    }
    try {
      return { status: 200, json: JSON.parse(body) as unknown };
    } catch {
      throw new ApaleoError(`${what}: apaleo answered HTTP ${response.status} with a body that is not JSON.`);
    }
  }

  private redact(text: string): string {
    return redact(text, [...this.secrets, this.tokens.currentToken]);
  }
}
