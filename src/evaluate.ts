import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCase } from "./data/load-case.js";
import {
  GroundTruth,
  type Investigation,
  type GroundTruth as GroundTruthType,
} from "./schemas/investigation.js";
import { investigateCase, resolvedDisputedCustomer } from "./workflow/investigate.js";
import { renderHtmlReport } from "./report/render-html.js";
import { renderAsciiReport } from "./report/render-ascii.js";
import { toTimelineEvents } from "./lib/prompt.js";
import { hasGeminiKey } from "./lib/gemini.js";

/**
 * Eval harness.
 *
 * Runs the baseline and the agent pipeline across every case, scores each
 * system's structured output against ground_truth (no free-text grading),
 * writes browser-ready HTML reports, and prints a comparison table.
 */

const CASES_DIR = "cases";
const TRAJECTORIES_DIR = "evidence/trajectories";
const REPORT_DIR = "report";
const RESULTS_FILE = "results.json";

interface SystemScore {
  correctVerifiedCustomer: boolean;
  correctClaimValidity: boolean;
  surfacedContradiction: boolean;
  passed: boolean;
}

interface CaseResult {
  caseId: string;
  difficulty: string;
  baseline: SystemScore | null;
  agent: SystemScore | null;
}

function scoreInvestigation(
  inv: Investigation,
  gt: GroundTruthType,
): SystemScore {
  const correctVerifiedCustomer =
    inv.verifiedCustomer === gt.correct_verified_customer;
  const correctClaimValidity =
    inv.claimIsValid === gt.disputed_customer_claim_is_valid;

  // Contradiction is "surfaced" when the disputed ref, the real successful txn,
  // or the actual status appears anywhere the system wrote about contradictions.
  const kc = gt.key_contradiction;
  const searchable = [
    inv.conclusion,
    inv.keyFinding,
    ...inv.findings,
    ...inv.contradictions,
  ].join(" ");
  let surfacedContradiction = false;
  if (kc) {
    if (kc.claimed_ref && searchable.includes(kc.claimed_ref)) {
      surfacedContradiction = true;
    }
    if (kc.real_successful_txn && searchable.includes(kc.real_successful_txn)) {
      surfacedContradiction = true;
    }
    if (kc.actual_status && searchable.toLowerCase().includes(kc.actual_status.toLowerCase())) {
      surfacedContradiction = true;
    }
  } else {
    // No contradiction in ground truth (clean case) -> nothing to surface.
    surfacedContradiction = true;
  }

  const passed =
    correctVerifiedCustomer && correctClaimValidity && surfacedContradiction;

  return { correctVerifiedCustomer, correctClaimValidity, surfacedContradiction, passed };
}

async function runAll(): Promise<CaseResult[]> {
  if (!hasGeminiKey()) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your key before running the eval.",
    );
  }

  const caseDirs = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(CASES_DIR, d.name))
    .sort();

  const results: CaseResult[] = [];

  for (const dir of caseDirs) {
    const gtRaw = JSON.parse(
      readFileSync(join(dir, "ground_truth.json"), "utf8"),
    );
    const gt = GroundTruth.parse(gtRaw);

    const loaded = await loadCase(dir);

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
      console.log(renderAsciiReport(baseline, {
        approved: true,
        reasoning: "",
        confidence: baseline.confidence,
        unsupportedClaims: [],
        missingEvidence: [],
        contradictionErrors: [],
      }));
      console.log(`\n[baseline] ${loaded.caseId}\n`);
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
      console.log(renderAsciiReport(
        agent.investigation,
        agent.verification,
      ));
      console.log(`\n[agent] ${loaded.caseId}\n`);
    }

    results.push({
      caseId: loaded.caseId,
      difficulty: gt.difficulty,
      baseline: baseline ? scoreInvestigation(baseline, gt) : null,
      agent: agent ? scoreInvestigation(agent.investigation, gt) : null,
    });
  }

  return results;
}

function renderTable(results: CaseResult[]): string {
  const yes = (b: boolean | null | undefined) =>
    b === true ? "PASS" : b === false ? "FAIL" : "  - ";
  const rows = results
    .map(
      (r) =>
        `| ${r.caseId} | ${r.difficulty} | ${yes(r.baseline?.passed)} | ${yes(
          r.agent?.passed,
        )} | ${r.baseline ? `${(100 * summaryCount(r.baseline)).toFixed(0)}` : "-"}/${r.agent ? `${(100 * summaryCount(r.agent)).toFixed(0)}` : "-"} |`,
    )
    .join("\n");

  return [
    "## Evaluation results",
    "",
    "| Case | difficulty | Baseline | Agent | Score% |",
    "|---|---|---|---|---|",
    rows,
    "",
    "Scoring: names the correct verified customer + flags claim validity correctly + surfaces the right contradiction.",
  ].join("\n");
}

function summaryCount(s: SystemScore): number {
  return [s.correctVerifiedCustomer, s.correctClaimValidity, s.surfacedContradiction].filter(
    Boolean,
  ).length / 3;
}

export async function evaluate(): Promise<void> {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(TRAJECTORIES_DIR, { recursive: true });

  const results = await runAll();

  const table = renderTable(results);
  console.log("\n" + table);

  writeFileSync(
    RESULTS_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
    "utf8",
  );
}

if (process.argv[1]?.endsWith("evaluate.ts")) {
  evaluate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
