import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { waitForGeminiSlot } from "./rate-limit.js";
import { withGeminiRetry } from "./gemini-retry.js";

/**
 * Shared Gemini client + structured-output helper.
 *
 * Every LLM call in TraceOS goes through `generateStructured`. It:
 *  - converts a Zod v4 schema to a JSON Schema using the native `z.toJSONSchema()`
 *    (NOT the old third-party `zod-to-json-schema`, which breaks under Zod v4),
 *  - requests native JSON structured output from Gemini,
 *  - parses + validates the response with the same Zod schema.
 *
 * The @google/genai SDK auto-moves a `responseSchema` that contains a `$schema`
 * key (which `z.toJSONSchema()` emits) into `responseJsonSchema`, so the native
 * backend JSON Schema path is used automatically.
 */

const apiKey = process.env.GEMINI_API_KEY;

export function hasGeminiKey(): boolean {
  return Boolean(apiKey);
}

/** Lazily-created client so modules can import without a key present. */
let _client: GoogleGenAI | null = null;
export function geminiClient(): GoogleGenAI {
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/** Model used for all LLM calls; overridable via GEMINI_MODEL in .env. */
const model =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/**
 * Run a single Gemini call constrained to `schema` and return validated output.
 *
 * @param schema Zod schema describing the expected output.
 * @param prompt System + user instructions for the call.
 * @returns The parsed, validated output matching `schema`'s inferred type.
 */
export async function generateStructured<T extends z.ZodTypeAny>(
  schema: T,
  prompt: string,
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  // The actual Gemini call is wrapped so that:
  //  - every request is paced by the free-tier rate limiter, and
  //  - a 429 (quota exceeded) is retried with backoff.
  return withGeminiRetry(async () => {
    await waitForGeminiSlot();

    const response = await geminiClient().models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        // The SDK auto-moves a schema containing `$schema` into `responseJsonSchema`,
        // enabling native backend JSON Schema structured output.
        responseSchema: jsonSchema as never,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned no text for structured output.");
    }

    const parsed: unknown = JSON.parse(text);
    return schema.parse(parsed);
  });
}
