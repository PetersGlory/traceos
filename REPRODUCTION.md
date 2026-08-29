# REPRODUCTION

How to reproduce the TraceOS MVP from a clean clone. Steps 1–5 require **no API key** and reproduce everything a reviewer can see without spending tokens (schemas, evidence parsing, case set, report renderers, the local web service). Steps 6–8 are the live LLM pipeline and need at least one AI provider key (Groq and/or OpenRouter). The **CLI is the primary reproduction path**; the web service (step 9) is an optional convenience for demoing.

## Prerequisites

- Node.js **>= 22** (the OpenAI SDK requires 22+)
- npm (comes with Node)
- One or more AI provider API keys (only for the live pipeline steps 6–9). Recommended: **Groq** as primary + **OpenRouter** as fallback:
  - Groq: https://console.groq.com/keys
  - OpenRouter: https://openrouter.ai/keys

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

```bash
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

Then open http://localhost:3000 to see the case index and `http://localhost:3000/cases` for a JSON list. The `/cases/:caseId` pages require at least one AI provider key (step 6) — see `README.md` → "Deployment (web service)" for full detail and the Render blueprint (`render.yaml`).

---

## Live LLM pipeline (needs a Groq and/or OpenRouter API key)

## 6. Configure credentials

```bash
cp .env.example .env
```

Edit `.env` and set at least one provider key (`GROQ_API_KEY` and/or `OPENROUTER_API_KEY`):

```
AI_PROVIDER=groq,openrouter            # Groq primary, OpenRouter fallback
GROQ_MODEL=openai/gpt-oss-20b          # set a current Groq model (see console.groq.com/docs/models)
OPENROUTER_MODEL=openai/gpt-oss-20b    # OpenRouter free ":free" slugs were retired; use a current model
EVAL_USE_CACHE=true                    # reuse saved eval results instead of re-running the pipeline
```

Router & reliability notes (`src/lib/llm.ts`):
- Active providers are **Groq and OpenRouter only**. A Gemini transport exists in `src/lib/gemini.ts` but is not wired into `configuredProviders()` — setting `GEMINI_API_KEY` alone will not enable a working provider. See `README.md` → "Provider routing" for detail; this is v2 scaffolding, not a live path.
- With `AI_FALLBACK=true` (default), a failing provider (429 / network / bad output) falls back to the next one in the order.
- **Circuit breaker**: a provider that keeps failing (e.g. an exhausted free-tier quota) is tripped and skipped for a cooldown window instead of being retried over and over, so the router moves on fast.
- Errors are surfaced as clean, human-readable messages (not raw `{"error":{...}}` blobs).

Rate limiting is **per provider and fast** (`src/lib/rate-limit.ts`), so a fast provider isn't throttled to the slowest one's pace:
```
RATE_INTERVAL_MS_GROQ=2000             # per-provider spacing (ms)
RATE_INTERVAL_MS_OPENROUTER=1500
```
Retries on transient 429/5xx use capped backoff (`src/lib/gemini-retry.ts`, provider-agnostic despite the filename).

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
npm run eval                    # first run calls the LLM pipeline for every case
npm run eval -- --force        # re-run fresh (ignore saved trajectories)
```

- runs baseline + agent pipeline on every case,
- scores each structured output against `ground_truth.json` (names the right customer, flags claim validity, surfaces the right contradiction — no free-text grading),
- prints a comparison table to stdout,
- writes:
  - `results.json` (structured, machine-readable — includes `providerStats`: attempts/successes per provider, fallback events, and circuit-breaker trips)
  - one HTML report per case per system under `report/`
  - one trajectory JSON per case per system under `evidence/trajectories/`

**Caching:** the trajectory files double as an eval cache. Once a case's results exist under `evidence/trajectories/`, `npm run eval` reloads them instead of calling the LLM pipeline — so the **first** run on a clean clone consumes API quota, but **subsequent** runs are free and deterministic. Pass `--force` (or `EVAL_USE_CACHE=false`) to regenerate every case. This is a deliberate reproducibility choice, not a workaround.

---

## 9. (Optional) Deploy the web service

The CLI above is the **primary reproduction path**. If you also want a clickable demo, `render.yaml` is a Render blueprint (build `npm ci && npm run build`, start `node dist/server.js`). Connect the repo as a **Blueprint** and set `GROQ_API_KEY` and/or `OPENROUTER_API_KEY` (and `AI_PROVIDER=groq,openrouter`) as secrets in the Render dashboard (never commit them). Free-tier caveats (cold starts ~30–60s, ephemeral disk) are documented in `README.md` → "Deployment (web service)".

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

- **`No AI provider key configured`** — no `GROQ_API_KEY` / `OPENROUTER_API_KEY` is set in `.env`; copy `.env.example` and set at least one (and use `AI_PROVIDER=groq,openrouter`). This is the only thing gating `dev`/`eval`.
- **Model-name errors (400)** — the selected model ID is stale or unavailable. Override it in `.env` (`GROQ_MODEL` or `OPENROUTER_MODEL`) with a current, structured-output-capable model.
- **Node version error** — ensure Node 22+ (`node -v`).
- **`429 Quota exceeded` / free-tier rate limits** — you're at a provider's free-tier RPM cap. Rate limiting is per-provider (`RATE_INTERVAL_MS_GROQ`, `RATE_INTERVAL_MS_OPENROUTER`); raise a specific interval only if that provider 429s. Automatic backoff retries and the circuit breaker handle transient failures, and the router falls back to the next configured provider. Set both Groq and OpenRouter keys for resilience against any single provider's quota.
- **A `GEMINI_API_KEY` is set but nothing changes** — expected. Gemini is not wired into the active router (see step 6 above and `README.md` → "Provider routing"). Only `GROQ_API_KEY` / `OPENROUTER_API_KEY` affect provider selection today.