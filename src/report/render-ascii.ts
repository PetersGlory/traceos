import type { Investigation, Verification } from "../schemas/investigation.js";

/**
 * Boxed ASCII report renderer.
 *
 * Produces the terminal-friendly dossier shown in the README demo output.
 * One call, pure string — printed to stdout from index.ts/evaluate.ts.
 */

function box(title: string, lines: string[]): string {
  const width = Math.max(
    title.length,
    ...lines.map((l) => l.length),
    2,
  );
  const total = width + 4;
  const bar = "─".repeat(total);
  const pad = (s: string) => `│ ${s.padEnd(width)} │`;

  const out: string[] = [];
  out.push(`┌${bar}┐`);
  out.push(pad(title));
  out.push(`├${bar}┤`);
  for (const line of lines) {
    if (line === "") continue;
    out.push(pad(line));
  }
  out.push(`└${bar}┘`);
  return out.join("\n");
}

export function renderAsciiReport(
  investigation: Investigation,
  verification: Verification,
): string {
  const stampText = verification.approved ? "VERIFIED" : "REJECTED";

  const contradictions =
    investigation.contradictions.length > 0
      ? investigation.contradictions.map((c) => `⚠ ${c}`)
      : ["✓ No contradictions surfaced"];

  const findingLines = investigation.findings.length
    ? investigation.findings
    : [investigation.keyFinding];

  return [
    box("TRACEOS INVESTIGATION", [
      "",
      "CONCLUSION",
      investigation.conclusion,
      "",
      "VERDICT",
      `${stampText} (investigator ${Math.round(investigation.confidence * 100)}%)`,
      "",
      "KEY FINDING",
      investigation.keyFinding,
    ]),
    "",
    box("FINDINGS", findingLines),
    "",
    box("CONTRADICTIONS", contradictions),
    "",
    box("SUPPORTING EVIDENCE", investigation.supportingEvidenceIds),
    ...(investigation.unresolvedQuestions.length
      ? [
          "",
          box("UNRESOLVED QUESTIONS", investigation.unresolvedQuestions),
        ]
      : []),
  ].join("\n");
}
