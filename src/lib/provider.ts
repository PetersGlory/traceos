/**
 * Provider transport layer.
 *
 * TraceOS is provider-independent: every LLM call ultimately lands in one of
 * the providers here. Groq and OpenRouter expose OpenAI-compatible APIs, so we
 * use the `openai` SDK pointed at their base URLs. Gemini uses the native
 * @google/genai SDK with backend JSON-Schema structured output.
 *
 * Structured output strategy (portable across all OpenAI-compatible providers):
 * we ask for `response_format: { type: "json_object" }` and embed the JSON
 * schema (from Zod via z.toJSONSchema) into the system prompt, then validate
 * the response with Zod in the router. This works on Groq, OpenRouter and any
 * other OpenAI-compatible endpoint without provider-specific json_schema modes.
 */

import OpenAI from "openai";

const clients = new Map<string, OpenAI>();
function openAiClient(baseURL: string, apiKey: string): OpenAI {
  const key = `${baseURL}|${apiKey ? "set" : "unset"}`;
  let c = clients.get(key);
  if (!c) {
    c = new OpenAI({ apiKey: apiKey || "missing", baseURL });
    clients.set(key, c);
  }
  return c;
}

export interface JsonCallResult {
  text: string;
  provider: string;
}

/** Prompt that asks the model to emit JSON matching the given schema. */
function jsonEnforcedPrompt(systemPrompt: string, jsonSchema: Record<string, unknown>): string {
  return [
    systemPrompt,
    "",
    "You MUST respond with a single JSON object that conforms exactly to this JSON Schema:",
    JSON.stringify(jsonSchema),
    "Do not wrap it in markdown fences. Output only the JSON.",
  ].join("\n");
}

/**
 * Call an OpenAI-compatible endpoint (Groq, OpenRouter, ...).
 * `baseURL` should be e.g. "https://api.groq.com/openai/v1".
 */
export async function callOpenAICompatible(params: {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
}): Promise<JsonCallResult> {
  if (!params.apiKey) {
    throw new Error(`${params.label}: API key is not set (${params.label.toUpperCase()}_API_KEY).`);
  }
  const client = openAiClient(params.baseURL, params.apiKey);
  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: jsonEnforcedPrompt(params.systemPrompt, params.jsonSchema) },
    ],
    response_format: { type: "json_object" },
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`${params.label}: returned no content.`);
  }
  return { text, provider: params.label };
}
