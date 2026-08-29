/**
 * TraceOS AI router.
 *
 * Provider-independent structured-output generation with automatic fallback and
 * per-provider circuit breaking.
 *
 *   generateStructured(schema, prompt)
 *
 * tries the configured providers in order (default Groq → OpenRouter → Gemini)
 * and, on failure (429 / network / empty / Zod-validation), falls back to the
 * next one. Each attempt is paced by a per-provider rate limiter and retried on
 * transient 429/5xx with backoff.
 *
 * Circuit breaker: a provider that keeps failing (especially an exhausted
 * free-tier quota) is "tripped" for a short cooldown and skipped instantly on
 * subsequent calls, so we don't waste minutes retrying a dead provider.
 *
 * Provider selection:
 *   AI_PROVIDER   "auto" (default) or an explicit comma-separated order,
 *                 e.g. "groq,openrouter,gemini". Providers without a key are
 *                 skipped. "auto" resolves to [groq, openrouter, gemini].
 *   AI_FALLBACK   "true" (default) — try the next provider after a failure.
 *
 * This file is the single import point for call sites. (src/lib/gemini.ts is
 * now only the Gemini transport and is imported internally.)
 */
import "dotenv/config";
import { z } from "zod";
import { callGeminiJson, hasGeminiKey } from "./gemini.js";
import { callOpenAICompatible } from "./provider.js";
import { waitForSlot } from "./rate-limit.js";
import { withGeminiRetry, providerErrorStatus, cleanErrorMessage } from "./gemini-retry.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : undefined;
}

const groqKey = () => env("GROQ_API_KEY");
const openrouterKey = () => env("OPENROUTER_API_KEY");

export function hasAnyProviderKey(): boolean {
  return Boolean(groqKey() || openrouterKey() || hasGeminiKey());
}

/** Model IDs; env-overridable because provider free-model catalogs change often. */
function groqModel(): string {
  return env("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
}
function openrouterModel(): string {
  return env("OPENROUTER_MODEL") ?? "meta-llama/llama-3.2-3b-instruct:free";
}

type ProviderName = "groq" | "openrouter" | "gemini";

interface ProviderSpec {
  name: ProviderName;
  hasKey: boolean;
  run: (p: { prompt: string; jsonSchema: Record<string, unknown> }) => Promise<{ text: string; provider: string }>;
}

function configuredProviders(): ProviderSpec[] {
  const specs: Record<ProviderName, ProviderSpec> = {
    groq: {
      name: "groq",
      hasKey: Boolean(groqKey()),
      run: ({ prompt, jsonSchema }) =>
        callOpenAICompatible({
          label: "groq",
          baseURL: GROQ_BASE,
          apiKey: groqKey() ?? "",
          model: groqModel(),
          systemPrompt: prompt,
          jsonSchema,
        }),
    },
    openrouter: {
      name: "openrouter",
      hasKey: Boolean(openrouterKey()),
      run: ({ prompt, jsonSchema }) =>
        callOpenAICompatible({
          label: "openrouter",
          baseURL: OPENROUTER_BASE,
          apiKey: openrouterKey() ?? "",
          model: openrouterModel(),
          systemPrompt: prompt,
          jsonSchema,
        }),
    },
    gemini: {
      name: "gemini",
      hasKey: hasGeminiKey(),
      run: ({ prompt, jsonSchema }) => callGeminiJson({ prompt, jsonSchema }),
    },
  };

  const requested = env("AI_PROVIDER");
  let order: ProviderName[];
  if (requested && requested.toLowerCase() !== "auto") {
    order = requested
      .split(",")
      .map((s) => s.trim().toLowerCase() as ProviderName)
      .filter((p) => p === "groq" || p === "openrouter" || p === "gemini");
    if (order.length === 0) order = ["groq", "openrouter", "gemini"];
  } else {
    order = ["groq", "openrouter", "gemini"];
  }

  return order.map((name) => specs[name]).filter((s) => s.hasKey);
}

export interface ProviderStats {
  attempts: Record<string, number>;
  successes: Record<string, number>;
  fallbackEvents: number;
  totalCalls: number;
  tripped: Record<string, number>;
}

const stats: ProviderStats = {
  attempts: {},
  successes: {},
  fallbackEvents: 0,
  totalCalls: 0,
  tripped: {},
};

/** Reset counters (e.g. at the start of an eval run). */
export function resetProviderStats(): void {
  stats.attempts = {};
  stats.successes = {};
  stats.fallbackEvents = 0;
  stats.totalCalls = 0;
  stats.tripped = {};
}

export function getProviderStats(): ProviderStats {
  return {
    attempts: { ...stats.attempts },
    successes: { ...stats.successes },
    fallbackEvents: stats.fallbackEvents,
    totalCalls: stats.totalCalls,
    tripped: { ...stats.tripped },
  };
}

// --- Circuit breaker ---

interface BreakerState {
  failures: number;
  openUntil: number;
}

const BREAK_THRESHOLD = 1;
const COOLDOWN_MS = 90_000;

const breakers = new Map<ProviderName, BreakerState>();

function isTripped(name: ProviderName): boolean {
  const b = breakers.get(name);
  return b !== undefined && b.openUntil > Date.now();
}

function recordFailure(name: ProviderName): void {
  const b = breakers.get(name) ?? { failures: 0, openUntil: 0 };
  b.failures += 1;
  if (b.failures >= BREAK_THRESHOLD) {
    b.openUntil = Date.now() + COOLDOWN_MS;
    stats.tripped[name] = (stats.tripped[name] ?? 0) + 1;
    console.log(`⚠ Router: provider "${name}" tripped (cooldown ${COOLDOWN_MS / 1000}s) — will be skipped on next calls.`);
  }
  breakers.set(name, b);
}

function recordSuccess(name: ProviderName): void {
  const b = breakers.get(name);
  if (b) {
    b.failures = 0;
    b.openUntil = 0;
    breakers.set(name, b);
  }
}

/**
 * Run a single structured-output call through the provider router.
 * @param schema Zod schema describing the expected output (validated on success).
 * @param prompt System + user instructions for the call.
 */
export async function generateStructured<T extends z.ZodTypeAny>(
  schema: T,
  prompt: string,
): Promise<z.infer<T>> {
  const allProviders = configuredProviders();
  if (allProviders.length === 0) {
    throw new Error(
      "No AI provider key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in .env.",
    );
  }

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const allowFallback = env("AI_FALLBACK")?.toLowerCase() !== "false";

  const providers = allProviders.filter((p) => !isTripped(p.name));
  if (providers.length === 0) {
    // Everyone is tripped; still allow the first configured provider so we don't
    // silently fail, and report that the others are cooling down.
    providers.push(allProviders[0]);
  }

  let lastError: unknown = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isFallback = i > 0;

    try {
      const statsKey = provider.name;
      stats.attempts[statsKey] = (stats.attempts[statsKey] ?? 0) + 1;

      const result = await withGeminiRetry(
        async () => {
          await waitForSlot(provider.name);
          return provider.run({ prompt, jsonSchema });
        },
        { label: provider.name, maxRetries: 2 },
      );

      const parsed: unknown = JSON.parse(result.text);
      const validated = schema.parse(parsed);

      stats.totalCalls++;
      stats.successes[statsKey] = (stats.successes[statsKey] ?? 0) + 1;
      if (isFallback) stats.fallbackEvents++;
      recordSuccess(provider.name);

      return validated;
    } catch (err) {
      lastError = err;
      const status = providerErrorStatus(err);
      // Quota/rate errors (429) ⇒ trip immediately; other transient/5xx also count.
      recordFailure(provider.name);
      if (!allowFallback) throw err;
      if (status === 429) {
        console.log(`⚠ Router: "${provider.name}" hit a 429 — falling back to the next provider.`);
      } else {
        console.log(`⚠ Router: "${provider.name}" failed (${status ?? "unknown status"}) — falling back to the next provider.`);
      }
      // Fall through to the next provider.
    }
  }

  throw new Error(
    lastError !== null
      ? cleanErrorMessage(lastError)
      : "All AI providers failed.",
  );
}
