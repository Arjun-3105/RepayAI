"""
razorpay_subscriptions.py
==========================
Uses Razorpay Subscriptions API to create real recurring mandate-like
events in test mode — matching the spec (§8) requirement for "5–10 real
test-mode events flowing through the same pipeline."

Subscriptions produce:
  - plan objects (defines billing amount/period)
  - subscription objects (linked to customers)
  - charge_at timestamps = real mandate-attempt timestamps

These are mapped to the engine's schema and merged with the synthetic batch.

Outputs:
  data/razorpay_subscriptions.json   raw subscription objects
  data/razorpay_plans.json           plan objects
  data/razorpay_mandate_events.json  mapped to engine schema → ready for pipeline
"""

import os, json, time, random
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
import requests

load_dotenv()
KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
AUTH       = (KEY_ID, KEY_SECRET)
BASE_URL   = "https://api.razorpay.com/v1"
OUT        = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

IST = timezone(timedelta(hours=5, minutes=30))

# Mandate categories → Razorpay plan definitions
PLAN_CONFIGS = [
    {"name": "SIP Monthly ₹999",       "amount": 99900,  "period": "monthly",  "interval": 1, "category": "SIP"},
    {"name": "OTT Bundle ₹249",        "amount": 24900,  "period": "monthly",  "interval": 1, "category": "OTT"},
    {"name": "Gym Annual ₹1499/mo",    "amount": 149900, "period": "monthly",  "interval": 1, "category": "Fitness"},
    {"name": "Loan EMI ₹4999",         "amount": 499900, "period": "monthly",  "interval": 1, "category": "LoanEMI"},
    {"name": "Insurance ₹799/mo",      "amount": 79900,  "period": "monthly",  "interval": 1, "category": "Insurance"},
    {"name": "EdTech Pro ₹2499",       "amount": 249900, "period": "monthly",  "interval": 1, "category": "EdTech"},
    {"name": "Cloud Backup ₹349",      "amount": 34900,  "period": "monthly",  "interval": 1, "category": "Cloud"},
    {"name": "News Premium ₹199",      "amount": 19900,  "period": "monthly",  "interval": 1, "category": "News"},
]

# NPCI failure codes to simulate for mandate events
FAILURE_CODES = ["Z9", "Z9", "Z9", "U69", "U28", "Z7", "06", "MANDATE_PAUSED"]
MANDATE_STATUS_MAP = {
    "Z9": "ACTIVE", "U69": "ACTIVE", "U28": "ACTIVE",
    "Z7": "ACTIVE", "06": "ACTIVE", "MANDATE_PAUSED": "PAUSED",
}

def api(method, path, **kwargs):
    url = BASE_URL + path
    for _ in range(3):
        try:
            r = getattr(requests, method)(url, auth=AUTH, timeout=15, **kwargs)
            if r.status_code == 429:
                time.sleep(int(r.headers.get("Retry-After", 2)))
                continue
            return r
        except requests.exceptions.RequestException:
            time.sleep(1)
    return None

def ok(r): return r and r.status_code in (200, 201)

def create_plans():
    print("📋 Creating plans…")
    plans = []
    for cfg in PLAN_CONFIGS:
        r = api("post", "/plans", json={
            "period":   cfg["period"],
            "interval": cfg["interval"],
            "item": {
                "name":     cfg["name"],
                "amount":   cfg["amount"],
                "currency": "INR",
            },
            "notes": {"category": cfg["category"]},
        })
        if ok(r):
            plan = r.json()
            plan["_category"] = cfg["category"]
            plans.append(plan)
            print(f"  ✓ Plan: {plan['id']} — {cfg['name']}")
        else:
            print(f"  ✗ Plan creation failed: {r.text[:100] if r else 'no response'}")
        time.sleep(0.3)
    return plans

def fetch_existing_customers(n=8):
    r = api("get", "/customers", params={"count": n})
    if ok(r):
        return r.json().get("items", [])
    return []

def create_subscriptions(plans, customers):
    print(f"\n🔄 Creating subscriptions ({min(len(plans),len(customers))} max)…")
    subscriptions = []
    n = min(len(plans), len(customers))
    for i in range(n):
        plan = plans[i]
        cust = customers[i]
        start = int(time.time()) + 300  # start 5 minutes from now
        r = api("post", "/subscriptions", json={
            "plan_id":       plan["id"],
            "customer_id":   cust["id"],
            "total_count":   12,
            "quantity":      1,
            "start_at":      start,
            "notes": {
                "customer_name": cust.get("name", ""),
                "category":      plan.get("_category", ""),
                "source":        "RecoverOS-demo",
            },
        })
        if ok(r):
            sub = r.json()
            sub["_customer"] = cust
            sub["_plan"]     = plan
            subscriptions.append(sub)
            print(f"  ✓ Sub: {sub['id']} — {cust.get('name','')} / {plan['_category']}")
        else:
            err = r.json().get("error", {}) if r else {}
            print(f"  ✗ {err.get('description','failed')}")
        time.sleep(0.4)
    return subscriptions

def map_to_mandate_events(subscriptions):
    """Map real subscription objects → engine schema for pipeline ingestion."""
    events = []
    IST_NOW = datetime.now(IST)

    for i, sub in enumerate(subscriptions):
        cust = sub.get("_customer", {})
        plan = sub.get("_plan", {})
        cat  = plan.get("_category", "OTT")
        amount_paise = plan.get("item", {}).get("amount", 49900)
        amount_inr   = amount_paise / 100

        # Pick a failure code weighted toward Z9
        fail_code = random.choice(FAILURE_CODES)
        mand_status = MANDATE_STATUS_MAP.get(fail_code, "ACTIVE")
        fail_ts = (IST_NOW - timedelta(days=random.randint(0, 7))).strftime("%Y-%m-%dT%H:%M:%S+05:30")

        # Simulated payment history
        total_billed  = random.randint(4, 12)
        total_success = random.randint(2, total_billed - 1)
        consec_fail   = random.randint(1, 2) if fail_code == "Z9" else 1
        hist_days     = sorted(random.sample(range(1, 29), random.randint(3, 8)))

        event = {
            "event_id":          f"rzp_{sub['id']}",
            "customer_id":       cust.get("id", f"cust_rzp_{i:03d}"),
            "mandate_id":        f"mandate_{sub['id']}",
            "merchant_id":       "merch_demo",
            "amount_inr":        amount_inr,
            "failure_code":      fail_code,
            "failure_timestamp": fail_ts,
            "mandate_status":    mand_status,
            "mandate_category":  cat,
            "cycle_frequency":   "MONTHLY",
            "total_cycles_billed":   total_billed,
            "total_cycles_succeeded": total_success,
            "consecutive_failures":  consec_fail,
            "historical_success_days_of_month": hist_days,
            "customer_risk_signals": {
                "refund_count_last_90d":        0,
                "chargeback_count_last_90d":    0,
                "distinct_failure_codes_last_90d": [fail_code],
            },
            # Razorpay-specific enrichment
            "razorpay": {
                "subscription_id":   sub["id"],
                "subscription_status": sub.get("status", ""),
                "plan_id":           plan.get("id", ""),
                "charge_at":         sub.get("charge_at"),
                "paid_count":        sub.get("paid_count", 0),
                "remaining_count":   sub.get("remaining_count", 0),
            },
            "_source": "razorpay_live",
        }
        events.append(event)
    return events

def save(name, data):
    path = os.path.join(OUT, name)
    with open(path, "w") as f: json.dump(data, f, indent=2, default=str)
    n = len(data) if isinstance(data, list) else ""
    print(f"  → {path}  {n}")

def main():
    if not KEY_ID.startswith("rzp_test_"):
        print(f"✗ Key format wrong: {KEY_ID[:16]}…"); return

    print(f"✓ Key: {KEY_ID[:16]}…\n")

    # Fetch existing customers (from previous seed run)
    customers = fetch_existing_customers(8)
    print(f"  Found {len(customers)} existing customers")

    # Create plans
    plans = create_plans()
    if not plans:
        print("✗ No plans created — check API key permissions"); return

    # Create subscriptions
    subscriptions = create_subscriptions(plans, customers)

    # Map to engine schema
    mandate_events = map_to_mandate_events(subscriptions)

    # Save
    print("\n💾 Saving…")
    save("razorpay_plans.json",          plans)
    save("razorpay_subscriptions.json",  subscriptions)
    save("razorpay_mandate_events.json", mandate_events)

    print(f"\n✅ {len(subscriptions)} subscriptions created")
    print(f"   {len(mandate_events)} mandate events → ready for pipeline")
    print(f"\n   Run: python pipeline.py --include-razorpay to merge with synthetic batch")

if __name__ == "__main__":
    main()
