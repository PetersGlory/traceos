# REPRODUCTION

How to reproduce the TraceOS MVP from a clean clone. Steps 1–5 require **no API key** and reproduce everything a reviewer can see without spending tokens (schemas, evidence parsing, case set, report renderers, the local web service). Steps 6–8 are the live LLM pipeline and need a Gemini key. The **CLI is the primary reproduction path**; the web service (step 9) is an optional convenience for demoing.

## Prerequisites

- Node.js **>= 22** (the Gemini SDK requires 22+)
- npm (comes with Node)
- A Gemini API key (only for the live pipeline steps 6–9): https://aistudio.google.com/apikey

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

## 5.5 Build + web service (no API key)

```bash
npm run build                 # compiles src/ → dist/
```

This should exit 0 and produce `dist/server.js`. You can boot the Express web service locally (no key needed just to serve the case index):

```bash
npm run dev:server            # or: npm run build && npm run start:server
```

Then open http://localhost:3000 to see the case index and `http://localhost:3000/cases` for a JSON list. The `/cases/:caseId` pages require a `GEMINI_API_KEY` (step 6) — see `ReadMe.md` → "Deployment" for full detail and the Render blueprint (`render.yaml`).

---

## Live LLM pipeline (needs a Gemini API key)

## 6. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`, set `GEMINI_API_KEY=your_key`. Optionally override the model and rate limiting:

```
GEMINI_MODEL=gemini-2.5-flash
GEMINI_RATE_INTERVAL_MS=13000      # spacing between LLM calls (free-tier RPM cap)
EVAL_USE_CACHE=true                # reuse saved eval results instead of re-calling Gemini
```

Every LLM call is spaced by the rate limiter and retried on 429 (quota-exceeded) with backoff — see `src/lib/rate-limit.ts` and `src/lib/gemini-retry.ts`.

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
npm run eval                    # first run calls Gemini for every case
npm run eval -- --force        # re-run fresh (ignore saved trajectories)
```

- runs baseline + agent pipeline on every case,
- scores each structured output against `ground_truth.json` (names the right customer, flags claim validity, surfaces the right contradiction — no free-text grading),
- prints a comparison table to stdout,
- writes:
  - `results.json` (structured, machine-readable)
  - one HTML report per case per system under `report/`
  - one trajectory JSON per case per system under `evidence/trajectories/`

**Caching:** the trajectory files double as an eval cache. Once a case's results exist under `evidence/trajectories/`, `npm run eval` reloads them instead of calling Gemini — so the **first** run on a clean clone consumes API quota, but **subsequent** runs are free and deterministic. Pass `--force` (or `EVAL_USE_CACHE=false`) to regenerate every case. This is a deliberate reproducibility choice, not a workaround.

---

## 9. (Optional) Deploy the web service

The CLI above is the **primary reproduction path**. If you also want a clickable demo, `render.yaml` is a Render blueprint (build `npm ci && npm run build`, start `node dist/server.js`). Connect the repo as a **Blueprint** and set the `GEMINI_API_KEY` secret in the Render dashboard (never commit it). Free-tier caveats (cold starts ~30–60s, ephemeral disk) are documented in `ReadMe.md` → "Deployment".

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
- **`429 Quota exceeded` / `generate_content_free_tier_requests`** — your project is at its free-tier RPM cap. The eval is sequential and rate-limited by default, but if you still see 429s raise `GEMINI_RATE_INTERVAL_MS` in `.env` (default `13000`); retries with backoff are automatic. Check Google's per-model rate-limit dashboard for your active limit.
