/**
 * Gemini rate limiting.
 *
 * Free-tier projects enforce a requests-per-minute (RPM) cap at the project
 * level (e.g. 5 RPM). TraceOS fires many calls per eval run, so we pace all
 * LLM calls to stay under the cap instead of relying on luck.
 *
 * The minimum interval between calls is configurable via GEMINI_RATE_INTERVAL_MS
 * (.env) so you can tune it to your project's actual limit. Default 13000ms is
 * safe for a 5 RPM cap (~4.6 req/min).
 */

const DEFAULT_MIN_INTERVAL_MS = 13_000;

function configMinIntervalMs(): number {
  const raw = process.env.GEMINI_RATE_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_MIN_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_INTERVAL_MS;
}

let lastRequestAt = 0;

/**
 * Pause so that consecutive Gemini calls are spaced far enough apart to stay
 * under the project free-tier RPM cap. Call right before issuing a request.
 */
export async function waitForGeminiSlot(): Promise<void> {
  const minInterval = configMinIntervalMs();
  const now = Date.now();
  const elapsed = now - lastRequestAt;

  if (elapsed < minInterval) {
    const wait = minInterval - elapsed;
    console.log(`⏳ Gemini rate limiter: waiting ${Math.ceil(wait / 1000)}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  lastRequestAt = Date.now();
}

/**
 * Wait for a specific 429 Retry-After grace period (in seconds) reported by the
 * API. Prefer this over the generic spacing when the backend tells us exactly
 * how long to wait.
 */
export async function waitForRetryAfter(
  retryAfterSeconds: number,
): Promise<void> {
  const waitMs = Math.max(1_000, Math.ceil(retryAfterSeconds * 1_000));
  console.log(`⏳ Gemini 429: waiting ${Math.ceil(waitMs / 1000)}s per Retry-After...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}
