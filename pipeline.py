"""
pipeline.py
===========
Full Recoverability Engine pipeline orchestrator.

Runs in order:
  1. generate_synthetic_batch.py  → data/synthetic_batch.json + ground_truth.json
  2. rule_engine.py               → classify all events
  3. action_simulator.py          → simulate actions per branch
  4. llm_explainer.py             → generate audit explanations (skip with --skip-llm)
  5. audit_log_writer.py          → write audit_log.jsonl
  6. evaluator.py                 → compute metrics → summary.json

Usage:
  python pipeline.py                  # full run with LLM
  python pipeline.py --skip-llm       # no API calls (template explanations)
  python pipeline.py --regen-data     # regenerate synthetic data (default: reuse if exists)
  python pipeline.py --skip-llm --regen-data

Set environment variables in .env:
  OPENROUTER_API_KEY
  RAZORPAY_KEY_ID
  RAZORPAY_KEY_SECRET
  GEMINI_API_KEY (fallback)
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
ENGINE_DIR = BASE_DIR / "engine"
AUDIT_LOG_PATH = BASE_DIR / "audit_log.jsonl"
SUMMARY_PATH = BASE_DIR / "summary.json"
BATCH_PATH = DATA_DIR / "synthetic_batch.json"
GROUND_TRUTH_PATH = DATA_DIR / "ground_truth.json"

sys.path.insert(0, str(ENGINE_DIR))


def banner(text: str):
    print(f"\n{'='*60}")
    print(f"  {text}")
    print(f"{'='*60}")


def run_pipeline(skip_llm: bool = False, regen_data: bool = False):
    start_time = time.time()
    banner("🚀 Recoverability Engine — Starting Pipeline")

    # -----------------------------------------------------------------------
    # Step 1: Generate synthetic data
    # -----------------------------------------------------------------------
    banner("Step 1/6: Synthetic Data Generation")

    if BATCH_PATH.exists() and GROUND_TRUTH_PATH.exists() and not regen_data:
        print(f"✅ Using existing data: {BATCH_PATH}")
        with open(BATCH_PATH) as f:
            batch = json.load(f)
        with open(GROUND_TRUTH_PATH) as f:
            ground_truths = json.load(f)
    else:
        from generate_synthetic_batch import generate
        batch, ground_truths = generate()

    print(f"   Events: {len(batch)}, Ground truths: {len(ground_truths)}")

    # -----------------------------------------------------------------------
    # Step 2: Classify all events
    # -----------------------------------------------------------------------
    banner("Step 2/6: Rule Engine Classification")
    from rule_engine import classify_batch

    t0 = time.time()
    classifications = classify_batch(batch)
    t1 = time.time()

    branch_counts = {}
    for clf in classifications:
        b = clf["branch"]
        branch_counts[b] = branch_counts.get(b, 0) + 1

    print(f"✅ Classified {len(classifications)} events in {t1-t0:.2f}s")
    for b, c in sorted(branch_counts.items()):
        print(f"   {b}: {c} ({c/len(classifications)*100:.1f}%)")

    # -----------------------------------------------------------------------
    # Step 3: Simulate actions
    # -----------------------------------------------------------------------
    banner("Step 3/6: Action Simulation")
    from action_simulator import simulate_batch

    actions = simulate_batch(batch, classifications)
    total_avoided = sum(a.get("retries_avoided", 0) for a in actions)
    print(f"✅ Actions simulated. Retries avoided: {total_avoided}")

    # -----------------------------------------------------------------------
    # Step 4: LLM explanations
    # -----------------------------------------------------------------------
    banner(f"Step 4/6: LLM Explanations ({'template mode' if skip_llm else 'API mode'})")
    from llm_explainer import generate_explanations_batch

    explanations = generate_explanations_batch(
        batch,
        classifications,
        use_llm=(not skip_llm),
        rate_limit_delay=0.15,
    )
    sources = {}
    for e in explanations:
        s = e.get("explanation_source", "unknown")
        sources[s] = sources.get(s, 0) + 1
    print(f"✅ Explanations generated. Sources: {sources}")

    # -----------------------------------------------------------------------
    # Step 5: Write audit log
    # -----------------------------------------------------------------------
    banner("Step 5/6: Audit Log")
    from audit_log_writer import build_audit_record, write_audit_log

    records = []
    for event, clf, action, expl in zip(batch, classifications, actions, explanations):
        record = build_audit_record(event, clf, action, expl)
        records.append(record)

    write_audit_log(records, str(AUDIT_LOG_PATH), append=False)

    # -----------------------------------------------------------------------
    # Step 6: Evaluate + compute metrics
    # -----------------------------------------------------------------------
    banner("Step 6/6: Metrics & Evaluation")
    from evaluator import compute_summary

    summary = compute_summary(
        audit_log_path=str(AUDIT_LOG_PATH),
        ground_truth_path=str(GROUND_TRUTH_PATH),
        batch_path=str(BATCH_PATH),
        output_path=str(SUMMARY_PATH),
    )

    # -----------------------------------------------------------------------
    # Done
    # -----------------------------------------------------------------------
    elapsed = time.time() - start_time
    banner(f"✅ Pipeline Complete in {elapsed:.1f}s")
    print(f"\n📁 Outputs:")
    print(f"   {AUDIT_LOG_PATH}")
    print(f"   {SUMMARY_PATH}")
    print(f"\n🌐 Dashboard: cd dashboard && npm install && npm run dev")
    print(f"   (or open dashboard/index.html directly — reads summary.json + audit_log.jsonl)")

    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recoverability Engine Pipeline")
    parser.add_argument("--skip-llm", action="store_true",
                        help="Skip LLM API calls; use template explanations")
    parser.add_argument("--regen-data", action="store_true",
                        help="Regenerate synthetic data even if files exist")
    args = parser.parse_args()

    run_pipeline(skip_llm=args.skip_llm, regen_data=args.regen_data)
