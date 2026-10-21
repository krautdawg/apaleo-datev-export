import { describe, expect, it } from 'vitest';
import { ApaleoError } from '../../src/sources/apaleo/errors.js';
import { brokenBody } from '../helpers/apaleo.js';
import { MAX_RETRIES, REQUEST_TIMEOUT_MS, fetchWithRetry, retryAfterMs, type HttpOptions } from '../../src/sources/apaleo/http.js';

const NOW = new Date('2026-10-20T08:00:00Z');

/** Answers fetch calls from a list, in order; an Error entry is thrown. */
function scripted(answers: (Response | Error)[], overrides: Partial<HttpOptions> = {}) {
  const sleeps: number[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  let calls = 0;
  const http: HttpOptions = {
    fetchFn: async (_input, init) => {
      signals.push(init?.signal);
      const answer = answers[calls++];
      if (!answer) throw new Error('no more scripted answers');
      if (answer instanceof Error) throw answer;
      return answer;
    },
    now: () => NOW,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...overrides,
  };
  const send = () => fetchWithRetry('https://api.apaleo.com/x', { method: 'POST' }, 'export-gross-daily for property BSP', http);
  return { send, sleeps, signals, calls: () => calls };
}

const status = (code: number, headers: Record<string, string> = {}) => new Response(code === 204 ? null : 'x', { status: code, headers });

describe('fetchWithRetry', () => {
  it('waits for Retry-After on 429, retries once and returns the data', async () => {
    const { send, sleeps, calls } = scripted([status(429, { 'Retry-After': '2' }), Response.json({ ok: true })]);
    const response = await send();
    expect(JSON.parse(response.text)).toEqual({ ok: true });
    expect(sleeps).toEqual([2000]);
    expect(calls()).toBe(2);
  });

  it('retries 5xx up to 4 times with exponential backoff and jitter', async () => {
    const { send, sleeps, calls } = scripted([status(503), status(500), status(502), status(504), status(200)], {
      random: () => 0.5,
    });
    expect((await send()).status).toBe(200);
    expect(sleeps).toEqual([1125, 2125, 4125, 8125]);
    expect(calls()).toBe(MAX_RETRIES + 1);
  });

  it('gives up after the fourth retry and names the call', async () => {
    const { send, calls } = scripted(Array.from({ length: 5 }, () => status(500)));
    const error = await send().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApaleoError);
    expect((error as Error).message).toBe(
      'export-gross-daily for property BSP: apaleo failed after 5 attempts: HTTP 500. Try again later.',
    );
    expect(calls()).toBe(5);
  });

  it('reports a rate limit that does not clear', async () => {
    const { send } = scripted(Array.from({ length: 5 }, () => status(429)));
    await expect(send()).rejects.toThrow('rate limit (HTTP 429) still exceeded');
  });

  it('retries network errors and timeouts', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { send, sleeps } = scripted([new TypeError('fetch failed'), timeout, status(200)]);
    expect((await send()).status).toBe(200);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('retries when the connection breaks while the body is still arriving', async () => {
    const { send, sleeps, calls } = scripted([brokenBody(), Response.json({ ok: true })]);
    const response = await send();
    expect(JSON.parse(response.text)).toEqual({ ok: true });
    expect(sleeps).toEqual([1000]);
    expect(calls()).toBe(2);
  });

  it('reports a body that keeps breaking after the last attempt', async () => {
    const { send, calls } = scripted(Array.from({ length: 5 }, brokenBody));
    await expect(send()).rejects.toThrow('no answer from apaleo after 5 attempts (terminated)');
    expect(calls()).toBe(5);
  });

  it('reports a timeout after the last attempt', async () => {
    const timeout = () => new DOMException('timeout', 'TimeoutError');
    const { send } = scripted(Array.from({ length: 5 }, timeout));
    await expect(send()).rejects.toThrow('no answer from apaleo after 5 attempts (timed out after 60 s)');
  });

  it('returns other statuses to the caller without retrying', async () => {
    for (const code of [200, 204, 400, 401, 403, 404, 422]) {
      const { send, calls } = scripted([status(code)]);
      expect((await send()).status).toBe(code);
      expect(calls()).toBe(1);
    }
  });

  it('passes a 60 s timeout signal that aborts a hanging request', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(60_000);
    const http: HttpOptions = {
      fetchFn: (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      now: () => NOW,
      sleep: async () => undefined,
      random: () => 0,
      timeoutMs: 5,
    };
    await expect(fetchWithRetry('https://api.apaleo.com/x', {}, 'call', http)).rejects.toThrow('timed out after 0.005 s');
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and HTTP dates and caps at 60 s', () => {
    expect(retryAfterMs('2', NOW)).toBe(2000);
    expect(retryAfterMs('120', NOW)).toBe(60_000);
    expect(retryAfterMs('Tue, 20 Oct 2026 08:00:05 GMT', NOW)).toBe(5000);
    expect(retryAfterMs('Tue, 20 Oct 2026 07:00:00 GMT', NOW)).toBe(0);
  });

  it('falls back to backoff for a missing or unreadable header', () => {
    expect(retryAfterMs(null, NOW)).toBeUndefined();
    expect(retryAfterMs('', NOW)).toBeUndefined();
    expect(retryAfterMs('soon', NOW)).toBeUndefined();
  });
});
