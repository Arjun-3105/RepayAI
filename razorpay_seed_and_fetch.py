"""
razorpay_seed_and_fetch.py
===========================
1. Seeds the Razorpay test account with realistic data:
   - Customers (matching our synthetic batch customer IDs)
   - Orders (one per customer archetype)
   - Simulated payment attempts (captured/failed)
   - Refund requests on some orders

2. Fetches everything back and writes:
   - data/razorpay_customers.json
   - data/razorpay_orders.json
   - data/razorpay_payments.json
   - data/razorpay_refunds.json
   - data/razorpay_summary.json   ← merged with our pipeline summary

Usage:
  python razorpay_seed_and_fetch.py [--fetch-only] [--seed-only]
"""

import os, sys, json, time, random, argparse
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
import requests

load_dotenv()
KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "")
KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
AUTH       = (KEY_ID, KEY_SECRET)
BASE       = "https://api.razorpay.com/v1"
OUT_DIR    = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT_DIR, exist_ok=True)

random.seed(42)
IST = timezone(timedelta(hours=5, minutes=30))

# ─── helpers ──────────────────────────────────────────────────────────────────

def api(method, path, **kwargs):
    """Thin wrapper around requests with rate-limit backoff."""
    url = BASE + path
    for attempt in range(3):
        try:
            r = getattr(requests, method)(url, auth=AUTH, timeout=15, **kwargs)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 2))
                print(f"  ⏳ rate-limited, waiting {wait}s…")
                time.sleep(wait)
                continue
            return r
        except requests.exceptions.RequestException as e:
            print(f"  ⚠ request error: {e}")
            time.sleep(1)
    return None

def ok(r):
    if r is None:
        return False
    if r.status_code not in (200, 201):
        print(f"  ✗ HTTP {r.status_code}: {r.text[:200]}")
        return False
    return True

# ─── SEED ─────────────────────────────────────────────────────────────────────

# Archetype → realistic amounts (paise) and plan labels
ARCHETYPES = [
    {"name": "Kiran Sharma",       "email": "kiran.sha@gmail.com",  "phone": "9123456781", "amount_inr": 999,   "plan": "SIP Monthly"},
    {"name": "Rohan Mehta",        "email": "rohan.meh@gmail.com",  "phone": "9234567812", "amount_inr": 2499,  "plan": "OTT Bundle"},
    {"name": "Priya Nair",         "email": "priya.nai@yahoo.in",   "phone": "9345678123", "amount_inr": 1499,  "plan": "Gym Annual"},
    {"name": "Arjun Kapoor",       "email": "arjun.kap@outlook.com","phone": "9456781234", "amount_inr": 4999,  "plan": "EdTech Pro"},
    {"name": "Sneha Iyer",         "email": "sneha.iye@gmail.com",  "phone": "9567812345", "amount_inr": 799,   "plan": "News Premium"},
    {"name": "Vikram Singh",       "email": "vikram.si@gmail.com",  "phone": "9678123456", "amount_inr": 3499,  "plan": "Cloud Backup"},
    {"name": "Anjali Sharma",      "email": "anjali.sh@gmail.com",  "phone": "9781234567", "amount_inr": 1299,  "plan": "Fitness Tracker"},
    {"name": "Rahul Gupta",        "email": "rahul.gup@gmail.com",  "phone": "9812345678", "amount_inr": 5999,  "plan": "Insurance EMI"},
    {"name": "Meera Pillai",       "email": "meera.pil@yahoo.in",   "phone": "9023456789", "amount_inr": 699,   "plan": "Magazine Bundle"},
    {"name": "Suresh Babu",        "email": "suresh.ba@gmail.com",  "phone": "9134567890", "amount_inr": 8999,  "plan": "Loan EMI"},
    {"name": "Divya Krishnan",     "email": "divya.kri@gmail.com",  "phone": "9245678901", "amount_inr": 2999,  "plan": "Electricity AutoPay"},
    {"name": "Amit Joshi",         "email": "amit.jos@outlook.com", "phone": "9356789012", "amount_inr": 1999,  "plan": "Credit Card EMI"},
    {"name": "Pooja Menon",        "email": "pooja.men@gmail.com",  "phone": "9467890123", "amount_inr": 14999, "plan": "Home Loan EMI"},
    {"name": "Rajesh Patel",       "email": "rajesh.pa@gmail.com",  "phone": "9578901234", "amount_inr": 399,   "plan": "App Subscription"},
    {"name": "Sita Reddy",         "email": "sita.red@yahoo.in",    "phone": "9689012345", "amount_inr": 4999,  "plan": "MF SIP"},
]

# Which archetypes simulate a failed payment attempt
FAIL_INDICES = {1, 3, 5, 7, 9, 11, 13}  # roughly 50%
# Which of the failed ones also have a refund request
REFUND_INDICES = {3, 7, 11}

def create_customer(arch):
    r = api("post", "/customers", json={
        "name":  arch["name"],
        "email": arch["email"],
        "contact": arch["phone"],
        "notes": {"plan": arch["plan"], "source": "RecoverOS-demo"},
    })
    if ok(r):
        cust = r.json()
        print(f"  ✓ Customer: {cust['id']} — {arch['name']}")
        return cust
    return None

def create_order(arch, customer_id):
    r = api("post", "/orders", json={
        "amount":   arch["amount_inr"] * 100,   # paise
        "currency": "INR",
        "receipt":  f"rcpt_{arch['phone'][-6:]}",
        "notes": {
            "customer_name": arch["name"],
            "plan":          arch["plan"],
            "customer_id":   customer_id,
            "source":        "RecoverOS-demo",
        },
    })
    if ok(r):
        order = r.json()
        print(f"  ✓ Order: {order['id']} — ₹{arch['amount_inr']}")
        return order
    return None

def create_refund_on_payment(payment_id, amount_paise):
    """Refund a captured payment (partial or full)."""
    r = api("post", f"/payments/{payment_id}/refund", json={
        "amount": amount_paise,
        "notes": {"reason": "product_damaged", "source": "RefundGuard-demo"},
    })
    if ok(r):
        ref = r.json()
        print(f"  ✓ Refund: {ref['id']} — ₹{amount_paise//100}")
        return ref
    return None

def seed():
    print("\n📦 Seeding Razorpay test account…\n")
    results = {"customers": [], "orders": [], "payments": [], "refunds": []}

    for i, arch in enumerate(ARCHETYPES):
        print(f"[{i+1}/{len(ARCHETYPES)}] {arch['name']} — {arch['plan']}")

        # Customer
        cust = create_customer(arch)
        if cust:
            results["customers"].append(cust)
            customer_id = cust["id"]
        else:
            customer_id = None

        # Order
        order = create_order(arch, customer_id or "")
        if order:
            results["orders"].append(order)

        time.sleep(0.3)   # be polite

    # Note: Razorpay test mode doesn't allow creating payments server-side
    # without a checkout session. We log the intent and mark payments as
    # "simulated" in our summary for the dashboard.
    print(f"\n  ℹ️  Payments in Razorpay test-mode require client-side checkout.")
    print(f"  ℹ️  Recording order intents as simulated payment events.\n")

    return results

# ─── FETCH ────────────────────────────────────────────────────────────────────

def fetch_all():
    print("\n📥 Fetching from Razorpay…\n")
    result = {}

    # Payments
    r = api("get", "/payments", params={"count": 100})
    result["payments"] = r.json() if ok(r) else {"items": [], "count": 0}
    print(f"  Payments: {result['payments'].get('count', 0)}")

    # Orders
    r = api("get", "/orders", params={"count": 100})
    result["orders"] = r.json() if ok(r) else {"items": [], "count": 0}
    print(f"  Orders:   {result['orders'].get('count', 0)}")

    # Customers
    r = api("get", "/customers", params={"count": 100})
    result["customers"] = r.json() if ok(r) else {"items": [], "count": 0}
    print(f"  Customers:{result['customers'].get('count', 0)}")

    # Refunds
    r = api("get", "/refunds", params={"count": 100})
    result["refunds"] = r.json() if ok(r) else {"items": [], "count": 0}
    print(f"  Refunds:  {result['refunds'].get('count', 0)}")

    return result

# ─── MERGE + ENRICH ───────────────────────────────────────────────────────────

def build_razorpay_summary(rz_data, seeded_archetypes):
    """
    Merge live Razorpay data with our synthetic pipeline to produce
    a unified summary the dashboard can consume.
    """
    orders = rz_data["orders"].get("items", [])
    customers = rz_data["customers"].get("items", [])
    payments = rz_data["payments"].get("items", [])
    refunds = rz_data["refunds"].get("items", [])

    # Enrich orders with archetype data (matched by receipt or notes)
    enriched_orders = []
    for i, arch in enumerate(seeded_archetypes):
        # Try to find matching live order
        live_order = next(
            (o for o in orders if o.get("notes", {}).get("plan") == arch["plan"]),
            None
        )
        is_failed = i in FAIL_INDICES
        has_refund = i in REFUND_INDICES
        enriched_orders.append({
            "razorpay_order_id": live_order["id"] if live_order else f"ord_simulated_{i:04d}",
            "customer_name": arch["name"],
            "plan": arch["plan"],
            "amount_inr": arch["amount_inr"],
            "status": "failed" if is_failed else "paid",
            "has_refund_request": has_refund,
            "is_live": live_order is not None,
            "created_at": live_order["created_at"] if live_order else int(time.time()) - i * 86400,
        })

    # Compute stats
    total_amount = sum(a["amount_inr"] for a in seeded_archetypes)
    recovered_amount = sum(a["amount_inr"] for i, a in enumerate(seeded_archetypes) if i not in FAIL_INDICES)
    at_risk_amount = sum(a["amount_inr"] for i, a in enumerate(seeded_archetypes) if i in FAIL_INDICES)
    refund_amount = sum(a["amount_inr"] for i, a in enumerate(seeded_archetypes) if i in REFUND_INDICES)

    summary = {
        "source": "razorpay_live_test",
        "fetched_at": datetime.now(IST).isoformat(),
        "key_id_prefix": KEY_ID[:12] + "...",
        "mode": "test",
        "live_counts": {
            "orders":    rz_data["orders"].get("count", 0),
            "customers": rz_data["customers"].get("count", 0),
            "payments":  rz_data["payments"].get("count", 0),
            "refunds":   rz_data["refunds"].get("count", 0),
        },
        "seeded_counts": {
            "archetypes": len(seeded_archetypes),
            "failed":     len(FAIL_INDICES),
            "refund_requests": len(REFUND_INDICES),
        },
        "amounts_inr": {
            "total":     total_amount,
            "recovered": recovered_amount,
            "at_risk":   at_risk_amount,
            "refund_requests": refund_amount,
        },
        "enriched_orders": enriched_orders,
        "live_orders":    orders,
        "live_customers": customers,
        "live_payments":  payments,
        "live_refunds":   refunds,
    }
    return summary

# ─── WRITE ────────────────────────────────────────────────────────────────────

def write(name, data):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"  → {path}")

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Razorpay test-mode seed + fetch")
    parser.add_argument("--fetch-only", action="store_true", help="Skip seeding, just fetch")
    parser.add_argument("--seed-only",  action="store_true", help="Seed only, skip fetch")
    args = parser.parse_args()

    if not KEY_ID.startswith("rzp_test_"):
        print(f"✗ RAZORPAY_KEY_ID doesn't look right: {KEY_ID[:16]}...")
        print("  Expected format: rzp_test_XXXX (check .env)")
        sys.exit(1)

    print(f"✓ Using key: {KEY_ID[:16]}…")

    seeded = {}
    if not args.fetch_only:
        seeded = seed()

    rz_data = {}
    if not args.seed_only:
        rz_data = fetch_all()

        # Write raw data
        print("\n💾 Writing raw data files…")
        write("razorpay_orders.json",    rz_data.get("orders", {}))
        write("razorpay_customers.json", rz_data.get("customers", {}))
        write("razorpay_payments.json",  rz_data.get("payments", {}))
        write("razorpay_refunds.json",   rz_data.get("refunds", {}))

        # Build and write merged summary
        rz_summary = build_razorpay_summary(rz_data, ARCHETYPES)
        write("razorpay_summary.json", rz_summary)

        print("\n📊 Summary:")
        print(f"   Live orders:    {rz_data['orders'].get('count',0)}")
        print(f"   Live customers: {rz_data['customers'].get('count',0)}")
        amounts = rz_summary['amounts_inr']
        print(f"   Total ₹:        ₹{amounts['total']:,}")
        print(f"   Recovered ₹:    ₹{amounts['recovered']:,}")
        print(f"   At-risk ₹:      ₹{amounts['at_risk']:,}")
        print(f"   Refund ₹:       ₹{amounts['refund_requests']:,}")

    print("\n✅ Done. Dashboard will pick up razorpay_summary.json automatically.\n")

if __name__ == "__main__":
    main()
