/**
 * Renders a single investigation into a static, self-contained HTML report.
 *
 * No server, no client-JS dependencies beyond a native <details> toggle. The
 * output is meant to be written to disk per case (`report/<case-id>.html`) and
 * opened directly in a browser, or screen-recorded for the demo video.
 *
 * Design intent: a case file / evidence dossier, not a dashboard. Once
 * investigate.ts returns real data, generating a report is one call:
 *   fs.writeFileSync(`report/${caseId}.html`, renderHtmlReport({ ... }));
 *
 * Rejected/retry handling: when `verification.approved` is false the stamp flips
 * to REJECTED (red), `verification.correctedConclusion` replaces the displayed
 * conclusion, and a "Verifier objections" panel lists unsupported claims,
 * missing evidence, and contradiction errors.
 */
import type {
  Investigation,
  Verification,
  EvidenceItem,
  TimelineEvent,
} from "../schemas/investigation.js";

export interface RenderReportInput {
  caseId: string;
  investigation: Investigation;
  verification: Verification;
  evidence: EvidenceItem[];
  timeline: TimelineEvent[];
  wasRetried?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function evidenceById(
  evidence: EvidenceItem[],
  id: string,
): EvidenceItem | undefined {
  return evidence.find((e) => e.id === id);
}

export function renderHtmlReport(input: RenderReportInput): string {
  const {
    caseId,
    investigation,
    verification,
    evidence,
    timeline,
    wasRetried,
  } = input;

  const stampText = verification.approved ? "VERIFIED" : "REJECTED";
  const stampClass = verification.approved
    ? "stamp-verified"
    : "stamp-rejected";

  const confidencePct = Math.round(investigation.confidence * 100);
  const verifierConfidencePct = Math.round(verification.confidence * 100);

  const displayedConclusion = verification.approved
    ? investigation.conclusion
    : verification.correctedConclusion || investigation.conclusion;

  const findingsHtml = investigation.findings
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join("\n");

  const contradictionsHtml = investigation.contradictions.length
    ? investigation.contradictions
        .map((c) => `<li class="tag tag-alert">${escapeHtml(c)}</li>`)
        .join("\n")
    : `<li class="tag tag-quiet">No contradictions surfaced</li>`;

  const supportingEvidenceHtml = investigation.supportingEvidenceIds
    .map((id) => {
      const item = evidenceById(evidence, id);
      if (!item) return "";
      return `
        <div class="evidence-stub">
          <span class="evidence-id">${escapeHtml(item.id)}</span>
          <span class="evidence-type">${escapeHtml(item.type)}</span>
          <span class="evidence-statement">${escapeHtml(item.statement)}</span>
          <span class="evidence-source">source: ${escapeHtml(item.source)}</span>
        </div>`;
    })
    .join("\n");

  const timelineHtml = timeline
    .map(
      (t) => `
      <div class="timeline-row importance-${t.importance}">
        <span class="timeline-ts">${escapeHtml(t.timestamp)}</span>
        <span class="timeline-event">${escapeHtml(t.event)}</span>
        <span class="timeline-ref">${escapeHtml(t.evidenceId)}</span>
      </div>`,
    )
    .join("\n");

  const unresolvedHtml = investigation.unresolvedQuestions.length
    ? `<ul>${investigation.unresolvedQuestions
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join("")}</ul>`
    : `<p class="muted">None noted.</p>`;

  const verifierIssuesHtml = !verification.approved
    ? `
      <div class="verifier-panel">
        <h3>Verifier objections</h3>
        ${
          verification.unsupportedClaims.length
            ? `<p class="label">Unsupported claims</p><ul>${verification.unsupportedClaims
                .map((c) => `<li>${escapeHtml(c)}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          verification.missingEvidence.length
            ? `<p class="label">Missing evidence</p><ul>${verification.missingEvidence
                .map((c) => `<li>${escapeHtml(c)}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${
          verification.contradictionErrors.length
            ? `<p class="label">Contradiction errors</p><ul>${verification.contradictionErrors
                .map((c) => `<li>${escapeHtml(c)}</li>`)
                .join("")}</ul>`
            : ""
        }
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TraceOS — Case ${escapeHtml(caseId)}</title>
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
    position: relative;
    box-shadow: 0 1px 0 var(--line);
  }

  .header {
    padding: 28px 32px 20px;
    border-bottom: 2px solid var(--ink);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    position: relative;
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
  }

  .header .case-id {
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    color: var(--ink-soft);
    margin-top: 4px;
  }

  .stamp {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.08em;
    border: 2.5px solid;
    border-radius: 4px;
    padding: 6px 14px;
    transform: rotate(-6deg);
    white-space: nowrap;
  }

  .stamp-verified {
    color: var(--confirm);
    border-color: var(--confirm);
  }

  .stamp-rejected {
    color: var(--alert);
    border-color: var(--alert);
  }

  .retry-note {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--amber);
    margin-top: 6px;
    text-align: right;
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
    margin: 0 0 12px;
  }

  .conclusion {
    font-family: "Space Grotesk", sans-serif;
    font-size: 19px;
    font-weight: 500;
    line-height: 1.4;
    margin: 0 0 18px;
  }

  .meter-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .meter-label {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: var(--ink-soft);
    width: 130px;
    flex-shrink: 0;
  }

  .meter-track {
    flex: 1;
    height: 8px;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: var(--navy);
  }

  .meter-value {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    width: 40px;
    text-align: right;
  }

  ul { margin: 0; padding-left: 20px; }
  li { margin-bottom: 6px; }

  .tag {
    list-style: none;
    display: block;
    margin-left: -20px;
    padding: 8px 12px;
    border-radius: 3px;
    font-size: 13px;
    margin-bottom: 8px;
  }

  .tag-alert {
    background: var(--alert-bg);
    color: var(--alert);
    border-left: 3px solid var(--alert);
  }

  .tag-quiet {
    background: var(--confirm-bg);
    color: var(--confirm);
    border-left: 3px solid var(--confirm);
  }

  .evidence-stub {
    display: grid;
    grid-template-columns: 90px 90px 1fr;
    gap: 4px 12px;
    align-items: baseline;
    padding: 10px 0;
    border-bottom: 1px dashed var(--line);
    font-size: 13px;
  }

  .evidence-stub:last-child { border-bottom: none; }

  .evidence-id {
    font-family: "JetBrains Mono", monospace;
    font-weight: 500;
    color: var(--navy);
  }

  .evidence-type {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--amber);
  }

  .evidence-statement { grid-column: 3; }
  .evidence-source {
    grid-column: 3;
    font-size: 11px;
    color: var(--ink-soft);
  }

  .timeline-row {
    display: grid;
    grid-template-columns: 160px 1fr 90px;
    gap: 8px;
    padding: 8px 0;
    font-size: 13px;
    border-left: 2px solid var(--line);
    padding-left: 12px;
    margin-left: 4px;
  }

  .timeline-row.importance-high {
    border-left-color: var(--alert);
  }

  .timeline-ts {
    font-family: "JetBrains Mono", monospace;
    color: var(--ink-soft);
    font-size: 12px;
  }

  .timeline-ref {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--ink-soft);
    text-align: right;
  }

  .verifier-panel {
    background: var(--amber-bg);
    border: 1px solid var(--amber);
    border-radius: 4px;
    padding: 16px 18px;
    margin-top: 8px;
  }

  .verifier-panel h3 {
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    margin: 0 0 10px;
    color: var(--amber);
  }

  .verifier-panel .label {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--amber);
    margin: 10px 0 4px;
  }

  .muted { color: var(--ink-soft); font-size: 13px; }

  details summary {
    cursor: pointer;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: var(--ink-soft);
    padding: 6px 0;
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
        <p class="eyebrow">TraceOS Investigation Report</p>
        <h1>Payment Dispute Review</h1>
        <p class="case-id">CASE ${escapeHtml(caseId)}</p>
      </div>
      <div>
        <div class="stamp ${stampClass}">${stampText}</div>
        ${wasRetried ? `<p class="retry-note">re-investigated after rejection</p>` : ""}
      </div>
    </div>

    <div class="section">
      <h2>Conclusion</h2>
      <p class="conclusion">${escapeHtml(displayedConclusion)}</p>
      <div class="meter-row">
        <span class="meter-label">Investigator confidence</span>
        <div class="meter-track"><div class="meter-fill" style="width:${confidencePct}%"></div></div>
        <span class="meter-value">${confidencePct}%</span>
      </div>
      <div class="meter-row" style="margin-top:8px">
        <span class="meter-label">Verifier confidence</span>
        <div class="meter-track"><div class="meter-fill" style="width:${verifierConfidencePct}%"></div></div>
        <span class="meter-value">${verifierConfidencePct}%</span>
      </div>
    </div>

    <div class="section">
      <h2>Key findings</h2>
      <ul>${findingsHtml}</ul>
    </div>

    <div class="section">
      <h2>Contradictions</h2>
      <ul>${contradictionsHtml}</ul>
    </div>

    <div class="section">
      <h2>Evidence trail</h2>
      ${supportingEvidenceHtml || `<p class="muted">No supporting evidence cited.</p>`}
    </div>

    <div class="section">
      <h2>Timeline</h2>
      ${timelineHtml || `<p class="muted">No timeline events.</p>`}
    </div>

    <div class="section">
      <h2>Unresolved questions</h2>
      ${unresolvedHtml}
    </div>

    ${
      verifierIssuesHtml
        ? `<div class="section"><h2>Verification</h2>${verifierIssuesHtml}</div>`
        : ""
    }

    <div class="footer">
      Generated by TraceOS &middot; recommendation only &middot; requires human analyst sign-off before action is taken
    </div>
  </div>
</body>
</html>`;
}
