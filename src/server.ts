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
import {
  renderReportSheet,
  reportStyleHtml,
} from "./report/render-html.js";
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorHtml(title: string, detail: string, backToIndex: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TraceOS &mdash; ${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #E9E4D8;
    --paper-raised: #F2EEE3;
    --ink: #22201C;
    --ink-soft: #5B5648;
    --line: #C7BFA9;
    --alert: #8B3A3A;
    --alert-bg: #E9D2CE;
    --navy: #2A3448;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 24px 96px;
    background: var(--paper);
    color: var(--ink);
    font-family: "Public Sans", system-ui, sans-serif;
    line-height: 1.5;
  }
  .sheet {
    max-width: 780px;
    margin: 0 auto;
    background: var(--paper-raised);
    border: 1px solid var(--line);
    box-shadow: 0 1px 0 var(--line);
  }
  .header {
    padding: 28px 32px 20px;
    border-bottom: 2px solid var(--ink);
  }
  .header .eyebrow {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0 0 6px;
  }
  .header h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 22px;
    letter-spacing: -0.01em;
    margin: 0;
    color: var(--alert);
  }
  .section { padding: 24px 32px; }
  .error-panel {
    background: var(--alert-bg);
    border: 1px solid var(--alert);
    border-left: 3px solid var(--alert);
    border-radius: 4px;
    padding: 16px 18px;
  }
  .error-panel pre {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    color: var(--alert);
  }
  .back {
    display: inline-block;
    margin-top: 18px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--navy);
    text-decoration: none;
    border: 1.5px solid var(--navy);
    border-radius: 4px;
    padding: 8px 14px;
  }
  .back:hover { background: var(--navy); color: var(--paper-raised); }
  .footer {
    padding: 16px 32px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--ink-soft);
    text-align: center;
    letter-spacing: 0.04em;
    border-top: 1px solid var(--line);
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <p class="eyebrow">TraceOS Investigation</p>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="section">
      <div class="error-panel">
        <pre>${escapeHtml(detail)}</pre>
      </div>
      ${
        backToIndex
          ? '<a class="back" href="/">&larr; Back to cases</a>'
          : ""
      }
    </div>
    <div class="footer">TraceOS &middot; evidence-driven dispute investigation</div>
  </div>
</body>
</html>`;
}

function indexHtml(cases: CaseMeta[]): string {
  const cards = cases
    .map((c, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `
        <a class="case-card" href="/cases/${encodeURIComponent(c.caseId)}">
          <span class="case-num">${num}</span>
          <span class="case-body">
            <span class="case-name">${escapeHtml(c.caseId)}</span>
            ${
              c.difficult
                ? '<span class="case-badge badge-hard">hard / ambiguous</span>'
                : '<span class="case-badge">standard</span>'
            }
            <span class="case-cta">Open investigation &rarr;</span>
          </span>
        </a>`;
    })
    .join("\n");

  const providerBanner = hasAnyProviderKey()
    ? `<div class="status status-on"><span class="status-dot"></span>AI router ready &mdash; pipeline will run live</div>`
    : `<div class="status status-off"><span class="status-dot"></span>No AI provider key configured &mdash; case pages will error until a key is set</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TraceOS &mdash; Case Index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #E9E4D8;
    --paper-raised: #F2EEE3;
    --ink: #22201C;
    --ink-soft: #5B5648;
    --line: #C7BFA9;
    --amber: #93641C;
    --amber-bg: #E8D9B5;
    --alert: #8B3A3A;
    --alert-bg: #E9D2CE;
    --confirm: #3F6E52;
    --confirm-bg: #D9E4D6;
    --navy: #2A3448;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 48px 24px 96px;
    background: var(--paper);
    color: var(--ink);
    font-family: "Public Sans", system-ui, sans-serif;
    line-height: 1.5;
  }

  .sheet {
    max-width: 780px;
    margin: 0 auto;
    background: var(--paper-raised);
    border: 1px solid var(--line);
    box-shadow: 0 1px 0 var(--line);
  }

  .header {
    padding: 28px 32px 20px;
    border-bottom: 2px solid var(--ink);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
  }

  .header .eyebrow {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0 0 6px;
  }

  .header h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .header .lede {
    font-size: 14px;
    color: var(--ink-soft);
    margin: 8px 0 0;
    max-width: 520px;
  }

  .brand-mark {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.08em;
    border: 2.5px solid var(--navy);
    color: var(--navy);
    border-radius: 4px;
    padding: 6px 14px;
    transform: rotate(-4deg);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .section {
    padding: 24px 32px;
    border-bottom: 1px solid var(--line);
  }

  .section:last-child { border-bottom: none; }

  .section h2 {
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0 0 16px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    padding: 11px 14px;
    border-radius: 4px;
    margin-bottom: 4px;
  }

  .status-on {
    background: var(--confirm-bg);
    color: var(--confirm);
    border-left: 3px solid var(--confirm);
  }

  .status-off {
    background: var(--alert-bg);
    color: var(--alert);
    border-left: 3px solid var(--alert);
  }

  .status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  .case-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }

  .case-card {
    display: flex;
    gap: 14px;
    align-items: stretch;
    padding: 16px 16px 16px 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    text-decoration: none;
    color: inherit;
    transition: transform 0.08s ease, box-shadow 0.08s ease, border-color 0.08s ease;
  }

  .case-card:hover {
    transform: translateY(-2px);
    border-color: var(--navy);
    box-shadow: 0 4px 14px rgba(42, 52, 72, 0.12);
  }

  .case-num {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: var(--paper-raised);
    background: var(--navy);
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    align-self: flex-start;
    flex-shrink: 0;
  }

  .case-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .case-name {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 15px;
    word-break: break-word;
  }

  .case-badge {
    align-self: flex-start;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: var(--line);
    color: var(--ink-soft);
    border-radius: 3px;
    padding: 2px 7px;
  }

  .case-badge.badge-hard {
    background: var(--alert-bg);
    color: var(--alert);
  }

  .case-cta {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--navy);
    margin-top: 2px;
  }

  .footer {
    padding: 16px 32px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--ink-soft);
    text-align: center;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <p class="eyebrow">Evidence-Driven Dispute Investigation</p>
        <h1>TraceOS</h1>
        <p class="lede">Run the live agent pipeline (baseline + investigator&nbsp;&rarr;&nbsp;contradiction&nbsp;&rarr;&nbsp;verifier) on a case to produce and inspect its dossier report.</p>
      </div>
      <div class="brand-mark">TRACE&nbsp;OS</div>
    </div>

    <div class="section">
      ${providerBanner}
    </div>

    <div class="section">
      <h2>Cases</h2>
      <div class="case-grid">
${cards}
      </div>
    </div>

    <div class="footer">
      Pick a case to run the live pipeline &middot; results open below as a case dossier
    </div>
  </div>
</body>
</html>`;
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

  const sheetBlocks: string[] = [];

  if (baseline) {
    sheetBlocks.push(
      `<p class="sheet-title">Baseline &mdash; single-pass (no verifier)</p>` +
        renderReportSheet({
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
    sheetBlocks.push(
      `<p class="sheet-title">Agent &mdash; investigator &rarr; contradiction &rarr; verifier</p>` +
        renderReportSheet({
          caseId: loaded.caseId,
          investigation: agent.investigation,
          verification: agent.verification,
          evidence: loaded.evidence,
          timeline,
          wasRetried: agent.wasRetried,
        }),
    );
  }

  if (sheetBlocks.length === 0) {
    throw new Error(`No systems produced output for ${caseId}`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TraceOS — Case ${escapeHtml(caseId)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
${reportStyleHtml}
<style>
  .report-stack { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 44px; }
  .report-stack .sheet-title {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin: 0 0 8px;
    text-align: center;
  }
  .report-stack .sheet { max-width: none; }
  .case-nav {
    max-width: 820px;
    margin: 0 auto 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
  }
  .case-nav a {
    color: var(--navy);
    text-decoration: none;
    border: 1.5px solid var(--navy);
    border-radius: 4px;
    padding: 8px 12px;
  }
  .case-nav a:hover { background: var(--navy); color: var(--paper-raised); }
  .case-nav .nav-label { color: var(--ink-soft); text-transform: uppercase; }
</style>
</head>
<body>
  <div class="case-nav">
    <a href="/">&larr; All cases</a>
    <span class="nav-label">CASE ${escapeHtml(caseId)}</span>
  </div>
  <div class="report-stack">
    ${sheetBlocks.join("\n")}
  </div>
</body>
</html>`;
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
    res
      .status(404)
      .type("html")
      .send(errorHtml("Investigation not found", `Unknown case: ${caseId}`, true));
    return;
  }

  try {
    const html = await runInvestigation(caseId);
    res.type("html").send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = hasAnyProviderKey()
      ? msg
      : "No AI provider key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY and try again.";
    res.status(500).type("html").send(errorHtml("Investigation failed", detail, true));
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
