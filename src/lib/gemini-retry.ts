/**
 * Retry wrapper for transient LLM transport errors (429 rate-limit / 5xx
 * server unavailability).
 *
 * Wraps a single LLM call. On a retryable status we wait before trying again:
 *  - exponential backoff (3s * 2^attempt, capped at 30s), or
 *  - the backend's Retry-After header when the SDK exposes it.
 *
 * Non-transient errors are rethrown immediately; retries are capped. If the
 * backend still fails after the cap, we rethrow a clean, human-readable error
 * (the raw SDK error is often a JSON blob like {"error":{...}}).
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
  const candidates = [e?.status, e?.response?.status, e?.code].filter(
    (v): v is string | number =>
      typeof v === "number" || (typeof v === "string" && v.trim() !== ""),
  );
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** A transient, retryable transport status: 429 rate-limit or 5xx server error. */
function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500 && status < 600);
}

/** Exported so the router can decide when to trip a provider's circuit breaker. */
export function providerErrorStatus(err: unknown): number | undefined {
  return errorStatus(err);
}

/**
 * Turn an SDK error into a clean, human-readable message.
 *
 * Provider SDKs (notably the Gemini SDK) throw an `Error` whose `.message` is a
 * raw JSON blob such as `{"error":{"code":503,"message":"This model is currently
 * experiencing high demand...","status":"UNAVAILABLE"}}`. We parse that to show
 * only the meaningful line, and fall back to the original message otherwise.
 */
export function cleanErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    const raw = err.message;
    // Only attempt JSON deconstruction when the message looks like a JSON object.
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        const nested = (obj?.error ?? obj) as {
          message?: unknown;
          code?: unknown;
          status?: unknown;
        } | null;
        if (nested && typeof nested.message === "string" && nested.message) {
          return nested.message;
        }
      } catch {
        // Not valid JSON after all — fall through to raw message.
      }
    }
    return raw;
  }
  return String(err);
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
 * Runs `fn`, retrying on transient transport errors (429, 5xx) with capped
 * exponential backoff (or Retry-After). All other errors are thrown immediately.
 * After exhausting retries, throws a clean human-readable message.
 *
 * `label` is the provider name, used only for log messages / Retry-After pacing.
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts: { label?: string; maxRetries?: number } = {},
): Promise<T> {
  const label = opts.label ?? "gemini";
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = errorStatus(err);
      if (!isRetryableStatus(status) || attempt >= maxRetries) {
        // Non-transient, or retries exhausted. Surface a clean message.
        if (status !== undefined && status !== 429) {
          throw new Error(cleanErrorMessage(err));
        }
        throw err;
      }

      const retryAfter = retryAfterSeconds(err);
      if (retryAfter !== undefined) {
        await waitForRetryAfter(label, retryAfter);
      } else {
        const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
        console.log(`⚠ LLM transport hit (status ${status}). Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      attempt++;
    }
  }
}
