import { ApaleoError } from './errors.js';

export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_BASE_MS = 1_000;
const JITTER_MS = 250;

export interface HttpOptions {
  fetchFn: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1) for backoff jitter. */
  random: () => number;
  timeoutMs: number;
}

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A response whose body has been read completely. */
export interface HttpResult {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

/**
 * Sends a request, reads its whole body and retries rate limits (429, after
 * `Retry-After`, capped at 60 s), server errors (5xx) and network errors or
 * timeouts up to 4 times with exponential backoff and jitter. A connection that
 * breaks or times out while the body is still arriving counts as a network
 * error, so a large export is retried too. Any other response is returned to
 * the caller. `what` describes the call in error messages, for example
 * `export-gross-daily for property BSP, business day 2026-09-14`.
 */
export async function fetchWithRetry(url: string, init: RequestInit, what: string, http: HttpOptions): Promise<HttpResult> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt === MAX_RETRIES;
    let response: Response;
    let text: string | undefined;
    try {
      response = await http.fetchFn(url, { ...init, signal: AbortSignal.timeout(http.timeoutMs) });
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable) await response.body?.cancel();
      else text = await response.text();
    } catch (error) {
      if (last) throw new ApaleoError(`${what}: no answer from apaleo after ${attempt + 1} attempts (${networkReason(error, http)}).`);
      await http.sleep(backoff(attempt, http));
      continue;
    }
    if (text !== undefined) return { status: response.status, ok: response.ok, headers: response.headers, text };
    if (last) {
      const reason = response.status === 429 ? 'rate limit (HTTP 429) still exceeded' : `HTTP ${response.status}`;
      throw new ApaleoError(`${what}: apaleo failed after ${attempt + 1} attempts: ${reason}. Try again later.`, response.status);
    }
    const retryAfter = response.status === 429 ? retryAfterMs(response.headers.get('retry-after'), http.now()) : undefined;
    await http.sleep(retryAfter ?? backoff(attempt, http));
  }
}

function backoff(attempt: number, http: HttpOptions): number {
  return BACKOFF_BASE_MS * 2 ** attempt + Math.floor(http.random() * JITTER_MS);
}

/** `Retry-After` in seconds or as an HTTP date, capped at 60 s. Undefined when missing or unreadable. */
export function retryAfterMs(header: string | null, now: Date): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const value = header.trim();
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now.getTime();
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

function networkReason(error: unknown, http: HttpOptions): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `timed out after ${http.timeoutMs / 1000} s`;
  return error instanceof Error ? error.message : String(error);
}
