import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvidenceItem } from "../schemas/investigation.js";
import { extractUnstructured } from "../evidence/extract-unstructured.js";
import {
  extractStructuredCsv,
  STRUCTURED_CSV_SPECS,
} from "../evidence/extract-structured.js";
import { buildTimeline } from "../evidence/build-timeline.js";

/**
 * Load a case folder into normalized evidence + timeline.
 *
 * File routing:
 *  - Known CSV files (orders.csv, payment_provider.csv, bank_settlement.csv)
 *    are parsed deterministically (no LLM).
 *  - chat / receipt text files are normalized via one LLM call each.
 *
 * ground_truth.json is loaded separately by the eval harness, not here.
 */

export interface LoadedCase {
  caseId: string;
  caseDir: string;
  evidence: EvidenceItem[];
  timeline: EvidenceItem[];
}

/** Unstructured files we know how to normalize, mapped to their EvidenceType. */
const UNSTRUCTURED_FILES: Record<string, "chat" | "receipt"> = {
  "customer_chat.txt": "chat",
  "receipt.txt": "receipt",
};

export async function loadCase(caseDir: string): Promise<LoadedCase> {
  const caseId = caseDir.split(/[\\/]/).filter(Boolean).pop() || "case";

  const evidence: EvidenceItem[] = [];

  // Structured CSV sources — deterministic.
  for (const fileName of Object.keys(STRUCTURED_CSV_SPECS)) {
    const path = join(caseDir, fileName);
    const csvText = await safeRead(path);
    if (csvText === null) continue;
    const spec = STRUCTURED_CSV_SPECS[fileName];
    evidence.push(...extractStructuredCsv(fileName, csvText, spec));
  }

  // Unstructured text sources — one LLM call each.
  for (const [fileName, type] of Object.entries(UNSTRUCTURED_FILES)) {
    const path = join(caseDir, fileName);
    const text = await safeRead(path);
    if (text === null) continue;
    evidence.push(...(await extractUnstructured(fileName, type, text)));
  }

  return {
    caseId,
    caseDir,
    evidence,
    timeline: buildTimeline(evidence),
  };
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
