"""
generate_synthetic_batch.py
===========================
Generates 300 synthetic customers (~600-800 failure events) for the
Recoverability Engine demo.

Fixed seed = 42 → fully reproducible; regenerating live will produce the same output.

Outputs:
  data/synthetic_batch.json   — classifier input (schema per plan Section 3.1)
  data/ground_truth.json      — event_id → ground_truth_branch (NEVER read by classifier)

Privacy note: All data is synthetically generated end-to-end.
Identifier formats (tokenized IDs, masked VPA/phone) follow DPDP Rules 2025 conventions.
"""

import json
import random
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from faker import Faker

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

fake = Faker("en_IN")
fake.seed_instance(SEED)

IST = timezone(timedelta(hours=5, minutes=30))
N_CUSTOMERS = 300
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Real NPCI / UPI failure codes (Section 2)
# ---------------------------------------------------------------------------
FAILURE_CODES = {
    "Z9":  "Insufficient funds",
    "U69": "Server-side timeout / PSP unavailable",
    "U28": "Remitter bank is down",
    "Z7":  "Velocity limit exceeded",
    "Z8":  "Per-transaction limit exceeded",
    "U30": "Generic debit failure",
    "01":  "Account closed",
    "02":  "No such account",
    "04":  "Balance insufficient (mandate-presentation-level)",
    "06":  "Payment stopped by drawer",
    "07":  "Payment stopped under court order",
    "MANDATE_EXPIRED": "Mandate validity lapsed",
    "MANDATE_PAUSED":  "Customer paused mandate",
}

# ---------------------------------------------------------------------------
# Archetype definitions (Section 5.2)
# ---------------------------------------------------------------------------
ARCHETYPES = [
    # (name, fraction, ground_truth_branch)
    ("timing_mismatch",   0.45, "RECOVER"),
    ("genuinely_struggling", 0.15, "STOP"),
    ("bank_instability",  0.10, "WAIT"),
    ("mandate_lifecycle", 0.12, "REAUTHORIZE"),
    ("structurally_invalid", 0.08, "STOP"),
    ("erratic_risk",      0.10, "ESCALATE"),
]

# ---------------------------------------------------------------------------
# Mandate categories + realistic amount bands (Section 5.7)
# ---------------------------------------------------------------------------
MANDATE_CATEGORIES = [
    # (name, amount_min, amount_max, weight)
    ("OTT/streaming",       149,    649,  0.20),
    ("SIP/micro-investment", 500,  5000,  0.28),
    ("Loan EMI",            1000, 15000,  0.28),
    ("Insurance premium",    500,  3000,  0.14),
    ("Utility/subscription",  99,   999,  0.10),
]
CAT_NAMES   = [c[0] for c in MANDATE_CATEGORIES]
CAT_WEIGHTS = np.array([c[3] for c in MANDATE_CATEGORIES])
CAT_WEIGHTS = CAT_WEIGHTS / CAT_WEIGHTS.sum()

def sample_amount(category_name: str) -> float:
    for name, lo, hi, _ in MANDATE_CATEGORIES:
        if name == category_name:
            return round(random.uniform(lo, hi), 2)
    return 499.0

def pick_category() -> str:
    return np.random.choice(CAT_NAMES, p=CAT_WEIGHTS)

# ---------------------------------------------------------------------------
# Customer / mandate generation helpers
# ---------------------------------------------------------------------------
def make_customer_id(idx: int) -> str:
    return f"cust_{idx:04d}"

def make_mandate_id(customer_id: str, category: str) -> str:
    slug = category.lower().replace("/", "_").replace(" ", "_")
    return f"mandate_{customer_id}_{slug}"

def make_event_id(customer_id: str, cycle_num: int) -> str:
    return f"evt_{customer_id}_{cycle_num:03d}"

def ist_now() -> datetime:
    return datetime(2026, 9, 1, 8, 0, 0, tzinfo=IST)

def random_past_date(months_back_min: int, months_back_max: int) -> datetime:
    days_back = random.randint(months_back_min * 30, months_back_max * 30)
    return ist_now() - timedelta(days=days_back)

def fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+05:30")

# ---------------------------------------------------------------------------
# Generate per-archetype payment history
# ---------------------------------------------------------------------------

def timing_mismatch_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """
    Customer succeeds reliably within a 5-7 day window (salary-credit window),
    fails with Z9 outside that window.

    Strategy: simulate two events per cycle — one FAIL early in the month
    (before salary credit), then one SUCCESS in the salary window (days 1-7
    or 25-28). This ensures:
      - historical_success_days_of_month is populated (drives RECOVER timing)
      - consecutive_failures stays at 0-1 (no STOP trigger)
      - The final failure event is a Z9 timed outside the window.
    """
    # Pick a success window: either early-month (days 1-5) or late-month (25-28)
    success_window_start = random.choice([1, 25])
    success_window = list(range(success_window_start, success_window_start + 5))
    success_window = [max(1, min(d, 28)) for d in success_window]

    # Billing day is deliberately OUTSIDE the success window
    # so the final event (which is what gets classified) is a failure
    fail_day = random.choice([10, 11, 12, 13, 14, 15, 16, 17, 18])

    events = []
    current = mandate_created_at.replace(day=1)
    for i in range(n_cycles - 1):  # All but the last cycle
        # Each past cycle: customer FAILED on the attempt day but was later
        # recovered (salary came in, bank retried, etc.) — simulate as SUCCESS
        # on a day in the success window.
        success_day = random.choice(success_window)
        try:
            success_dt = current.replace(day=success_day)
        except ValueError:
            success_dt = current.replace(day=28)
        events.append(("SUCCESS", success_dt, None))
        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)

    # Final cycle: FAIL on the billing day (outside success window)
    try:
        fail_dt = current.replace(day=fail_day)
    except ValueError:
        fail_dt = current.replace(day=15)
    events.append(("FAIL", fail_dt, "Z9"))

    return events, success_window


def struggling_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """3+ consecutive Z9 failures, declining over time."""
    events = []
    current = mandate_created_at.replace(day=1)
    failures_recent = 0
    for i in range(n_cycles):
        try:
            attempt = current.replace(day=min(billing_day, 28))
        except ValueError:
            attempt = current.replace(day=28)

        if i < n_cycles - 4:
            # Earlier cycles: mixed success/fail
            if random.random() < 0.6:
                events.append(("SUCCESS", attempt, "Z9"))
                failures_recent = 0
            else:
                events.append(("FAIL", attempt, "Z9"))
                failures_recent += 1
        else:
            # Last 4 cycles: all fail with Z9
            events.append(("FAIL", attempt, "Z9"))
            failures_recent += 1

        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)

    return events, []


def bank_instability_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """Random U69/U28 events, otherwise succeeds."""
    events = []
    success_days = []
    current = mandate_created_at.replace(day=1)
    for i in range(n_cycles):
        try:
            attempt = current.replace(day=min(billing_day, 28))
        except ValueError:
            attempt = current.replace(day=28)

        if random.random() < 0.7:
            events.append(("SUCCESS", attempt, None))
            success_days.append(billing_day)
        else:
            code = random.choice(["U69", "U28"])
            events.append(("FAIL", attempt, code))

        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)

    return events, success_days


def mandate_lifecycle_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """Mix of PAUSED/EXPIRED mandate failures."""
    events = []
    success_days = []
    current = mandate_created_at.replace(day=1)
    for i in range(n_cycles - 1):
        try:
            attempt = current.replace(day=min(billing_day, 28))
        except ValueError:
            attempt = current.replace(day=28)
        events.append(("SUCCESS", attempt, None))
        success_days.append(billing_day)
        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)

    # Final event: mandate problem
    try:
        attempt = current.replace(day=min(billing_day, 28))
    except ValueError:
        attempt = current.replace(day=28)
    events.append(("FAIL", attempt, "06"))
    return events, success_days


def structurally_invalid_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """Account closed/non-existent — immediate stop."""
    events = []
    current = mandate_created_at.replace(day=1)
    for i in range(n_cycles):
        try:
            attempt = current.replace(day=min(billing_day, 28))
        except ValueError:
            attempt = current.replace(day=28)
        code = random.choice(["01", "02", "07"])
        events.append(("FAIL", attempt, code))
        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)
    return events, []


def erratic_risk_history(mandate_created_at: datetime, billing_day: int, n_cycles: int):
    """Multiple distinct failure codes, some chargebacks."""
    risk_codes = ["Z9", "U69", "Z7", "Z8", "U30", "04"]
    events = []
    success_days = []
    current = mandate_created_at.replace(day=1)
    for i in range(n_cycles):
        try:
            attempt = current.replace(day=min(billing_day, 28))
        except ValueError:
            attempt = current.replace(day=28)

        if random.random() < 0.4:
            events.append(("SUCCESS", attempt, None))
            success_days.append(billing_day)
        else:
            code = random.choice(risk_codes)
            events.append(("FAIL", attempt, code))

        current = (current.replace(day=1) + timedelta(days=32)).replace(day=1)
    return events, success_days


HISTORY_GENERATORS = {
    "timing_mismatch":      timing_mismatch_history,
    "genuinely_struggling": struggling_history,
    "bank_instability":     bank_instability_history,
    "mandate_lifecycle":    mandate_lifecycle_history,
    "structurally_invalid": structurally_invalid_history,
    "erratic_risk":         erratic_risk_history,
}

# ---------------------------------------------------------------------------
# Build a single customer record
# ---------------------------------------------------------------------------

def build_customer(customer_idx: int, archetype: str, ground_truth_branch: str):
    customer_id = make_customer_id(customer_idx)
    category = pick_category()
    amount_inr = sample_amount(category)
    merchant_id = "merch_demo"

    # Mandate dates
    months_back = random.randint(3, 14)
    mandate_created_at = random_past_date(months_back, months_back)
    mandate_expiry_at = mandate_created_at + timedelta(days=365)

    # Billing day (1-28 to avoid month-end complexity)
    billing_day = random.randint(1, 28)

    # Determine how many billing cycles have elapsed
    n_cycles = max(2, months_back)

    # Generate history
    gen_fn = HISTORY_GENERATORS[archetype]
    history_events, success_days = gen_fn(mandate_created_at, billing_day, n_cycles)

    # Derive payment history stats
    successes = [e for e in history_events if e[0] == "SUCCESS"]
    fails = [e for e in history_events if e[0] == "FAIL"]

    total_succeeded = len(successes)
    total_failed = len(fails)
    total_cycles = len(history_events)

    # Consecutive failures: count ONLY the trailing run of failures
    # (exclude the final event itself — that's the one being classified)
    # This correctly reflects: how many times in a row has this customer
    # failed WITHOUT a success in between, immediately before NOW.
    consecutive_failures = 0
    for e in reversed(history_events[:-1]):  # reverse, excluding the final event
        if e[0] == "FAIL":
            consecutive_failures += 1
        else:
            # A success resets the streak — stop counting
            break

    last_success_at = None
    for e in reversed(history_events[:-1]):
        if e[0] == "SUCCESS":
            last_success_at = e[1]
            break

    prior_retries = 0
    days_since_retry = None

    # Historical success days of month (from actual successes)
    historical_success_days = sorted(set(
        e[1].day for e in history_events[:-1] if e[0] == "SUCCESS"
    ))
    if not historical_success_days:
        historical_success_days = []

    # Risk signals
    last_90_days = ist_now() - timedelta(days=90)
    recent_failures = [
        e for e in history_events
        if e[0] == "FAIL" and e[1] >= last_90_days
    ]
    distinct_codes_90d = list(set(e[2] for e in recent_failures if e[2]))
    refund_count = 0
    chargeback_count = 0
    if archetype == "erratic_risk":
        chargeback_count = random.choice([0, 0, 1, 1, 2])
        refund_count = random.randint(0, 3)

    # Final failure event
    final_event = history_events[-1]
    failure_code = final_event[2]
    failure_timestamp = final_event[1]

    # Mandate status
    if archetype == "mandate_lifecycle":
        mandate_status = random.choice(["PAUSED", "REVOKED", "EXPIRED"])
        if failure_code == "06":
            mandate_status = "ACTIVE"  # customer paused via code 06
    elif archetype == "structurally_invalid":
        mandate_status = "ACTIVE"
    else:
        mandate_status = "ACTIVE"

    # For genuinely_struggling: ensure consecutive_failures >= 3
    if archetype == "genuinely_struggling":
        consecutive_failures = max(consecutive_failures, 3)
        failure_code = "Z9"

    # For erratic_risk: ensure ≥3 distinct failure codes in 90d
    if archetype == "erratic_risk":
        # Force at least 3 distinct codes
        all_risk_codes = ["Z9", "U69", "Z7", "Z8", "U30"]
        while len(distinct_codes_90d) < 3:
            extra = random.choice(all_risk_codes)
            if extra not in distinct_codes_90d:
                distinct_codes_90d.append(extra)

    # For bank_instability: ensure final code is U69 or U28
    if archetype == "bank_instability":
        failure_code = random.choice(["U69", "U28"])

    # For structurally_invalid: ensure final code is 01/02/07
    if archetype == "structurally_invalid":
        failure_code = random.choice(["01", "02", "07"])

    event_id = make_event_id(customer_id, n_cycles)
    mandate_id = make_mandate_id(customer_id, category)

    event = {
        "event_id": event_id,
        "customer_id": customer_id,
        "mandate_id": mandate_id,
        "merchant_id": merchant_id,
        "mandate_category": category,
        "amount_inr": amount_inr,
        "failure_code": failure_code,
        "failure_timestamp": fmt(failure_timestamp),
        "mandate_status": mandate_status,
        "mandate_created_at": fmt(mandate_created_at),
        "mandate_expiry_at": fmt(mandate_expiry_at),
        "cycle_frequency": "MONTHLY",
        "customer_payment_history": {
            "total_cycles_billed": total_cycles,
            "total_cycles_succeeded": total_succeeded,
            "total_cycles_failed": total_failed,
            "consecutive_failures": consecutive_failures,
            "last_success_at": fmt(last_success_at) if last_success_at else None,
            "historical_success_days_of_month": historical_success_days,
            "prior_retry_attempts_this_cycle": prior_retries,
            "days_since_last_retry": days_since_retry,
        },
        "customer_risk_signals": {
            "refund_count_last_90d": refund_count,
            "chargeback_count_last_90d": chargeback_count,
            "distinct_failure_codes_last_90d": distinct_codes_90d,
        },
    }

    ground_truth = {
        "event_id": event_id,
        "customer_id": customer_id,
        "archetype": archetype,
        "ground_truth_branch": ground_truth_branch,
    }

    return event, ground_truth


# ---------------------------------------------------------------------------
# Main generation loop
# ---------------------------------------------------------------------------

def generate():
    # Build archetype assignment list
    assignments = []
    for name, fraction, branch in ARCHETYPES:
        count = round(N_CUSTOMERS * fraction)
        assignments.extend([(name, branch)] * count)

    # Trim/pad to exactly N_CUSTOMERS
    while len(assignments) < N_CUSTOMERS:
        assignments.append(("timing_mismatch", "RECOVER"))
    assignments = assignments[:N_CUSTOMERS]

    random.shuffle(assignments)

    batch = []
    ground_truths = []

    for idx, (archetype, branch) in enumerate(assignments):
        event, gt = build_customer(idx + 1, archetype, branch)
        batch.append(event)
        ground_truths.append(gt)

    # Output
    batch_path = os.path.join(OUTPUT_DIR, "synthetic_batch.json")
    gt_path = os.path.join(OUTPUT_DIR, "ground_truth.json")

    with open(batch_path, "w") as f:
        json.dump(batch, f, indent=2, default=str)

    with open(gt_path, "w") as f:
        json.dump(ground_truths, f, indent=2)

    print(f"✅ Generated {len(batch)} failure events → {batch_path}")
    print(f"✅ Ground truth labels → {gt_path}")

    # Summary
    from collections import Counter
    branch_counts = Counter(g["ground_truth_branch"] for g in ground_truths)
    archetype_counts = Counter(g["archetype"] for g in ground_truths)
    print("\n📊 Branch distribution:")
    for b, c in sorted(branch_counts.items()):
        print(f"   {b}: {c}")
    print("\n🏷️  Archetype distribution:")
    for a, c in sorted(archetype_counts.items()):
        print(f"   {a}: {c}")

    return batch, ground_truths


if __name__ == "__main__":
    generate()
