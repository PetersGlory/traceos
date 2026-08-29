/**
 * TraceOS AI router.
 *
 * Provider-independent structured-output generation with automatic fallback.
 *
 *   generateStructured(schema, prompt)
 *
 * tries the configured providers in order (default Groq → OpenRouter → Gemini)
 * and, on failure (429 / network / empty / Zod-validation), falls back to the
 * next one. Every attempt is paced by the shared rate limiter and retried on
 * 429 with backoff.
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
import { waitForGeminiSlot } from "./rate-limit.js";
import { withGeminiRetry } from "./gemini-retry.js";

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
  return env("OPENROUTER_MODEL") ?? "meta-llama/llama-3.3-70b-instruct:free";
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
}

const stats: ProviderStats = {
  attempts: {},
  successes: {},
  fallbackEvents: 0,
  totalCalls: 0,
};

/** Reset counters (e.g. at the start of an eval run). */
export function resetProviderStats(): void {
  stats.attempts = {};
  stats.successes = {};
  stats.fallbackEvents = 0;
  stats.totalCalls = 0;
}

export function getProviderStats(): ProviderStats {
  return {
    attempts: { ...stats.attempts },
    successes: { ...stats.successes },
    fallbackEvents: stats.fallbackEvents,
    totalCalls: stats.totalCalls,
  };
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
  const providers = configuredProviders();
  if (providers.length === 0) {
    throw new Error(
      "No AI provider key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in .env.",
    );
  }

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const allowFallback = env("AI_FALLBACK")?.toLowerCase() !== "false";

  let lastError: unknown = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isFallback = i > 0;

    try {
      const statsKey = provider.name;
      stats.attempts[statsKey] = (stats.attempts[statsKey] ?? 0) + 1;

      const result = await withGeminiRetry(async () => {
        await waitForGeminiSlot();
        return provider.run({ prompt, jsonSchema });
      });

      const parsed: unknown = JSON.parse(result.text);
      const validated = schema.parse(parsed);

      stats.totalCalls++;
      stats.successes[statsKey] = (stats.successes[statsKey] ?? 0) + 1;
      if (isFallback) stats.fallbackEvents++;

      return validated;
    } catch (err) {
      lastError = err;
      if (!allowFallback) throw err;
      // Otherwise fall through to the next provider.
    }
  }

  throw lastError ?? new Error("All AI providers failed.");
}
