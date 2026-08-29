/**
 * Per-provider rate limiting.
 *
 * Free-tier GenAI endpoints enforce requests-per-minute (RPM) caps, but the cap
 * is different per provider (Groq free is generous, Gemini free-tier is tight,
 * OpenRouter free models are usually ample). We pace LLM calls to stay under
 * each provider's cap WITHOUT throttling fast providers to the slowest one's
 * pace.
 *
 * The minimum interval between calls is configurable:
 *   RATE_INTERVAL_MS_<LABEL>  e.g. RATE_INTERVAL_MS_GROQ (per provider)
 *   RATE_INTERVAL_MS          global fallback for all providers
 *   GEMINI_RATE_INTERVAL_MS   legacy alias for the gemini provider
 *
 * Defaults are chosen to be reasonably safe yet fast; bump a provider's interval
 * only if you actually see 429s from it.
 */

const DEFAULT_MIN_INTERVAL_MS = 1_500;

// Per-provider defaults for the common providers.
const PROVIDER_DEFAULTS: Record<string, number> = {
  groq: 2_000,
  openrouter: 1_500,
  gemini: 5_000,
};

/** Resolve the minimum interval (ms) for a given provider label. */
function configIntervalMs(label: string): number {
  const upper = label.toUpperCase();

  const specific = process.env[`RATE_INTERVAL_MS_${upper}`]?.trim();
  if (specific) {
    const n = Number(specific);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Legacy alias used by earlier versions of TraceOS.
  const legacyGemini = process.env["GEMINI_RATE_INTERVAL_MS"]?.trim();
  if (upper === "GEMINI" && legacyGemini) {
    const n = Number(legacyGemini);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const global = process.env["RATE_INTERVAL_MS"]?.trim();
  if (global) {
    const n = Number(global);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return PROVIDER_DEFAULTS[label] ?? DEFAULT_MIN_INTERVAL_MS;
}

const lastRequestAt = new Map<string, number>();

/**
 * Pause so that consecutive calls to `label` are spaced far enough apart to stay
 * under that provider's free-tier RPM cap. Call right before issuing a request.
 */
export async function waitForSlot(label: string): Promise<void> {
  const minInterval = configIntervalMs(label);
  const now = Date.now();
  const last = lastRequestAt.get(label) ?? 0;
  const elapsed = now - last;

  if (elapsed < minInterval) {
    const wait = minInterval - elapsed;
    if (wait > 250) {
      console.log(`⏳ Rate limiter [${label}]: waiting ${Math.ceil(wait / 1000)}s...`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  lastRequestAt.set(label, Date.now());
}

/**
 * Wait for a specific 429 Retry-After grace period (in seconds) reported by the
 * API. Prefer this over the generic spacing when the backend tells us exactly
 * how long to wait.
 */
export async function waitForRetryAfter(
  label: string,
  retryAfterSeconds: number,
): Promise<void> {
  const waitMs = Math.max(500, Math.ceil(retryAfterSeconds * 1_000));
  console.log(`⏳ Rate limiter [${label}]: honoring Retry-After, waiting ${Math.ceil(waitMs / 1000)}s...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt.set(label, Date.now());
}
