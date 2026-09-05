"""
rule_engine.py
==============
Deterministic 5-branch classifier for failed UPI AutoPay mandates.

Branch priority order (first match wins — intentional, see plan Section 3.2):
  1. WAIT          — infrastructure/transient failure (bank/PSP side)
  2. STOP          — structurally unrecoverable (account closed, 3+ consecutive Z9)
  3. REAUTHORIZE   — mandate-level problem (paused/revoked/expired, code 06)
  4. ESCALATE      — risk-flagged, erratic multi-cause failure pattern
  5. RECOVER       — default; payable customer with timing problem

The LLM is NOT used here. Classification is fully rule-based so that every
decision is auditable, reproducible, and explainable to a judge.
"""

from __future__ import annotations
from typing import Any, Dict, Tuple


# ---------------------------------------------------------------------------
# Branch constants
# ---------------------------------------------------------------------------
BRANCH_WAIT        = "WAIT"
BRANCH_STOP        = "STOP"
BRANCH_REAUTHORIZE = "REAUTHORIZE"
BRANCH_ESCALATE    = "ESCALATE"
BRANCH_RECOVER     = "RECOVER"

# NPCI failure code sets (Section 2 + plan Section 3.2)
INFRASTRUCTURE_CODES = {"U69", "U28"}
DEAD_ACCOUNT_CODES   = {"01", "02", "07"}
MANDATE_PROBLEM_CODE = "06"
MANDATE_PROBLEM_STATUSES = {"PAUSED", "REVOKED", "EXPIRED"}
INSUFFICIENT_FUNDS_CODE = "Z9"

CONSECUTIVE_FAILURES_STOP_THRESHOLD = 3
DISTINCT_CODES_ESCALATE_THRESHOLD   = 3


# ---------------------------------------------------------------------------
# Branch evaluators (pure functions, easily unit-testable)
# ---------------------------------------------------------------------------

def _is_wait(event: Dict[str, Any]) -> Tuple[bool, str]:
    """Branch 1: infrastructure/transient failure."""
    fc = event.get("failure_code", "")
    if fc in INFRASTRUCTURE_CODES:
        if fc == "U69":
            retry_delay = "30 minutes"
        else:  # U28
            retry_delay = "4 hours"
        return True, f"Infrastructure failure ({fc}); schedule automatic retry in {retry_delay}."
    return False, ""


def _is_stop(event: Dict[str, Any]) -> Tuple[bool, str]:
    """Branch 2: structurally unrecoverable."""
    fc = event.get("failure_code", "")
    hist = event.get("customer_payment_history", {})
    consecutive = hist.get("consecutive_failures", 0)

    if fc in DEAD_ACCOUNT_CODES:
        return True, f"Dead account (code {fc}); no retry possible — flag for merchant review."

    if fc == INSUFFICIENT_FUNDS_CODE and consecutive >= CONSECUTIVE_FAILURES_STOP_THRESHOLD:
        return True, (
            f"Structural affordability problem: {consecutive} consecutive Z9 failures "
            f"on the same mandate. Continuing to retry wastes gateway attempts and may "
            f"trigger bank-side risk flags on the customer."
        )
    return False, ""


def _is_reauthorize(event: Dict[str, Any]) -> Tuple[bool, str]:
    """Branch 3: mandate-level problem, not payment-level."""
    fc = event.get("failure_code", "")
    status = event.get("mandate_status", "")

    if status in MANDATE_PROBLEM_STATUSES:
        return True, (
            f"Mandate status is {status}; no valid standing authorization exists. "
            f"Generate re-mandate link and send Hinglish nudge (max 2 attempts, 3-day spacing)."
        )
    if fc == MANDATE_PROBLEM_CODE:
        return True, (
            "Customer paused mandate via their UPI app (code 06). Payment may be payable "
            "once mandate is reactivated — send re-mandate link."
        )
    return False, ""


def _is_escalate(event: Dict[str, Any]) -> Tuple[bool, str]:
    """Branch 4: risk-flagged; do not auto-retry."""
    risk = event.get("customer_risk_signals", {})
    distinct_codes = risk.get("distinct_failure_codes_last_90d", [])
    chargebacks = risk.get("chargeback_count_last_90d", 0)

    reasons = []
    if len(distinct_codes) >= DISTINCT_CODES_ESCALATE_THRESHOLD:
        reasons.append(
            f"{len(distinct_codes)} distinct failure codes in 90 days "
            f"({', '.join(distinct_codes)}) — erratic, multi-cause pattern"
        )
    if chargebacks > 0:
        reasons.append(f"{chargebacks} chargeback(s) in 90 days")

    if reasons:
        return True, (
            "Risk-flagged: " + "; ".join(reasons) + ". "
            "No automated retry or customer contact — routed to merchant exceptions queue."
        )
    return False, ""


def _is_recover(event: Dict[str, Any]) -> Tuple[bool, str]:
    """Branch 5: default — payable customer, timing is the issue."""
    # Everything not caught by branches 1-4 lands here
    hist = event.get("customer_payment_history", {})
    succeeded = hist.get("total_cycles_succeeded", 0)
    total = hist.get("total_cycles_billed", 1)
    success_rate = succeeded / total if total > 0 else 0
    success_days = hist.get("historical_success_days_of_month", [])

    day_hint = (
        f"historical success window: days {success_days}"
        if success_days
        else "no prior history — using default salary-cycle days (5, 28)"
    )
    return True, (
        f"Customer has {succeeded}/{total} successful cycles (success rate {success_rate:.0%}). "
        f"Failure code Z9 — insufficient funds on this specific date. "
        f"Do NOT retry immediately; schedule retry aligned to {day_hint}."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classify a single failure event into one of 5 branches.

    Args:
        event: Dict matching the schema in plan Section 3.1.
               Must NOT contain 'ground_truth_branch'.

    Returns:
        Dict with keys:
          - branch: str (WAIT/STOP/REAUTHORIZE/ESCALATE/RECOVER)
          - rule_rationale: str (human-readable rule explanation, not LLM-generated)
          - confidence_signals: dict (key signals that drove the decision)
    """
    # Evaluate in strict priority order
    for branch_fn, branch_name in [
        (_is_wait,        BRANCH_WAIT),
        (_is_stop,        BRANCH_STOP),
        (_is_reauthorize, BRANCH_REAUTHORIZE),
        (_is_escalate,    BRANCH_ESCALATE),
        (_is_recover,     BRANCH_RECOVER),
    ]:
        matched, rationale = branch_fn(event)
        if matched:
            return {
                "branch": branch_name,
                "rule_rationale": rationale,
                "confidence_signals": _extract_confidence_signals(event, branch_name),
            }

    # Should never reach here (RECOVER is catch-all), but defensive fallback
    return {
        "branch": BRANCH_RECOVER,
        "rule_rationale": "Default: no other branch matched.",
        "confidence_signals": _extract_confidence_signals(event, BRANCH_RECOVER),
    }


def classify_batch(events: list) -> list:
    """
    Classify a list of failure events.

    Returns a list of classification results in the same order as events.
    """
    return [classify(e) for e in events]


def _extract_confidence_signals(event: Dict[str, Any], branch: str) -> Dict[str, Any]:
    """Extract the key signals that drove this decision, for logging/audit."""
    hist = event.get("customer_payment_history", {})
    risk = event.get("customer_risk_signals", {})
    return {
        "failure_code": event.get("failure_code"),
        "mandate_status": event.get("mandate_status"),
        "consecutive_failures": hist.get("consecutive_failures", 0),
        "total_cycles_succeeded": hist.get("total_cycles_succeeded", 0),
        "total_cycles_billed": hist.get("total_cycles_billed", 0),
        "distinct_failure_codes_last_90d": risk.get("distinct_failure_codes_last_90d", []),
        "chargeback_count_last_90d": risk.get("chargeback_count_last_90d", 0),
        "historical_success_days_of_month": hist.get("historical_success_days_of_month", []),
        "branch_selected": branch,
    }
