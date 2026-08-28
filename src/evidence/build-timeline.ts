import type { EvidenceItem } from "../schemas/investigation.js";

/**
 * Deterministic timeline construction — pure sort, no LLM.
 */

/** Best-effort parse of a timestamp string to a sortable epoch millis. */
function toEpoch(ts: string): number {
  const n = Date.parse(ts);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/**
 * Return evidence sorted chronologically (ascending by timestamp).
 * Items with unparseable timestamps are placed at the end, stable-sorted.
 */
export function buildTimeline(items: EvidenceItem[]): EvidenceItem[] {
  return [...items].sort(
    (a, b) => toEpoch(a.timestamp) - toEpoch(b.timestamp),
  );
}
