# TraceOS

**Evidence-driven agentic investigation infrastructure.**

TraceOS answers one question: *given all this conflicting evidence, what actually happened?* It reconstructs timelines, cross-checks evidence sources against each other, actively tries to disprove its own conclusion, and verifies the result before handing it to a human reviewer.

**First application:** payment and order dispute investigation.

---

## Table of contents

- [Full vision](#full-vision)
- [MVP scope](#mvp-scope-hackathon-build)
- [Out of scope for MVP](#explicitly-out-of-scope-for-mvp-v2-backlog)
- [Architecture](#architecture)
- [Ground truth schema](#ground-truth-schema)
- [Investigation output & the HTML report](#investigation-output--the-html-report)
- [Running the MVP](#running-the-mvp)
- [Case set plan](#case-set-plan-1012-total)
- [Build plan](#build-plan-24h)
- [V2 backlog](#v2-backlog)

---

## Full vision

Where this goes beyond the hackathon:

- **Multi-source evidence ingestion** — CSV and text today; PDFs, images, and screenshots later
- **Evidence graph** — entity relationships between evidence items, not just a flat list
- **Multi-agent pipeline** — extraction → timeline → investigation → adversarial challenge → verification → retry-on-reject
- **Persistent case storage** — Postgres, case history, full audit trail
- **Analyst dashboard** — Next.js UI with an approve / reject / escalate review queue
- **Multiple domain packs** on one shared investigation engine:
  - Payments/order disputes (v1, this build)
  - KYC / onboarding consistency audits (v2)
  - Chargebacks, refund fraud, internal ops discrepancies (later)

None of the Postgres/Next.js/dashboard layer is a build target right now — it's context so the MVP doesn't get architected into a corner it can't grow out of.

---

## MVP scope (hackathon build)

**Definition of done:** a CLI tool that takes a case folder, runs baseline vs. agent pipeline on it, outputs a structured verdict plus a human-readable report, logs full trajectories, and scores itself against ground truth across 10–12 cases with real numbers in a comparison table.

| Component | MVP version |
|---|---|
| Evidence handling | Deterministic CSV parse + one lightweight LLM call to normalize *unstructured* sources (chat, receipt text) into the same schema. No separate "Evidence Agent" over structured data — that's just parsing. |
| Timeline | Deterministic sort by timestamp in code. No Timeline Agent. |
| Investigator | LLM agent, structured output (`InvestigationSchema`) |
| Contradiction / adversarial review | LLM agent, structured output, explicitly instructed to try to disprove the investigator's conclusion |
| Verifier | LLM agent, can reject and return `approved: false`, which triggers exactly **one** retry of the investigator with the verifier's feedback appended. Capped at 1 retry — an open-ended loop is a time sink, not a reward. |
| Report renderer | Boxed, human-readable ASCII report (demo output below) **plus a self-contained HTML dossier** per case (`report/<case-id>.html`) via `src/report/render-html.ts` — verified/rejected stamp, confidence meters, findings, contradictions, evidence trail, timeline, unresolved questions, and a "Verifier objections" panel on rejection. |
| Baseline | Single prompt, all raw evidence dumped in, forced into the *same* output schema as the agent, so scoring is apples-to-apples |
| Eval harness | Runs both systems on all cases, scores against structured ground truth (not free-text grading), outputs a results table |
| Trajectory logging | One JSON file per case per system: agent name → input → output → retry (if any) |
| Cases | 10–12 synthetic cases with structured ground truth, including at least one explicitly hard/ambiguous case |

### Example MVP output

```
┌──────────────────────────────────────────┐
│ TRACEOS INVESTIGATION                    │
├──────────────────────────────────────────┤
│ CONCLUSION                               │
│ Customer A's payment is NOT verified.    │
│                                           │
│ CONFIDENCE                               │
│ 96%                                      │
│                                           │
│ KEY FINDING                              │
│ The successful ₦250,000 transaction      │
│ belongs to Customer B.                   │
│                                           │
│ CONTRADICTIONS                           │
│ ⚠ Receipt says TXN-773 was successful    │
│ ⚠ Provider says TXN-773 failed           │
│                                           │
│ EVIDENCE                                 │
│ ✓ payment_provider.csv                   │
│ ✓ orders.csv                             │
│ ✓ customer_chat.txt                      │
│ ✓ receipt.txt                            │
└──────────────────────────────────────────┘
```

### Human checkpoint

TraceOS's output is a **recommendation to a fraud/support analyst**, never an automated denial or account action. This satisfies the hackathon's ground rule that any solution which could significantly affect someone must keep a qualified human reviewer in the loop.

---

## Explicitly out of scope for MVP (v2 backlog)

- Evidence graph visualization
- Postgres / persistence beyond flat files
- Next.js dashboard or any UI beyond CLI + rendered text report
- KYC/onboarding domain pack
- More than one verifier-triggered retry
- PDF / image evidence ingestion
- Multi-case batch review UI

State this explicitly in the final submission under a "what we deliberately cut and why" section — it's direct evidence of the judgment the rubric asks for: *"purposeful choices matter more than the number of components."*

---

## Architecture

```
traceos/
├── src/
│   ├── agents/
│   │   ├── investigator.agent.ts     # LLM, Investigation output
│   │   ├── contradiction.agent.ts    # LLM, adversarial, tries to disprove
│   │   └── verifier.agent.ts         # LLM, approve/reject + one-retry feedback
│   │
│   ├── schemas/
│   │   ├── investigation.ts          # EvidenceItem, Investigation, Verification, TimelineEvent, ...
│   │   └── trajectory.ts             # per-case/per-system run log
│   │
│   ├── lib/
│   │   ├── gemini.ts                 # shared client + Zod→Gemini structured output
│   │   └── prompt.ts                 # evidence serialization + timeline shaping
│   │
│   ├── evidence/
│   │   ├── extract-structured.ts     # deterministic CSV → EvidenceItem[]
│   │   ├── extract-unstructured.ts   # one LLM call: chat/receipt text → EvidenceItem[]
│   │   └── build-timeline.ts         # deterministic sort, no LLM
│   │
│   ├── workflow/
│   │   └── investigate.ts            # baseline/agent orchestration, pipeline + retry, trajectories
│   │
│   ├── report/
│   │   ├── render-html.ts            # self-contained HTML dossier (verified/rejected)
│   │   ├── render-ascii.ts           # boxed ASCII dossier (terminal)
│   │   └── bootstrap-demo.ts         # demo-only report generator (no API key needed)
│   │
│   ├── data/
│   │   └── load-case.ts
│   │
│   ├── trace.ts                      # trajectory persistence
│   ├── baseline.ts                   # single-prompt, same schema as agent
│   ├── evaluate.ts                   # run + score both systems, results table
│   └── index.ts                      # CLI entry (single case)
│
├── cases/                          # 12 synthetic cases
│   ├── case-01-demo/
│   │   ├── ground_truth.json       # structured, auto-scorable
│   │   ├── orders.csv
│   │   ├── payment_provider.csv
│   │   ├── bank_settlement.csv
│   │   ├── customer_chat.txt
│   │   └── receipt.txt
│   └── case-02.../ ... case-12.../
│
├── evidence/trajectories/          # generated (case.<system>.json)
├── report/                         # generated HTML dossiers per case/system
├── results.json                    # generated eval results
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── REPRODUCTION.md
```

**Stack:** Node.js, TypeScript, GEMINI, Zod, `csv-parse`, `dotenv`.

---

## Ground truth schema

Structured, not free text, so scoring can run unattended across baseline and agent alike.

```json
{
  "case_id": "case-01-demo",
  "correct_verified_customer": "CUST-B",
  "disputed_customer": "CUST-A",
  "disputed_customer_claim_is_valid": false,
  "key_contradiction": {
    "claimed_ref": "TXN-773",
    "actual_status": "failed",
    "real_successful_txn": "TXN-774",
    "real_successful_customer": "CUST-B"
  },
  "difficulty": "normal"
}
```

`evaluate.ts` scores by checking whether the system's structured output names the right customer, correctly flags the claim as valid/invalid, and surfaces the right contradicting transaction reference — no manual grading, no LLM-judging-LLM step.

---

## Investigation output & the HTML report

The agent pipeline returns an `Investigation` that carries **both** the fields needed for unattended scoring and the fields the report renders:

```jsonc
{
  "caseId": "case-01-demo",
  "disputedCustomer": "CUST-A",        // scoring  → ground_truth.disputed_customer
  "claimIsValid": false,               // scoring  → ground_truth.disputed_customer_claim_is_valid
  "verifiedCustomer": "CUST-B",        // scoring  → ground_truth.correct_verified_customer
  "confidence": 0.96,                  // 0..1 fraction (report shows 96%)
  "keyFinding": "The successful ₦250,000 transaction belongs to Customer B.",
  // report-only fields:
  "conclusion": "Customer A's payment claim is NOT verified.",
  "findings": ["TXN-773 was recorded as FAILED by the provider at 10:32 UTC.", "…"],
  "contradictions": ["Receipt (EVD-06) states TXN-773 succeeded; provider says it failed."],
  "supportingEvidenceIds": ["EVD-03", "EVD-04", "EVD-06"],
  "unresolvedQuestions": ["Whether the receipt was fabricated is unestablished."]
}
```

`src/report/render-html.ts` turns this into a **static, self-contained HTML dossier** (no server, no heavy JS — just a native `<details>` toggle) written to `report/<case-id>.html`. It takes the real `Investigation`, `Verification`, `EvidenceItem[]`, and `TimelineEvent[]` typed against `src/schemas/investigation.ts`, so the whole call is:

```ts
fs.writeFileSync(`report/${caseId}.html`, renderHtmlReport({ caseId, investigation, verification, evidence, timeline }));
```

The report's verdict stamp is driven by the verifier, which makes the reject path visually obvious:

- `verification.approved === true` → **VERIFIED** (green stamp), investigator's conclusion shown.
- `verification.approved === false` → **REJECTED** (red stamp), a `re-investigated after rejection` note when a retry occurred, `verification.correctedConclusion` shown in place of the investigator's conclusion, and a **"Verifier objections"** panel listing `unsupportedClaims`, `missingEvidence`, and `contradictionErrors`.

Generate the demo dossiers (one verified, one rejected) with:

```
npm run report:demo
```

The rejected variant is a strong visual beat for the demo video / changelog walkthrough ("biggest improvement" — the stamp flips and the corrected conclusion appears).

---

## Running the MVP

Requires a `GEMINI_API_KEY` in `.env` (see `.env.example`). The model is set via `GEMINI_MODEL` (default `gemini-2.5-flash`).

```
npm run dev                    # run baseline + agent on one case (default case-01-demo)
npm run dev -- cases/case-05-contradiction
npm run eval                   # run + score both systems on all cases → results.json + comparison table
npm run eval -- --force        # bypass the trajectory cache, re-run Gemini on every case
npm run report:demo            # generate demo dossiers (verified + rejected) with NO API key
npm run typecheck
```

For one case, `npm run dev` writes `report/<caseId>.baseline.html` and `report/<caseId>.agent.html`, prints the boxed ASCII dossiers, and logs trajectories to `evidence/trajectories/<caseId>.<system>.json`.

`npm run eval`:
- loads all 12 cases,
- runs baseline + agent pipeline on each (writing HTML per case/system),
- scores each structured output against `ground_truth.json` — names the right customer, flags claim validity correctly, surfaces the right contradiction,
- prints the comparison table and writes `results.json`.

The pipeline order is: **investigator → contradiction (adversarial) → verifier**, with exactly **one** verifier-triggered retry of the investigator before the verdict is handed to the human reviewer.

### Free-tier quota handling

Every Gemini call goes through two guards in `src/lib/`:

- **Rate limiter** (`rate-limit.ts`) — spaces calls to stay under your project's free-tier RPM cap. Default `13000ms` is safe for a 5 RPM cap; tune with `GEMINI_RATE_INTERVAL_MS` in `.env`.
- **429 retry** (`gemini-retry.ts`) — retries quota-exceeded responses with capped exponential backoff (or the API's `Retry-After` header when exposed).

**Eval caching.** The per-case trajectory files double as an eval cache: a case already present under `evidence/trajectories/` is reloaded instead of re-running Gemini, so the first benchmark consumes API quota but subsequent scoring runs do not. This is a deliberate engineering choice for reproducibility, not a workaround:

> The eval runner caches completed agent trajectories. The initial benchmark requires model calls; subsequent scoring runs operate entirely on cached results and do not consume API quota.

To force a full re-run, pass `--force` (`npm run eval -- --force`) or set `EVAL_USE_CACHE=false` in `.env`.

---

## Case set plan (10–12 total)

- **4–5 straightforward cases** — one clean contradiction each, different transaction/customer combinations
- **3–4 clean cases** — the customer's claim actually checks out, no contradiction. These measure false-positive rate.
- **2–3 harder cases** — multiple transactions, partial refunds, near-duplicate amounts across three customers, timestamp ordering that looks suspicious but isn't
- **1 genuinely ambiguous case**, even to a human, with a note in the case file explaining why. This is the rubric-required "challenging case," and doubles as the best source material for the "main failure mode" section of the submission.

Write these before extending agent logic further — the eval set is what turns this from a demo into a scored submission, and it's the piece most likely to get squeezed if left for later.

---

## Build plan (24h)

| Hours | Work |
|---|---|
| 0–2 | Schemas (incl. report-facing Investigation fields, `TimelineEvent`), deterministic evidence/timeline code, `load-case.ts` |
| 2–4 | Write 10–12 cases + structured `ground_truth.json` for each (reuse the demo case as case-01) |
| 4–5 | Baseline — single prompt, same output schema as the agent |
| 5–10 | Investigator + Contradiction + Verifier, single retry-on-reject wired up |
| 10–12 | Report renderer — boxed ASCII + HTML dossier (`render-html.ts`), verified/rejected stamps |
| 12–13 | Trajectory logging wired into the workflow |
| 13–16 | `evaluate.ts` — run baseline + agent across all cases, get real numbers |
| 16–17 | Fix whatever the numbers reveal is broken — budget this, something will be |
| 17–20 | README: problem/user, changelog, evaluation table, failure mode, hot take, "what we cut and why" |
| 20–22 | Record 5-min video: problem → baseline → real execution → comparison → changelog → biggest win → removed experiment (incl. the REJECTED stamp flip) |
| 22–24 | REPRODUCTION.md, clean-clone sanity test, buffer |

---

## V2 backlog

- KYC / onboarding consistency auditor as a second domain pack on the same core investigation engine
- Evidence graph (visual, not just structured data)
- Postgres persistence + case history
- Next.js analyst dashboard with an approve/reject queue
- Multi-retry verifier loop with escalation logic
- PDF / screenshot evidence ingestion
