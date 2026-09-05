# Recoverability Engine

**Razorpay Buildathon · Track 03 — AI Revenue Recovery**

> Before retrying a failed UPI AutoPay mandate, decide whether it's actually recoverable — stop wasting retries on dead accounts, recover what's collectable, and show the ₹ proof.

---

## Privacy

All data in this project is synthetically generated end-to-end; no real personal data was used at any point. Identifier formats, masking conventions, and security-measure choices (tokenized IDs, masked VPA/phone display) follow the DPDP Rules, 2025 requirement that personal data be protected via encryption, obfuscation, masking, or virtual tokens.

---

## Quick Start

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Set environment variables (optional)

```bash
cp .env.example .env
# Edit .env and add your API keys:
#   OPENROUTER_API_KEY  — for Claude 3 Haiku LLM explanations
#   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — for Razorpay test-mode
#   GEMINI_API_KEY      — fallback LLM
```

### 3. Run the pipeline

```bash
# Full run with LLM explanations (requires OPENROUTER_API_KEY)
python pipeline.py

# Demo mode — template explanations, no API calls needed
python pipeline.py --skip-llm

# Regenerate synthetic data
python pipeline.py --skip-llm --regen-data
```

### 4. Start the dashboard

```bash
cd dashboard
npm install
npm run dev
# Open http://localhost:5173
```

---

## Architecture

```
generate_synthetic_batch.py  →  data/synthetic_batch.json + data/ground_truth.json
        ↓
rule_engine.py (deterministic 5-branch classifier)
        ↓
  ┌─────┴──────────────────────────────────┐
  ↓                                        ↓
llm_explainer.py                    action_simulator.py
(OpenRouter → Gemini → template)    (schedule/log/flag/no-op)
        ↓                                  ↓
audit_log_writer.py  ←────────────────────┘
        ↓
audit_log.jsonl
        ↓
evaluator.py  →  summary.json
        ↓
Dashboard (React + Vite + Recharts)
```

---

## 5-Branch Classification

| Branch | Failure codes / conditions | Action |
|---|---|---|
| **WAIT** | `U69`, `U28` (infrastructure down) | Auto-retry after 30min/4hr cooldown; max 3 attempts |
| **STOP** | `01`, `02`, `07` OR `Z9` × ≥3 consecutive | No retry; single low-pressure nudge; merchant flagged |
| **REAUTHORIZE** | `PAUSED/REVOKED/EXPIRED` mandate OR code `06` | Re-mandate link + Hinglish nudge (max 2, 3-day spacing) |
| **ESCALATE** | ≥3 distinct failure codes in 90d OR any chargeback | No action; exceptions queue for human review |
| **RECOVER** | Default: `Z9` with < 3 consecutive failures | KDE-optimized retry timing from `historical_success_days_of_month` |

**Key design choice:** Classification is 100% deterministic. The LLM only generates a plain-language explanation of a decision already made by rules — never the decision itself.

---

## Running Tests

```bash
python -m pytest engine/tests/ -v
# Expects 19 passed
```

---

## Pipeline Outputs

| File | Description |
|---|---|
| `data/synthetic_batch.json` | 300 failure events (classifier input, Section 3.1 schema) |
| `data/ground_truth.json` | event_id → true archetype (never read by classifier) |
| `audit_log.jsonl` | Append-only audit log (one line per event) |
| `summary.json` | All dashboard metrics: confusion matrix, precision/recall, ₹ breakdown |

---

## NPCI Failure Codes Used

All codes are real; none are invented:
`Z9` · `U69` · `U28` · `Z7` · `Z8` · `U30` · `01` · `02` · `04` · `06` · `07` · `MANDATE_EXPIRED` · `MANDATE_PAUSED`

---

## Tech Stack

- **Engine**: Python 3.12 · `numpy` · `pandas` · `scipy` · `faker`
- **LLM**: OpenRouter (`anthropic/claude-3-haiku`) → Google Gemini → template fallback
- **Razorpay**: Test-mode Subscriptions/Recurring Payments API
- **Dashboard**: React 18 · Vite · Recharts · Vanilla CSS
