import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCase } from "./data/load-case.js";
import {
  GroundTruth,
  type Investigation,
  type GroundTruth as GroundTruthType,
} from "./schemas/investigation.js";
import { investigateCase, resolvedDisputedCustomer } from "./workflow/investigate.js";
import { hasTrajectory } from "./trace.js";
import { renderHtmlReport } from "./report/render-html.js";
import { renderAsciiReport } from "./report/render-ascii.js";
import { toTimelineEvents } from "./lib/prompt.js";
import { hasAnyProviderKey, getProviderStats, resetProviderStats } from "./lib/llm.js";

/**
 * Eval harness.
 *
 * Runs the baseline and the agent pipeline across every case, scores each
 * system's structured output against ground_truth (no free-text grading),
 * writes browser-ready HTML reports, and prints a comparison table.
 *
 * Trajectories are cached under evidence/trajectories: a case whose results
 * already exist is reloaded instead of re-running Gemini (unless --force is
 * passed). This makes repeated scoring runs free of API quota usage.
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

async function runAll(opts: { useCache: boolean }): Promise<CaseResult[]> {
  if (!hasAnyProviderKey()) {
    throw new Error(
      "No AI provider key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in .env before running the eval.",
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
      useCache: opts.useCache,
    });

    if (!baseline && !agent) {
      throw new Error(`No results produced for ${loaded.caseId}`);
    }

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

  resetProviderStats();
  const results = await runAll({ useCache: useCacheEnabled() });

  const cached =
    results.filter((r) => {
      const b = hasTrajectory(TRAJECTORIES_DIR, r.caseId, "baseline");
      const a = hasTrajectory(TRAJECTORIES_DIR, r.caseId, "agent");
      return b && a;
    }).length;

  const stats = getProviderStats();

  const table = renderTable(results);
  console.log("\n" + table);
  console.log(
    `\n${results.length} cases · ${cached} cached · ${results.length - cached} fresh (LLM)`,
  );
  if (stats.totalCalls > 0) {
    const attemptsTotal = Object.values(stats.attempts).reduce((a, b) => a + b, 0);
    const successShare = (100 * (stats.totalCalls / attemptsTotal)).toFixed(0);
    console.log(
      `AI routing: ${successShare}% of calls succeeded on first try · ${stats.fallbackEvents} needed a provider fallback`,
    );
    for (const [name, n] of Object.entries(stats.successes)) {
      console.log(`  - ${name}: ${n} successful call${n === 1 ? "" : "s"}`);
    }
  }

  writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results, providerStats: stats },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Whether the eval may reuse cached trajectories.
 *  - `--force` on the CLI bypasses the cache;
 *  - otherwise falls back to the `EVAL_USE_CACHE` env var (default true).
 */
export function useCacheEnabled(): boolean {
  if (process.argv.includes("--force")) {
    console.log("ℹ --force: ignoring cached trajectories, re-running the LLM pipeline.");
    return false;
  }
  const env = process.env.EVAL_USE_CACHE?.trim();
  if (env !== undefined && env !== "") {
    return env.toLowerCase() !== "false" && env.toLowerCase() !== "0";
  }
  return true;
}

if (process.argv[1]?.endsWith("evaluate.ts")) {
  evaluate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
