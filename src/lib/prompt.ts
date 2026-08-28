import type { EvidenceItem, TimelineEvent } from "../schemas/investigation.js";

/**
 * Shared prompt-building + shaping helpers used by the baseline and the agents.
 */

/** Human-readable one-line per evidence item, with its id for citation. */
export function evidenceBlock(
  evidence: EvidenceItem[],
  disputedCustomer: string,
): string {
  const header = [
    `DISPUTED CUSTOMER: ${disputedCustomer}`,
    "",
    "EVIDENCE (id | source | type | timestamp | statement):",
    ...evidence.map(
      (e) =>
        `- [${e.id}] (${e.source}, ${e.type}, ${e.timestamp || "?"}) ` +
        `${e.statement ?? ""}${e.ref ? ` [${e.ref}]` : ""}` +
        `${e.amountMinor !== undefined ? ` amount=${e.amountMinor / 100}` : ""}` +
        `${e.status ? ` status=${e.status}` : ""}`,
    ),
  ].join("\n");
  return header;
}

/** Convert sorted EvidenceItem[] into the TimelineEvent[] the report renders. */
export function toTimelineEvents(evidence: EvidenceItem[]): TimelineEvent[] {
  return evidence.map((e) => ({
    timestamp: e.timestamp,
    event: e.statement || `Event from ${e.source}`,
    evidenceId: e.id,
    importance: e.status === "success" || e.status === "failed" ? "high" : "medium",
  }));
}
