/**
 * TraceOS CLI entry point.
 *
 * Usage:
 *   npm run dev -- <caseDir>        run baseline + agent on one case,
 *                                   write report/<caseId>.*.html, print ASCII
 *   npm run eval                    run and score both systems on all cases
 *
 * Requires GEMINI_API_KEY in .env.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadCase } from "./data/load-case.js";
import { investigateCase, resolvedDisputedCustomer } from "./workflow/investigate.js";
import { renderHtmlReport } from "./report/render-html.js";
import { renderAsciiReport } from "./report/render-ascii.js";
import { toTimelineEvents } from "./lib/prompt.js";
import { hasGeminiKey } from "./lib/gemini.js";

const TRAJECTORIES_DIR = "evidence/trajectories";
const REPORT_DIR = "report";

async function main(): Promise<void> {
  if (!hasGeminiKey()) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }

  const caseDir = process.argv[2] ?? "cases/case-01-demo";
  const loaded = await loadCase(caseDir);

  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(TRAJECTORIES_DIR, { recursive: true });

  console.log(`Case:      ${loaded.caseId}`);
  console.log(`Disputed:  ${resolvedDisputedCustomer(loaded.evidence)}`);
  console.log(`Evidence:  ${loaded.evidence.length} items`);

  const { baseline, agent } = await investigateCase(loaded, {
    systems: ["baseline", "agent"],
    trajectoriesDir: TRAJECTORIES_DIR,
  });

  if (baseline) {
    writeFileSync(
      `${REPORT_DIR}/${loaded.caseId}.baseline.html`,
      renderHtmlReport({
        caseId: loaded.caseId,
        investigation: baseline,
        verification: {
          approved: true,
          reasoning: "Baseline single-pass (no verifier).",
          confidence: baseline.confidence,
          unsupportedClaims: [],
          missingEvidence: [],
          contradictionErrors: [],
        },
        evidence: loaded.evidence,
        timeline: toTimelineEvents(loaded.timeline),
      }),
      "utf8",
    );
    console.log("\n===== BASELINE =====");
    console.log(
      renderAsciiReport(baseline, {
        approved: true,
        reasoning: "",
        confidence: baseline.confidence,
        unsupportedClaims: [],
        missingEvidence: [],
        contradictionErrors: [],
      }),
    );
  }

  if (agent) {
    writeFileSync(
      `${REPORT_DIR}/${loaded.caseId}.agent.html`,
      renderHtmlReport({
        caseId: loaded.caseId,
        investigation: agent.investigation,
        verification: agent.verification,
        evidence: loaded.evidence,
        timeline: toTimelineEvents(loaded.timeline),
        wasRetried: agent.wasRetried,
      }),
      "utf8",
    );
    console.log("\n===== AGENT PIPELINE =====");
    console.log(renderAsciiReport(agent.investigation, agent.verification));
    console.log(`\nHtml reports: report/${loaded.caseId}.baseline.html and .agent.html`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
