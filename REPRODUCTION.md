# REPRODUCTION

How to reproduce the TraceOS MVP from a clean clone. Steps 1–5 require **no API key** and reproduce everything a reviewer can see without spending tokens (schemas, evidence parsing, case set, report renderers). Steps 6–8 are the live LLM pipeline and need a Gemini key.

## Prerequisites

- Node.js **>= 22** (the Gemini SDK requires 22+)
- npm (comes with Node)
- A Gemini API key (only for the live pipeline steps 6–8): https://aistudio.google.com/apikey

## 1. Install

```bash
npm install
```

## 2. Typecheck (no API key)

```bash
npm run typecheck
```

Should exit 0 with no errors.

## 3. Verify the case set + deterministic evidence layer (no API key)

The 12 synthetic cases each contain `ground_truth.json` plus `orders.csv`, `payment_provider.csv`, `bank_settlement.csv`, `customer_chat.txt`, `receipt.txt`. The deterministic CSV parse + timeline sort is pure code — no LLM.

## 4. Generate the demo HTML dossiers (no API key)

```bash
npm run report:demo
```

Writes:
- `report/case-01-demo.html` — **VERIFIED** stamp
- `report/case-01-demo.rejected.html` — **REJECTED** stamp + "Verifier objections" panel

Open either in a browser. The rejected variant shows the stamp-flip visual (corrected conclusion + unsupported claims / missing evidence / contradiction errors).

## 5. Sanity-check output

```
ls report/
```

Expect at least the two demo `.html` files above. (After step 7 you'll also see one `.html` per case per system.)

---

## Live LLM pipeline (needs a Gemini API key)

## 6. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`, set `GEMINI_API_KEY=your_key`. Optionally override the model:

```
GEMINI_MODEL=gemini-2.5-flash
```

## 7. Run one case

```bash
npm run dev                        # runs case-01-demo
# or a specific case:
npm run dev -- cases/case-05-contradiction
```

For each system it prints a boxed ASCII dossier and writes:
- `report/<caseId>.baseline.html`
- `report/<caseId>.agent.html`
- `evidence/trajectories/<caseId>.baseline.json`
- `evidence/trajectories/<caseId>.agent.json`

## 8. Run the full eval (all 12 cases, scored)

```bash
npm run eval
```

- runs baseline + agent pipeline on every case,
- scores each structured output against `ground_truth.json` (names the right customer, flags claim validity, surfaces the right contradiction — no free-text grading),
- prints a comparison table to stdout,
- writes:
  - `results.json` (structured, machine-readable)
  - one HTML report per case per system under `report/`
  - one trajectory JSON per case per system under `evidence/trajectories/`

---

## Expected artifacts tree (after step 8)

```
report/                          generated HTML dossiers
  <caseId>.baseline.html
  <caseId>.agent.html
evidence/trajectories/           generated run logs
  <caseId>.baseline.json
  <caseId>.agent.json
results.json                     generated eval scores
```

All three top-level artifact locations are git-ignored (`report/`, `evidence/trajectories/`, `results.json`), so a clean clone starts empty there.

## Troubleshooting

- **`GEMINI_API_KEY is not set`** — the key is missing from `.env`; copy `.env.example` and set it. This is the only thing gating `dev`/`eval`.
- **Model-name errors (400)** — bump `GEMINI_MODEL` in `.env` to a current, structured-output-capable model (e.g. `gemini-2.5-flash`).
- **Node version error** — ensure Node 22+ (`node -v`).
