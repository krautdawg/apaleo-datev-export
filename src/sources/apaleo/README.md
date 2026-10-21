# src/sources/apaleo

The apaleo source adapter (`ApaleoSource`, built by `createApaleoSource`). It reads, never writes, through `ctx.fetchFn` only.

| File | Job |
|---|---|
| `adapter.ts` | `SourceAdapter` implementation: properties, chart of accounts, ledger per business day (concurrency 2, `Idempotency-Key` per run), daily aggregates |
| `token.ts` | client-credentials token (`client_secret_basic`), cached until 60 s before expiry |
| `client.ts` | authenticated calls: 401 renews the token once, 403 lists the permissions, 204 is empty |
| `http.ts` | retries: 429 after `Retry-After` (max 60 s), 5xx and network errors up to 4 times with backoff; 60 s timeout |
| `schemas.ts` | zod schemas mirroring the Swagger models; unknown enum values stay strings |
| `parse.ts` | conversion to the canonical types in `src/core/source.ts` (integer cents, sub-cent guard on ledger amounts) |
| `live-questions.ts` | facts `live-smoke` reports about real data |

Fixtures and the Swagger excerpt live in `test/fixtures/apaleo/`. See `docs/apaleo-source.md` for endpoints and permissions.
