"""
audit_log_writer.py
===================
Writes classified events to an append-only JSONL audit log.

Each line is a complete audit record:
  event_id, customer_id, mandate_id, amount_inr,
  failure_code, branch, action, scheduled_retry_at,
  explanation, explanation_source, rule_rationale,
  retries_avoided, customer_contact, merchant_flag,
  processed_at, ...

audit_log.jsonl is the single source of truth for the dashboard.
"""

from __future__ import annotations
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30")


def build_audit_record(
    event: Dict[str, Any],
    classification: Dict[str, Any],
    action: Dict[str, Any],
    explanation_result: Dict[str, str],
) -> Dict[str, Any]:
    """
    Assemble a single, complete audit log record from the pipeline stages.
    """
    hist = event.get("customer_payment_history", {})
    risk = event.get("customer_risk_signals", {})

    record = {
        # Identity
        "event_id":    event.get("event_id"),
        "customer_id": event.get("customer_id"),
        "mandate_id":  event.get("mandate_id"),
        "merchant_id": event.get("merchant_id"),

        # Payment context
        "amount_inr":          event.get("amount_inr"),
        "failure_code":        event.get("failure_code"),
        "failure_timestamp":   event.get("failure_timestamp"),
        "mandate_status":      event.get("mandate_status"),
        "mandate_category":    event.get("mandate_category", ""),
        "cycle_frequency":     event.get("cycle_frequency"),

        # Classification output
        "branch":              classification.get("branch"),
        "rule_rationale":      classification.get("rule_rationale"),
        "confidence_signals":  classification.get("confidence_signals", {}),

        # LLM explanation
        "explanation":         explanation_result.get("explanation"),
        "explanation_source":  explanation_result.get("explanation_source"),

        # Action taken
        "action_type":         action.get("action_type"),
        "retry_scheduled_at":  action.get("retry_scheduled_at"),
        "retry_dates":         action.get("retry_dates"),
        "customer_contact":    action.get("customer_contact", False),
        "merchant_flag":       action.get("merchant_flag", False),
        "retries_avoided":     action.get("retries_avoided", 0),
        "action_notes":        action.get("notes", ""),

        # Customer history summary (for dashboard display)
        "total_cycles_billed":    hist.get("total_cycles_billed", 0),
        "total_cycles_succeeded": hist.get("total_cycles_succeeded", 0),
        "consecutive_failures":   hist.get("consecutive_failures", 0),
        "historical_success_days_of_month": hist.get("historical_success_days_of_month", []),

        # Risk signals
        "distinct_failure_codes_last_90d": risk.get("distinct_failure_codes_last_90d", []),
        "chargeback_count_last_90d":       risk.get("chargeback_count_last_90d", 0),

        # Audit metadata
        "processed_at": _now_ist(),
        "schema_version": "1.0",
    }
    return record


def write_audit_log(
    records: List[Dict[str, Any]],
    output_path: str,
    append: bool = False,
) -> None:
    """
    Write audit records to a JSONL file.

    Args:
        records: List of audit record dicts.
        output_path: Absolute or relative path to the .jsonl file.
        append: If True, append to existing file. If False, overwrite.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    mode = "a" if append else "w"

    with open(output_path, mode, encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    print(f"✅ Audit log: {len(records)} records → {output_path} (mode={mode})")


def load_audit_log(path: str) -> List[Dict[str, Any]]:
    """Load all records from a JSONL audit log."""
    if not os.path.exists(path):
        return []
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return records
