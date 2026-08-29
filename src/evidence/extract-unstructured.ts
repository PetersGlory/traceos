import { z } from "zod";
import { generateStructured } from "../lib/llm.js";
import { EvidenceItem, type EvidenceType } from "../schemas/investigation.js";

/**
 * Deterministic-once-normalized evidence extraction from unstructured text.
 *
 * Chat transcripts and receipts are free text, so we make exactly ONE LLM call
 * to normalize them into the shared EvidenceItem schema (via native Gemini
 * structured output). We capture the raw text verbatim so the analyst report
 * can show the original source alongside the normalized reading.
 *
 * Structured CSV sources are NOT routed here — that path is deterministic
 * (see extract-structured.ts). This function is only for chat/receipt text.
 */

const UnstructuredOutput = z.object({
  items: z.array(
    z.object({
      timestamp: z.string(),
      ref: z.string().optional(),
      parties: z.array(z.string()).optional(),
      amountMinor: z.number().int().optional(),
      status: z.string().optional(),
      description: z.string(),
    }),
  ),
});

/**
 * Normalize free-text evidence (chat or receipt) into EvidenceItem[].
 *
 * @param sourceName e.g. "customer_chat.txt" — used as evidence source id.
 * @param type Which EvidenceType to tag the produced items as.
 * @param text The raw unstructured text.
 */
export async function extractUnstructured(
  sourceName: string,
  type: Extract<EvidenceType, "chat" | "receipt">,
  text: string,
): Promise<EvidenceItem[]> {
  const prompt = [
    "You are an evidence normalizer for a payment/order dispute investigation.",
    `Source file: ${sourceName}`,
    "",
    "Extract every relevant event from the following unstructured text. ",
    "Return a JSON array of items. For each item include:",
    "- timestamp: ISO-8601 or best-effort readable timestamp of the event",
    "- ref: transaction / order / txn reference if any is mentioned",
    "- parties: customer ids, order ids, provider/bank ids mentioned",
    "- amountMinor: monetary amount in minor units (kobo/cents) when the event ",
    "  involves money; omit otherwise",
    "- status: the outcome state mentioned (e.g. success, failed, refunded, pending)",
    "- description: one concise sentence describing the event",
    "",
    "Do not invent values. If a field is not present in the text, omit it.",
    "Keep amounts to whole numbers in minor units.",
    "",
    `TEXT:\n${text}`,
  ].join("\n");

  const output = await generateStructured(UnstructuredOutput, prompt);

  return output.items.map((it, i) => ({
    id: `${sourceName}:${i + 1}`,
    source: sourceName,
    type,
    timestamp: it.timestamp,
    statement: it.description,
    ...(it.ref !== undefined ? { ref: it.ref } : {}),
    ...(it.parties !== undefined ? { parties: it.parties } : {}),
    ...(it.amountMinor !== undefined ? { amountMinor: it.amountMinor } : {}),
    ...(it.status !== undefined ? { status: it.status } : {}),
    raw: it.description,
  }));
}
