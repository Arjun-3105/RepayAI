"""
test_rule_engine.py
===================
10+ hand-crafted edge-case unit tests for the rule engine.
One test per branch minimum, plus boundary conditions.

Run with:  python -m pytest engine/tests/ -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from rule_engine import classify, BRANCH_WAIT, BRANCH_STOP, BRANCH_REAUTHORIZE, BRANCH_ESCALATE, BRANCH_RECOVER


# ---------------------------------------------------------------------------
# Fixtures: minimal valid event template
# ---------------------------------------------------------------------------

def base_event(**overrides) -> dict:
    """Build a minimal valid event, apply any overrides."""
    event = {
        "event_id": "evt_test_001",
        "customer_id": "cust_test",
        "mandate_id": "mandate_test",
        "merchant_id": "merch_demo",
        "amount_inr": 999.0,
        "failure_code": "Z9",
        "failure_timestamp": "2026-09-01T08:00:00+05:30",
        "mandate_status": "ACTIVE",
        "mandate_created_at": "2025-09-01T10:00:00+05:30",
        "mandate_expiry_at": "2026-09-01T10:00:00+05:30",
        "cycle_frequency": "MONTHLY",
        "customer_payment_history": {
            "total_cycles_billed": 10,
            "total_cycles_succeeded": 8,
            "total_cycles_failed": 2,
            "consecutive_failures": 1,
            "last_success_at": "2026-08-01T08:00:00+05:30",
            "historical_success_days_of_month": [1, 2, 3, 4, 5],
            "prior_retry_attempts_this_cycle": 0,
            "days_since_last_retry": None,
        },
        "customer_risk_signals": {
            "refund_count_last_90d": 0,
            "chargeback_count_last_90d": 0,
            "distinct_failure_codes_last_90d": ["Z9"],
        },
    }
    # Deep merge for nested dicts
    for k, v in overrides.items():
        if isinstance(v, dict) and k in event and isinstance(event[k], dict):
            event[k].update(v)
        else:
            event[k] = v
    return event


# ---------------------------------------------------------------------------
# Branch 1: WAIT
# ---------------------------------------------------------------------------

def test_wait_U69():
    """U69 (PSP timeout) → WAIT."""
    event = base_event(failure_code="U69")
    result = classify(event)
    assert result["branch"] == BRANCH_WAIT
    assert "30 minutes" in result["rule_rationale"]


def test_wait_U28():
    """U28 (bank down) → WAIT."""
    event = base_event(failure_code="U28")
    result = classify(event)
    assert result["branch"] == BRANCH_WAIT
    assert "4 hours" in result["rule_rationale"]


# ---------------------------------------------------------------------------
# Branch 2: STOP
# ---------------------------------------------------------------------------

def test_stop_account_closed():
    """Code 01 (account closed) → STOP."""
    event = base_event(failure_code="01")
    result = classify(event)
    assert result["branch"] == BRANCH_STOP


def test_stop_no_such_account():
    """Code 02 (no such account) → STOP."""
    event = base_event(failure_code="02")
    result = classify(event)
    assert result["branch"] == BRANCH_STOP


def test_stop_court_order():
    """Code 07 (court order) → STOP."""
    event = base_event(failure_code="07")
    result = classify(event)
    assert result["branch"] == BRANCH_STOP


def test_stop_z9_three_consecutive():
    """Z9 with consecutive_failures=3 → STOP (threshold reached)."""
    event = base_event(
        failure_code="Z9",
        customer_payment_history={"consecutive_failures": 3},
    )
    result = classify(event)
    assert result["branch"] == BRANCH_STOP


def test_not_stop_z9_two_consecutive():
    """Z9 with consecutive_failures=2 → should NOT be STOP (below threshold)."""
    event = base_event(
        failure_code="Z9",
        customer_payment_history={"consecutive_failures": 2},
    )
    result = classify(event)
    assert result["branch"] != BRANCH_STOP


# ---------------------------------------------------------------------------
# Branch 3: REAUTHORIZE
# ---------------------------------------------------------------------------

def test_reauthorize_paused_mandate():
    """mandate_status=PAUSED → REAUTHORIZE."""
    event = base_event(mandate_status="PAUSED")
    result = classify(event)
    assert result["branch"] == BRANCH_REAUTHORIZE


def test_reauthorize_revoked_mandate():
    """mandate_status=REVOKED → REAUTHORIZE."""
    event = base_event(mandate_status="REVOKED")
    result = classify(event)
    assert result["branch"] == BRANCH_REAUTHORIZE


def test_reauthorize_expired_mandate():
    """mandate_status=EXPIRED → REAUTHORIZE."""
    event = base_event(mandate_status="EXPIRED")
    result = classify(event)
    assert result["branch"] == BRANCH_REAUTHORIZE


def test_reauthorize_code_06():
    """Code 06 (stopped by drawer) → REAUTHORIZE."""
    event = base_event(failure_code="06")
    result = classify(event)
    assert result["branch"] == BRANCH_REAUTHORIZE


# ---------------------------------------------------------------------------
# Branch 4: ESCALATE
# ---------------------------------------------------------------------------

def test_escalate_three_distinct_codes():
    """3 distinct failure codes in 90d → ESCALATE."""
    event = base_event(
        customer_risk_signals={
            "distinct_failure_codes_last_90d": ["Z9", "U69", "Z7"],
            "chargeback_count_last_90d": 0,
            "refund_count_last_90d": 0,
        }
    )
    result = classify(event)
    assert result["branch"] == BRANCH_ESCALATE


def test_escalate_chargeback():
    """Any chargeback_count_last_90d > 0 → ESCALATE."""
    event = base_event(
        customer_risk_signals={
            "distinct_failure_codes_last_90d": ["Z9"],
            "chargeback_count_last_90d": 1,
            "refund_count_last_90d": 0,
        }
    )
    result = classify(event)
    assert result["branch"] == BRANCH_ESCALATE


def test_not_escalate_two_distinct_codes():
    """Only 2 distinct codes and no chargeback → should NOT escalate."""
    event = base_event(
        customer_risk_signals={
            "distinct_failure_codes_last_90d": ["Z9", "U69"],
            "chargeback_count_last_90d": 0,
            "refund_count_last_90d": 0,
        }
    )
    result = classify(event)
    assert result["branch"] != BRANCH_ESCALATE


# ---------------------------------------------------------------------------
# Branch 5: RECOVER
# ---------------------------------------------------------------------------

def test_recover_default_z9():
    """Z9, ACTIVE mandate, no risk flags, 1 consecutive failure → RECOVER."""
    event = base_event(
        failure_code="Z9",
        mandate_status="ACTIVE",
        customer_payment_history={"consecutive_failures": 1},
        customer_risk_signals={
            "distinct_failure_codes_last_90d": ["Z9"],
            "chargeback_count_last_90d": 0,
            "refund_count_last_90d": 0,
        },
    )
    result = classify(event)
    assert result["branch"] == BRANCH_RECOVER


def test_recover_new_customer():
    """New customer, no history → RECOVER with default salary-cycle days."""
    event = base_event(
        failure_code="Z9",
        customer_payment_history={
            "total_cycles_billed": 1,
            "total_cycles_succeeded": 0,
            "total_cycles_failed": 1,
            "consecutive_failures": 1,
            "historical_success_days_of_month": [],
        },
    )
    result = classify(event)
    assert result["branch"] == BRANCH_RECOVER


# ---------------------------------------------------------------------------
# Priority ordering tests
# ---------------------------------------------------------------------------

def test_wait_beats_escalate():
    """U69 + 3 distinct codes → WAIT should win (infrastructure check first)."""
    event = base_event(
        failure_code="U69",
        customer_risk_signals={
            "distinct_failure_codes_last_90d": ["Z9", "U69", "Z7"],
            "chargeback_count_last_90d": 0,
            "refund_count_last_90d": 0,
        },
    )
    result = classify(event)
    assert result["branch"] == BRANCH_WAIT  # Branch 1 beats Branch 4


def test_stop_beats_reauthorize():
    """Code 01 (dead account) with PAUSED status → STOP should win."""
    event = base_event(
        failure_code="01",
        mandate_status="PAUSED",
    )
    result = classify(event)
    assert result["branch"] == BRANCH_STOP  # Branch 2 beats Branch 3


# ---------------------------------------------------------------------------
# Confidence signals present in output
# ---------------------------------------------------------------------------

def test_classification_returns_confidence_signals():
    """Every classification result should include confidence_signals."""
    event = base_event()
    result = classify(event)
    assert "confidence_signals" in result
    signals = result["confidence_signals"]
    assert "failure_code" in signals
    assert "consecutive_failures" in signals
    assert "branch_selected" in signals
