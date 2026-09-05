"""
evaluator.py
============
Computes all dashboard metrics from the audit log + ground truth.

Outputs summary.json with:
  - Per-branch precision/recall/F1 vs. ground truth
  - Confusion matrix
  - Total ₹ by branch
  - Retries avoided count + estimated ₹ saved
  - RECOVER timing analysis (how many were outside historical success window)
  - Sample RECOVER event with full probability curve (for dashboard chart)
  - Overall stats

This is what makes the "94% precision" claim honest — it's real confusion-matrix
arithmetic against labels controlled at generation time, per plan Section 5.3.
"""

from __future__ import annotations
import json
import os
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

BRANCHES = ["WAIT", "STOP", "REAUTHORIZE", "ESCALATE", "RECOVER"]
RETRY_COST_PER_ATTEMPT_INR = 2.0  # assumption per plan Section 7 — state explicitly


def load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def confusion_matrix(
    predicted: List[str],
    actual: List[str],
    labels: List[str] = BRANCHES,
) -> Dict[str, Dict[str, int]]:
    """Returns nested dict: matrix[actual][predicted] = count."""
    matrix = {a: {p: 0 for p in labels} for a in labels}
    for a, p in zip(actual, predicted):
        if a in matrix and p in matrix[a]:
            matrix[a][p] += 1
    return matrix


def per_branch_metrics(
    matrix: Dict[str, Dict[str, int]],
    labels: List[str] = BRANCHES,
) -> Dict[str, Dict[str, float]]:
    """Compute precision, recall, F1 per branch."""
    metrics = {}
    for branch in labels:
        tp = matrix[branch][branch]
        fp = sum(matrix[other][branch] for other in labels if other != branch)
        fn = sum(matrix[branch][other] for other in labels if other != branch)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1        = (2 * precision * recall / (precision + recall)
                     if (precision + recall) > 0 else 0.0)

        metrics[branch] = {
            "tp": tp, "fp": fp, "fn": fn,
            "precision": round(precision, 4),
            "recall":    round(recall, 4),
            "f1":        round(f1, 4),
        }
    return metrics


def analyze_recover_timing(
    audit_records: List[Dict[str, Any]],
    batch_events: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    For RECOVER-branch events: check whether the original failure date
    was OUTSIDE the customer's historical success window.
    If yes → an immediate retry on the same day would very likely have failed again.
    These are counted as "recovered only because of timing intelligence."
    """
    event_map = {e["event_id"]: e for e in batch_events}
    recover_records = [r for r in audit_records if r.get("branch") == "RECOVER"]

    timing_improved = 0
    total_recover = len(recover_records)

    for record in recover_records:
        event = event_map.get(record["event_id"], {})
        hist = event.get("customer_payment_history", {})
        success_days = hist.get("historical_success_days_of_month", [])
        if not success_days:
            continue

        failure_ts = record.get("failure_timestamp", "")
        if failure_ts:
            try:
                fail_day = int(failure_ts[8:10])  # day from ISO string
                if fail_day not in success_days:
                    timing_improved += 1
            except (ValueError, IndexError):
                pass

    return {
        "total_recover_events": total_recover,
        "timing_improved_count": timing_improved,
        "timing_improved_pct": round(timing_improved / total_recover * 100, 1) if total_recover > 0 else 0,
    }


def pick_sample_recover_event(
    audit_records: List[Dict[str, Any]],
    batch_events: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Pick one RECOVER-branch event with a rich success_days history for the
    dashboard probability chart.
    """
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from day_of_month_model import get_retry_probability_curve

    event_map = {e["event_id"]: e for e in batch_events}
    recover_records = [r for r in audit_records if r.get("branch") == "RECOVER"]

    # Pick the one with the most historical success days
    best = None
    best_len = 0
    for record in recover_records:
        event = event_map.get(record["event_id"], {})
        hist = event.get("customer_payment_history", {})
        success_days = hist.get("historical_success_days_of_month", [])
        if len(success_days) > best_len:
            best_len = len(success_days)
            best = (record, event)

    if not best:
        return None

    record, event = best
    hist = event.get("customer_payment_history", {})
    success_days = hist.get("historical_success_days_of_month", [])
    n_succeeded = hist.get("total_cycles_succeeded", 0)

    prob_curve = get_retry_probability_curve(success_days, n_succeeded)

    return {
        "event_id": record.get("event_id"),
        "customer_id": record.get("customer_id"),
        "amount_inr": record.get("amount_inr"),
        "failure_code": record.get("failure_code"),
        "failure_timestamp": record.get("failure_timestamp"),
        "historical_success_days_of_month": success_days,
        "retry_dates": record.get("retry_dates", []),
        "probability_curve": prob_curve,
        "explanation": record.get("explanation"),
    }


def compute_summary(
    audit_log_path: str,
    ground_truth_path: str,
    batch_path: str,
    output_path: str,
) -> Dict[str, Any]:
    """
    Main function: compute all metrics and write summary.json.
    """
    audit_records = []
    with open(audit_log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    audit_records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    ground_truths = load_json(ground_truth_path)
    batch_events = load_json(batch_path)

    # Build lookup: event_id → ground_truth_branch
    gt_map = {gt["event_id"]: gt["ground_truth_branch"] for gt in ground_truths}

    # Build predicted vs. actual lists (only events in both)
    predicted = []
    actual = []
    for record in audit_records:
        eid = record.get("event_id")
        if eid in gt_map:
            predicted.append(record["branch"])
            actual.append(gt_map[eid])

    # Confusion matrix + per-branch metrics
    matrix = confusion_matrix(predicted, actual)
    branch_metrics = per_branch_metrics(matrix)

    # Overall accuracy
    correct = sum(p == a for p, a in zip(predicted, actual))
    accuracy = correct / len(predicted) if predicted else 0.0

    # ₹ by branch
    amount_by_branch = defaultdict(float)
    count_by_branch = defaultdict(int)
    for record in audit_records:
        b = record.get("branch", "UNKNOWN")
        amount_by_branch[b] += record.get("amount_inr", 0)
        count_by_branch[b] += 1

    # Retries avoided
    total_retries_avoided = sum(r.get("retries_avoided", 0) for r in audit_records)
    retries_avoided_by_branch = defaultdict(int)
    for r in audit_records:
        retries_avoided_by_branch[r.get("branch", "")] += r.get("retries_avoided", 0)

    # ₹ equivalent of avoided retries
    retries_avoided_inr = total_retries_avoided * RETRY_COST_PER_ATTEMPT_INR

    # RECOVER timing analysis
    recover_timing = analyze_recover_timing(audit_records, batch_events)

    # Sample RECOVER event for probability chart
    sample_recover = pick_sample_recover_event(audit_records, batch_events)

    # Branch distribution in ground truth
    gt_branch_counts = Counter(gt["ground_truth_branch"] for gt in ground_truths)

    summary = {
        "meta": {
            "total_events": len(audit_records),
            "total_customers": len(set(r.get("customer_id") for r in audit_records)),
            "total_amount_inr": round(sum(r.get("amount_inr", 0) for r in audit_records), 2),
            "retry_cost_assumption_inr_per_attempt": RETRY_COST_PER_ATTEMPT_INR,
        },
        "overall_accuracy": round(accuracy, 4),
        "confusion_matrix": matrix,
        "branch_metrics": branch_metrics,
        "amount_by_branch": {k: round(v, 2) for k, v in amount_by_branch.items()},
        "count_by_branch": dict(count_by_branch),
        "ground_truth_distribution": dict(gt_branch_counts),
        "retries_avoided": {
            "total": total_retries_avoided,
            "by_branch": dict(retries_avoided_by_branch),
            "estimated_inr_saved": round(retries_avoided_inr, 2),
            "cost_assumption": f"₹{RETRY_COST_PER_ATTEMPT_INR} per gateway retry attempt",
        },
        "recover_timing_analysis": recover_timing,
        "sample_recover_event": sample_recover,
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)

    print(f"✅ Summary metrics → {output_path}")
    print(f"\n📊 Overall accuracy: {accuracy:.1%}")
    print(f"💰 Total ₹ in batch: ₹{summary['meta']['total_amount_inr']:,.2f}")
    print(f"🚫 Retries avoided: {total_retries_avoided} (≈₹{retries_avoided_inr:,.2f} saved)")
    print(f"\n📈 Per-branch precision/recall:")
    for b, m in branch_metrics.items():
        print(f"   {b}: precision={m['precision']:.1%}  recall={m['recall']:.1%}  F1={m['f1']:.1%}")

    return summary


if __name__ == "__main__":
    base = os.path.dirname(os.path.dirname(__file__))
    compute_summary(
        audit_log_path=os.path.join(base, "audit_log.jsonl"),
        ground_truth_path=os.path.join(base, "data", "ground_truth.json"),
        batch_path=os.path.join(base, "data", "synthetic_batch.json"),
        output_path=os.path.join(base, "summary.json"),
    )
