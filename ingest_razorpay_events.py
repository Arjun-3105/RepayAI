"""
ingest_razorpay_events.py
==========================
Normalizes real Razorpay test-mode mandate events to the engine schema,
runs them through the full pipeline (rule engine → action simulator →
template explanation → audit log append), then recomputes summary.json.

Usage:
    python3 ingest_razorpay_events.py

Inputs:  data/razorpay_mandate_events.json   (created by razorpay_mandate_orders.py)
Outputs: audit_log.jsonl  (Razorpay events appended with _source=razorpay_live)
         summary.json     (recomputed to include Razorpay events)
"""
import json, os, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE    = Path(__file__).parent
ENGINE  = BASE / "engine"
DATA    = BASE / "data"
sys.path.insert(0, str(ENGINE))

IST = timezone(timedelta(hours=5, minutes=30))


# ── 1. Load Razorpay events ────────────────────────────────────────────────
rzp_path = DATA / "razorpay_mandate_events.json"
rzp_events_raw = json.loads(rzp_path.read_text())
print(f"Loaded {len(rzp_events_raw)} Razorpay mandate events from {rzp_path.name}")


# ── 2. Normalize to engine schema ──────────────────────────────────────────
def normalize(e: dict) -> dict:
    """Reshape flat Razorpay event to the nested schema classify_batch expects."""
    out = dict(e)
    # Build the nested customer_payment_history block
    out["customer_payment_history"] = {
        "total_cycles_billed":             e.get("total_cycles_billed", 6),
        "total_cycles_succeeded":          e.get("total_cycles_succeeded", 4),
        "total_cycles_failed":             e.get("consecutive_failures", 1),
        "consecutive_failures":            e.get("consecutive_failures", 1),
        "last_success_at":                 None,
        "historical_success_days_of_month": e.get("historical_success_days_of_month", [1,2,3,4,5]),
        "prior_retry_attempts_this_cycle": 0,
        "days_since_last_retry":           None,
    }
    # Add missing mandate lifecycle fields (defaults for test-mode orders)
    from datetime import datetime, timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(IST)
    out.setdefault("mandate_created_at", (now - timedelta(days=180)).isoformat())
    out.setdefault("mandate_expiry_at",  (now + timedelta(days=185)).isoformat())
    return out


normalized = [normalize(e) for e in rzp_events_raw]
print(f"Normalized {len(normalized)} events to engine schema")


# ── 3. Classify ────────────────────────────────────────────────────────────
from rule_engine import classify_batch
classifications = classify_batch(normalized)
for e, clf in zip(rzp_events_raw, classifications):
    print(f"  {e['event_id']:45s}  → {clf['branch']:12s}")


# ── 4. Simulate actions ────────────────────────────────────────────────────
from action_simulator import simulate_batch
actions = simulate_batch(normalized, classifications)


# ── 5. Generate explanations (OpenRouter LLM mode) ───────────────────────
from dotenv import load_dotenv
load_dotenv()
from llm_explainer import generate_explanation

explanations = []
print("  Generating live OpenRouter LLM explanations for Razorpay events...")
for e, clf in zip(normalized, classifications):
    res = generate_explanation(e, clf["branch"], clf.get("rationale", ""), use_llm=True)
    order_id = e.get("razorpay", {}).get("order_id", "")
    prefix = f"[Razorpay test-mode · {order_id}] "
    explanations.append({
        "event_id": e["event_id"],
        "explanation": prefix + res["explanation"],
        "explanation_source": f"razorpay_live_{res['explanation_source']}",
    })
    print(f"   ✓ {e['event_id']} → {res['explanation_source']}")
    import time
    time.sleep(3.2)  # Respect OpenRouter 20 req/min free limit


# ── 6. Build audit records ─────────────────────────────────────────────────
from audit_log_writer import build_audit_record

records = []
for event, clf, action, expl in zip(normalized, classifications, actions, explanations):
    record = build_audit_record(event, clf, action, expl)
    # Stamp source clearly
    record["_source"]    = "razorpay_live"
    record["razorpay"]   = event.get("razorpay", {})
    record["_badge"]     = "🔴 LIVE Razorpay Test-Mode"
    records.append(record)


# ── 7. Append to audit log ─────────────────────────────────────────────────
audit_path = BASE / "audit_log.jsonl"

# Remove any existing rzp_ entries to avoid duplication on re-runs
existing_lines = []
if audit_path.exists():
    for line in audit_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if obj.get("event_id", "").startswith("rzp_"):
                continue   # will be replaced
            existing_lines.append(line)
        except json.JSONDecodeError:
            existing_lines.append(line)

# Write back existing + new Razorpay records
with open(audit_path, "w") as f:
    for line in existing_lines:
        f.write(line + "\n")
    for record in records:
        f.write(json.dumps(record, default=str) + "\n")

total_lines = len(existing_lines) + len(records)
print(f"\n✅ Audit log: {len(existing_lines)} synthetic + {len(records)} Razorpay = {total_lines} total events")
print(f"   Saved → {audit_path}")


# ── 8. Recompute summary.json ──────────────────────────────────────────────
from evaluator import compute_summary
summary = compute_summary(
    audit_log_path=str(audit_path),
    ground_truth_path=str(DATA / "ground_truth.json"),
    batch_path=str(DATA / "synthetic_batch.json"),
    output_path=str(BASE / "summary.json"),
)
print(f"\n✅ summary.json recomputed:")
print(f"   total_events : {summary.get('meta', {}).get('total_events', 'n/a')}")
print(f"   accuracy     : {summary.get('overall_accuracy', 'n/a')}")
print(f"\n✅ Done! Razorpay events are now live in the audit stream.")
print(f"   Refresh the dashboard at http://localhost:5173 to see them.")
