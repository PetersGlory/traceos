/**
 * TraceOS CLI entry point (Phase 2 will implement the full run pipeline).
 */
import { loadCase } from "./data/load-case.js";

const caseDir = process.argv[2] ?? "cases/case-01-demo";

const loaded = await loadCase(caseDir);

console.log(`Loaded case: ${loaded.caseId}`);
console.log(`Evidence items: ${loaded.evidence.length}`);
console.log("\nTimeline:");
for (const item of loaded.timeline) {
  const amount = item.amountMinor !== undefined ? ` ${item.amountMinor}` : "";
  console.log(
    `  [${item.timestamp || "?"}] ${item.type} ${item.ref ?? ""}${amount} ${item.source} (${item.raw.slice(0, 60)})`,
  );
}
