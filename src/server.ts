/**
 * TraceOS web service.
 *
 * A minimal Express wrapper around the existing investigate.ts workflow so
 * judges can click a case and watch the real agent pipeline run, rather than
 * only using the CLI. Routes:
 *
 *   GET /                 - HTML index listing all cases
 *   GET /cases            - JSON list of { caseId, difficulty?, files }
 *   GET /cases/:caseId    - run the live pipeline and return the HTML dossier
 *
 * Requires at least one AI provider key (GROQ_API_KEY, OPENROUTER_API_KEY, or
 * GEMINI_API_KEY) in the environment (Render: set the key(s) as dashboard
 * secrets; never commit them).
 */
import "dotenv/config";
import express from "express";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCase } from "./data/load-case.js";
import { resolveCaseDir } from "./cases.js";
import { investigateCase } from "./workflow/investigate.js";
import { renderHtmlReport } from "./report/render-html.js";
import { toTimelineEvents } from "./lib/prompt.js";
import { hasAnyProviderKey } from "./lib/llm.js";

const CASES_DIR = "cases";
const TRAJECTORIES_DIR = "evidence/trajectories";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const KNOWN_SYSTEMS = ["baseline", "agent"] as const;

interface CaseMeta {
  caseId: string;
  difficult: boolean;
}

function listCases(): CaseMeta[] {
  const dirs = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs.map((name) => {
    let difficult = false;
    const gtPath = join(CASES_DIR, name, "ground_truth.json");
    if (existsSync(gtPath)) {
      try {
        const gt = JSON.parse(readFileSync(gtPath, "utf8")) as {
          difficulty?: unknown;
        };
        difficult = String(gt.difficulty ?? "").toLowerCase() === "hard";
      } catch {
        // ignore
      }
    }
    return { caseId: name, difficult };
  });
}

function indexHtml(cases: CaseMeta[]): string {
  const rows = cases
    .map(
      (c) =>
        `<li><a href="/cases/${encodeURIComponent(c.caseId)}">${c.caseId}</a>${
          c.difficult ? " <em>(hard / ambiguous)</em>" : ""
        }</li>`,
    )
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>TraceOS — evidence investigations</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1a1a1a;line-height:1.5}
  h1{font-size:1.6rem} a{color:#0b57d0}
  .note{background:#f5f5f5;border-left:4px solid #888;padding:8px 12px;border-radius:4px}
  code{background:#eee;padding:1px 5px;border-radius:3px}
</style></head>
<body>
  <h1>TraceOS</h1>
  <p>Evidence-driven payment/order dispute investigation. Pick a case to run the
     live agent pipeline (baseline + investigator&#8594;contradiction&#8594;verifier) and view the dossier.</p>
  ${
    hasAnyProviderKey()
      ? ""
      : `<p class="note">ℹ No AI provider key configured — the case pages will show an error until <code>GROQ_API_KEY</code>, <code>OPENROUTER_API_KEY</code>, or <code>GEMINI_API_KEY</code> is set.</p>`
  }
  <h2>Cases</h2>
  <ul>
${rows}
  </ul>
</body></html>`;
}

async function runInvestigation(caseId: string): Promise<string> {
  const caseDir = resolveCaseDir(CASES_DIR, caseId);
  if (!caseDir) {
    throw new Error(`Unknown case: ${caseId}`);
  }

  mkdirSync(TRAJECTORIES_DIR, { recursive: true });
  const loaded = await loadCase(caseDir);

  const { baseline, agent } = await investigateCase(loaded, {
    systems: ["baseline", "agent"],
    trajectoriesDir: TRAJECTORIES_DIR,
  });

  const timeline = toTimelineEvents(loaded.timeline);

  const parts: string[] = [];

  if (baseline) {
    parts.push(
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
        timeline,
      }),
    );
  }

  if (agent) {
    parts.push(
      renderHtmlReport({
        caseId: loaded.caseId,
        investigation: agent.investigation,
        verification: agent.verification,
        evidence: loaded.evidence,
        timeline,
        wasRetried: agent.wasRetried,
      }),
    );
  }

  if (parts.length === 0) {
    throw new Error(`No systems produced output for ${caseId}`);
  }

  return parts.join(
    '<hr style="margin:2em 0;border:none;border-top:2px solid #ddd">',
  );
}

app.get("/", (_req, res) => {
  res.type("html").send(indexHtml(listCases()));
});

app.get("/cases", (_req, res) => {
  res.json({
    cases: listCases().map((c) => c.caseId),
    systems: KNOWN_SYSTEMS,
  });
});

app.get("/cases/:caseId", async (req, res) => {
  const { caseId } = req.params;
  if (!existsSync(join(CASES_DIR, caseId))) {
    res.status(404).type("text").send(`Unknown case: ${caseId}`);
    return;
  }

  try {
    const html = await runInvestigation(caseId);
    res.type("html").send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).type("text").send(
      [
        "# Investigation failed",
        "",
        "```",
        msg,
        "```",
        "",
        hasAnyProviderKey()
          ? "Return to [cases](/)."
          : "No AI provider key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY and try again.",
      ].join("\n"),
    );
  }
});

app.listen(PORT, () => {
  console.log(`TraceOS server listening on http://localhost:${PORT}`);
  console.log(
    hasAnyProviderKey()
      ? `AI provider configured (router order via AI_PROVIDER).`
      : `Warning: no AI provider key set — /cases/:caseId will fail until configured.`,
  );
});
