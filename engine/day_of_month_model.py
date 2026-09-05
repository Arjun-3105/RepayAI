"""
day_of_month_model.py
=====================
Predicts the best next-retry date for RECOVER-branch customers based on
their historical success days of month.

Method:
  - Customers with ≥4 historical billing cycles: scipy gaussian_kde over
    success day-of-month values → pick the day with highest probability density.
  - Customers with <4 cycles or no history: return defaults [5, 28]
    (aligned to Indian salary-credit cycles).

Returns the next calendar date(s) to attempt the retry, starting from today.
"""

from __future__ import annotations
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import List, Optional

IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> datetime:
    """Return 'today' in IST. Overridable for testing."""
    return datetime(2026, 9, 1, 8, 0, 0, tzinfo=IST)


def predict_next_retry_days(
    historical_success_days: List[int],
    n_cycles_succeeded: int,
    n_retry_dates: int = 2,
    seed: int = 42,
) -> List[int]:
    """
    Given historical_success_days_of_month (1-28), return the top-N
    day-of-month values with highest predicted success probability.

    Args:
        historical_success_days: List of day-of-month integers (1–28) where
                                 past debits succeeded.
        n_cycles_succeeded: Total successful cycles (used to decide KDE vs. default).
        n_retry_dates: How many retry days to return (default 2).
        seed: numpy seed for reproducibility.

    Returns:
        List of day-of-month integers (1–28) sorted ascending.
    """
    if not historical_success_days or n_cycles_succeeded < 4:
        # Default to Indian salary-credit day windows
        return [5, 28]

    np.random.seed(seed)

    days = np.array(historical_success_days, dtype=float)

    if len(days) == 1:
        return [int(days[0])]

    try:
        from scipy.stats import gaussian_kde
        kde = gaussian_kde(days, bw_method="scott")
        day_range = np.arange(1, 29, dtype=float)
        density = kde(day_range)
        # Get top-N peaks
        sorted_days = day_range[np.argsort(-density)]
        top_days = sorted(int(d) for d in sorted_days[:n_retry_dates])
        return top_days
    except Exception:
        # Fallback: weighted histogram
        bins = np.zeros(29)  # index 1..28
        for d in days:
            bins[int(d)] += 1
        sorted_idx = np.argsort(-bins[1:]) + 1  # 1-indexed
        top_days = sorted(int(sorted_idx[i]) for i in range(min(n_retry_dates, len(sorted_idx))))
        return top_days


def get_retry_probability_curve(
    historical_success_days: List[int],
    n_cycles_succeeded: int,
) -> dict:
    """
    Returns a dict mapping day-of-month (1–28) to estimated success probability
    (normalized to sum to 1). Used for the dashboard probability chart.
    """
    if not historical_success_days or n_cycles_succeeded < 4:
        # Default prior: peaks at days 1-7 and 25-28 (salary-credit prior)
        probs = {}
        for d in range(1, 29):
            if d <= 7 or d >= 25:
                probs[d] = 2.0
            else:
                probs[d] = 0.5
        total = sum(probs.values())
        return {d: round(p / total, 4) for d, p in probs.items()}

    days = np.array(historical_success_days, dtype=float)

    try:
        from scipy.stats import gaussian_kde
        kde = gaussian_kde(days, bw_method="scott")
        day_range = np.arange(1, 29, dtype=float)
        density = kde(day_range)
        density = np.maximum(density, 0)
        total = density.sum()
        if total > 0:
            density /= total
        return {int(d): round(float(p), 4) for d, p in zip(day_range, density)}
    except Exception:
        bins = np.zeros(29)
        for d in days:
            bins[int(d)] += 1
        total = bins[1:].sum()
        return {d: round(float(bins[d] / total if total > 0 else 0), 4) for d in range(1, 29)}


def next_retry_date_from_today(
    historical_success_days: List[int],
    n_cycles_succeeded: int,
    reference_date: Optional[datetime] = None,
) -> List[str]:
    """
    Returns the next 1–2 ISO timestamp strings (in IST) that represent the
    scheduled retry dates, starting from reference_date (default: today IST).

    Always schedules the retry in the future (at least 1 day out).
    """
    ref = reference_date or _today_ist()
    today_day = ref.day
    retry_days = predict_next_retry_days(historical_success_days, n_cycles_succeeded)

    result_dates = []
    for target_day in retry_days:
        # Find the next occurrence of target_day >= today + 1
        attempt = ref.replace(day=1)  # start of current month
        for offset in range(0, 60):  # search within 2 months
            candidate = (attempt + timedelta(days=offset))
            try:
                candidate = candidate.replace(day=target_day)
            except ValueError:
                continue
            if candidate > ref + timedelta(days=1):
                result_dates.append(candidate.strftime("%Y-%m-%dT%H:%M:%S+05:30"))
                break

    if not result_dates:
        # Last resort fallback
        result_dates = [(ref + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S+05:30")]

    return result_dates[:2]


# ---------------------------------------------------------------------------
# Quick self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Test 1: Customer with strong salary-day clustering (days 1-3, 28-30)
    test_days = [1, 1, 2, 3, 28, 29, 30, 1, 2, 28]
    best = predict_next_retry_days(test_days, n_cycles_succeeded=10)
    print(f"Test 1 (salary-day clustering {test_days}): best retry days = {best}")

    # Test 2: Scattered success days
    test_days2 = [5, 10, 15, 20, 25, 3, 8, 12]
    best2 = predict_next_retry_days(test_days2, n_cycles_succeeded=8)
    print(f"Test 2 (scattered {test_days2}): best retry days = {best2}")

    # Test 3: New customer (< 4 cycles)
    best3 = predict_next_retry_days([], n_cycles_succeeded=2)
    print(f"Test 3 (new customer): best retry days = {best3}")

    # Test 4: Probability curve
    curve = get_retry_probability_curve([1, 2, 3, 28, 29], n_cycles_succeeded=10)
    peak_day = max(curve, key=curve.get)
    print(f"Test 4: peak probability day = {peak_day} (prob={curve[peak_day]})")

    # Test 5: Next retry dates
    dates = next_retry_date_from_today([1, 2, 3, 28, 29], 10)
    print(f"Test 5: next retry dates = {dates}")
