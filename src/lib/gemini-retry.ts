/**
 * Retry wrapper for Gemini 429 (rate-limit / quota-exceeded) errors.
 *
 * Wraps a single LLM call. On a 429 we wait before retrying:
 *  - exponential backoff (3s * 2^attempt, capped at 30s), or
 *  - the backend's Retry-After header when the SDK exposes it.
 *
 * Non-429 errors are rethrown immediately; retries are capped.
 */

import { waitForRetryAfter } from "./rate-limit.js";

const DEFAULT_MAX_RETRIES = 4;
const BASE_DELAY_MS = 3_000;
const MAX_DELAY_MS = 30_000;

/** Extract the HTTP status from an SDK/network error, if present. */
function errorStatus(err: unknown): number | undefined {
  const e = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown; headers?: Record<string, unknown> };
  };
  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.response?.status === "number"
        ? e.response?.status
        : typeof e.code === "number"
          ? e.code
          : undefined;
  return status ?? (typeof status === "string" ? Number(status) : undefined);
}

/** Extract a Retry-After header (seconds) if the error carries one. */
function retryAfterSeconds(err: unknown): number | undefined {
  const e = err as { response?: { headers?: Record<string, unknown> } };
  const h = e?.response?.headers;
  if (!h) return undefined;
  const raw = h["retry-after"] ?? h["Retry-After"] ?? h["retryAfter"];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Runs `fn`, retrying on 429 with capped exponential backoff (or Retry-After).
 * All other errors are thrown immediately.
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (errorStatus(err) !== 429 || attempt >= maxRetries) {
        throw err;
      }

      const retryAfter = retryAfterSeconds(err);
      if (retryAfter !== undefined) {
        await waitForRetryAfter(retryAfter);
      } else {
        const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
        console.log(`⚠ Gemini rate limit hit. Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      attempt++;
    }
  }
}
