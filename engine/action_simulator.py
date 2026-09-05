"""
action_simulator.py
===================
Simulates bounded recovery actions for each branch decision.
Does NOT make classification decisions — that's the rule engine's job.

Actions:
  WAIT:         Schedule retry (U69→30min, U28→4hr), max 3 auto-retries.
  STOP:         No retry. Flag for merchant review. Optional single low-pressure nudge.
  REAUTHORIZE:  Generate re-mandate link. Log Hinglish nudge (max 2, 3-day spacing).
  ESCALATE:     No action. Log to merchant exceptions queue.
  RECOVER:      Compute next-success-date via day_of_month_model. Schedule retry (max 2).

All customer contact is simulated (logged, not sent) — WhatsApp/SMS integration
is explicitly out of scope per plan Section 4.
"""

from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# Allow importing from sibling modules
sys.path.insert(0, os.path.dirname(__file__))
from day_of_month_model import next_retry_date_from_today

IST = timezone(timedelta(hours=5, minutes=30))

BRANCH_WAIT        = "WAIT"
BRANCH_STOP        = "STOP"
BRANCH_REAUTHORIZE = "REAUTHORIZE"
BRANCH_ESCALATE    = "ESCALATE"
BRANCH_RECOVER     = "RECOVER"

# ---------------------------------------------------------------------------
# Hinglish nudge templates (Section 4)
# ---------------------------------------------------------------------------
REAUTHORIZE_TEMPLATE = (
    "Namaste {name}, aapka {merchant} mandate expire/pause ho gaya hai. "
    "Payment ₹{amount} ke liye naya mandate set karein — sirf ek tap: {link}. "
    "Koi extra charge nahi hai."
)

STOP_TEMPLATE = (
    "Namaste {name}, hume notice hua ki aapka recent payment successful nahi hua. "
    "Koi dikkat ho toh humein batayein — hum aapke liye plan adjust kar sakte hain: {link}. "
    "Koi pressure nahi, jab ready ho tab batayein."
)


def _fake_name(customer_id: str) -> str:
    """Generate a display name for nudge templates. Never stored in transaction records."""
    # Deterministic synthetic name based on customer_id hash
    names = [
        "Rahul", "Priya", "Amit", "Sunita", "Raj", "Kavya",
        "Vikram", "Anjali", "Rohit", "Sneha", "Arjun", "Meera",
    ]
    idx = hash(customer_id) % len(names)
    return names[idx]


def _make_mandate_link(customer_id: str, mandate_id: str) -> str:
    """Simulate a one-tap re-mandate link (test-mode URL)."""
    return f"https://pay.example.com/remandate/{mandate_id[:20]}?cid={customer_id}"


def _make_plan_link(customer_id: str) -> str:
    return f"https://pay.example.com/adjust-plan?cid={customer_id}"


def _retry_delay_for_code(failure_code: str) -> str:
    """WAIT branch: retry cooldown per code (plan Section 3.2 Branch 1)."""
    if failure_code == "U69":
        return "30 minutes"
    elif failure_code == "U28":
        return "4 hours"
    return "1 hour"


def _scheduled_retry_at(delay_str: str, reference_dt: Optional[datetime] = None) -> str:
    ref = reference_dt or datetime(2026, 9, 1, 8, 0, 0, tzinfo=IST)
    if "30 minutes" in delay_str:
        dt = ref + timedelta(minutes=30)
    elif "4 hours" in delay_str:
        dt = ref + timedelta(hours=4)
    else:
        dt = ref + timedelta(hours=1)
    return dt.strftime("%Y-%m-%dT%H:%M:%S+05:30")


# ---------------------------------------------------------------------------
# Branch-specific action builders
# ---------------------------------------------------------------------------

def action_wait(event: Dict[str, Any]) -> Dict[str, Any]:
    fc = event.get("failure_code", "U69")
    delay = _retry_delay_for_code(fc)
    retry_at = _scheduled_retry_at(delay)
    prior = event.get("customer_payment_history", {}).get("prior_retry_attempts_this_cycle", 0)
    max_retries_remaining = max(0, 3 - prior)

    return {
        "action_type": "SCHEDULE_RETRY",
        "branch": BRANCH_WAIT,
        "retry_scheduled_at": retry_at,
        "retry_delay": delay,
        "max_retries_remaining": max_retries_remaining,
        "customer_contact": False,
        "retries_avoided": 0,
        "notes": (
            f"Infrastructure failure ({fc}). Retry in {delay}. "
            f"{max_retries_remaining} auto-retries remaining (max 3 per WAIT cycle)."
        ),
    }


def action_stop(event: Dict[str, Any]) -> Dict[str, Any]:
    customer_id = event.get("customer_id", "")
    mandate_id  = event.get("mandate_id", "")
    amount      = event.get("amount_inr", 0)
    merchant_id = event.get("merchant_id", "merch_demo")

    name = _fake_name(customer_id)
    plan_link = _make_plan_link(customer_id)

    nudge_message = STOP_TEMPLATE.format(
        name=name,
        link=plan_link,
    )

    return {
        "action_type": "NO_RETRY_STOP",
        "branch": BRANCH_STOP,
        "retry_scheduled_at": None,
        "customer_contact": True,
        "contact_channel": "SMS/WhatsApp (simulated)",
        "contact_message": nudge_message,
        "contact_send_count_limit": 1,
        "merchant_flag": True,
        "merchant_flag_reason": "Structural payment failure — merchant dashboard review required",
        "retries_avoided": 1,
        "notes": "No retry scheduled. Merchant flagged. Single low-pressure message sent (never repeated).",
    }


def action_reauthorize(event: Dict[str, Any]) -> Dict[str, Any]:
    customer_id = event.get("customer_id", "")
    mandate_id  = event.get("mandate_id", "")
    amount      = event.get("amount_inr", 0)
    merchant_id = event.get("merchant_id", "merch_demo")

    name = _fake_name(customer_id)
    link = _make_mandate_link(customer_id, mandate_id)
    nudge_message = REAUTHORIZE_TEMPLATE.format(
        name=name,
        merchant=merchant_id,
        amount=f"{amount:,.2f}",
        link=link,
    )

    # Second nudge scheduled 3 days later
    ref = datetime(2026, 9, 1, 8, 0, 0, tzinfo=IST)
    nudge_2_at = (ref + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S+05:30")

    return {
        "action_type": "SEND_REAUTHORIZE_NUDGE",
        "branch": BRANCH_REAUTHORIZE,
        "retry_scheduled_at": None,  # No payment retry until mandate confirmed
        "mandate_link": link,
        "customer_contact": True,
        "contact_channel": "SMS/WhatsApp (simulated)",
        "contact_message": nudge_message,
        "nudge_schedule": ["now", nudge_2_at],
        "max_nudges": 2,
        "retries_avoided": 1,
        "notes": "Re-mandate link generated. Max 2 nudges (3-day spacing). If unresolved → STOP.",
    }


def action_escalate(event: Dict[str, Any]) -> Dict[str, Any]:
    risk = event.get("customer_risk_signals", {})
    return {
        "action_type": "ESCALATE_TO_EXCEPTIONS_QUEUE",
        "branch": BRANCH_ESCALATE,
        "retry_scheduled_at": None,
        "customer_contact": False,
        "exceptions_queue": "merchant_risk_review",
        "signal_trail": {
            "distinct_failure_codes_last_90d": risk.get("distinct_failure_codes_last_90d", []),
            "chargeback_count_last_90d": risk.get("chargeback_count_last_90d", 0),
            "refund_count_last_90d": risk.get("refund_count_last_90d", 0),
        },
        "retries_avoided": 1,
        "notes": (
            "Risk-flagged: no automated action or customer contact. "
            "Full signal trail logged for merchant/fraud-review team. "
            "This is a designed safety boundary, not a gap."
        ),
    }


def action_recover(event: Dict[str, Any]) -> Dict[str, Any]:
    customer_id = event.get("customer_id", "")
    hist = event.get("customer_payment_history", {})
    success_days = hist.get("historical_success_days_of_month", [])
    n_succeeded  = hist.get("total_cycles_succeeded", 0)

    retry_dates = next_retry_date_from_today(success_days, n_succeeded)

    return {
        "action_type": "SCHEDULE_TIMED_RETRY",
        "branch": BRANCH_RECOVER,
        "retry_scheduled_at": retry_dates[0] if retry_dates else None,
        "retry_dates": retry_dates,
        "max_retries": 2,
        "customer_contact": False,
        "timing_basis": (
            f"KDE over historical_success_days_of_month={success_days}"
            if success_days
            else "default salary-credit day windows (5, 28)"
        ),
        "retries_avoided": 0,
        "notes": (
            f"Do NOT retry immediately. Retry scheduled for {retry_dates} "
            f"(aligned to customer's historical success window). "
            f"Max 2 retries per cycle; if both fail, re-run full classification."
        ),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

ACTION_DISPATCH = {
    BRANCH_WAIT:        action_wait,
    BRANCH_STOP:        action_stop,
    BRANCH_REAUTHORIZE: action_reauthorize,
    BRANCH_ESCALATE:    action_escalate,
    BRANCH_RECOVER:     action_recover,
}


def simulate_action(event: Dict[str, Any], branch: str) -> Dict[str, Any]:
    """
    Given an event and its classified branch, simulate the bounded recovery action.

    Args:
        event: Original failure event dict.
        branch: One of WAIT/STOP/REAUTHORIZE/ESCALATE/RECOVER.

    Returns:
        Dict describing the simulated action, suitable for the audit log.
    """
    fn = ACTION_DISPATCH.get(branch, action_recover)
    return fn(event)


def simulate_batch(events: List[Dict[str, Any]], classifications: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate actions for a batch of events with their classifications."""
    return [
        simulate_action(event, clf["branch"])
        for event, clf in zip(events, classifications)
    ]
