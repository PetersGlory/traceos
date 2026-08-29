/**
 * Gemini transport.
 *
 * This module only knows how to talk to Google's Gemini API with native
 * backend JSON-Schema structured output. The provider router (src/lib/llm.ts)
 * decides WHEN to call this (as the Gemini node in the fallback chain).
 *
 * Call sites should import from src/lib/llm.ts, not from here.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import type { JsonCallResult } from "./provider.js";

const apiKey = process.env.GEMINI_API_KEY;

export function hasGeminiKey(): boolean {
  return Boolean(apiKey);
}

/** Lazily-created client so modules can import without a key present. */
let _client: GoogleGenAI | null = null;
export function geminiClient(): GoogleGenAI {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/** Model used for Gemini calls; overridable via GEMINI_MODEL in .env. */
export const geminiModel =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/**
 * Run a single Gemini call constrained to `jsonSchema` and return the raw text.
 * @param prompt The system+user instructions for the call.
 * @param jsonSchema Native JSON Schema describing the expected output.
 */
export async function callGeminiJson(params: {
  prompt: string;
  jsonSchema: Record<string, unknown>;
}): Promise<JsonCallResult> {
  const response = await geminiClient().models.generateContent({
    model: geminiModel,
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    config: {
      responseMimeType: "application/json",
      // The SDK auto-moves a schema containing `$schema` into `responseJsonSchema`,
      // enabling native backend JSON Schema structured output.
      responseSchema: params.jsonSchema as never,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no text for structured output.");
  }
  return { text, provider: "gemini" };
}
