# Recoverability Engine — 48-Hour Build Plan
**Track:** 03 — AI Revenue Recovery (Razorpay Buildathon)
**One-liner:** Before retrying a failed UPI Autopay mandate, decide whether it's actually recoverable — stop wasting retries on dead accounts, recover what's collectable, and show the ₹ proof.

---

## 0. Non-negotiable scope lock

Build **one workflow only**: failed recurring mandate → classify → route → execute bounded action → log. No refund engine, no image verification, no multi-agent orchestration in the 48-hour build. The refund-decision extension is specified in Section 9 as a **future roadmap**, not something you touch before the core is done, tested, and demo-rehearsed.

If at hour 40 the core is fully working and polished, and only then, you may attempt the Section 9 stub — never before.

---

## 1. Grounding facts (cite these in the pitch, verbatim numbers)

- **20 million UPI AutoPay mandates are revoked every month** because the customer's account balance is insufficient at the moment of execution (Business Standard, reporting from payments-industry sources, Sep 2025). This is your "why now" stat — memorize it exactly.
- **UPI mandate registrations are growing fast**: NPCI data showed 4.03 million new mandate registrations in a single month (Oct), up 28.34% month-over-month — the problem surface is expanding, not shrinking.
- UPI Autopay mandates up to ₹15,000/cycle don't need per-transaction UPI PIN re-auth; above that, they do. This matters for your REAUTHORIZE branch logic (Section 3).
- India's payment aggregator model (Razorpay, Cashfree, Juspay, PayU) sits between merchant and NPCI-member banks — you are building the layer these PAs would sit above/beside, consistent with Razorpay's own test-mode subscription/recurring-payment APIs.

## 2. Real NPCI / UPI failure codes — use these exact codes, not invented ones

This is the single most important grounding decision in the whole project: your synthetic data and classifier must be keyed to **real NPCI response codes**, because a Razorpay-affiliated judge will recognize fake ones instantly.

| Code | Official meaning | Source layer |
|---|---|---|
| `Z9` | Insufficient funds in customer's bank account | UPI response code |
| `U69` | Collect request expired / payer or payee PSP temporarily unavailable (server-side timeout) | UPI response code |
| `U28` | Customer's bank (remitter bank) is down | UPI response code |
| `Z7` | Too many transactions within an interval set by customer's bank (velocity limit) | UPI response code |
| `Z8` | Per-transaction limit exceeded, as set by customer's bank | UPI response code |
| `U30` | Debit has failed (generic debit failure) | UPI response code |
| `01` | Account closed | eNACH/mandate presentation return code |
| `02` | No such account | eNACH/mandate presentation return code |
| `04` | Balance insufficient (mandate-presentation-level, distinct from Z9 at transaction level) | eNACH/mandate presentation return code |
| `06` | Payment stopped by drawer (customer manually paused/revoked) | eNACH/mandate presentation return code |
| `07` | Payment stopped under court order / account under litigation | eNACH/mandate presentation return code |
| `MANDATE_EXPIRED` | Mandate validity period lapsed (merchant must request re-authorization) | Mandate lifecycle state, not a transaction code — model separately |
| `MANDATE_PAUSED` | Customer paused mandate via their UPI app (not revoked, reversible) | Mandate lifecycle state |

Do not invent additional codes. If your synthetic generator needs more variety, resample from this fixed set with different weightings — do not fabricate new NPCI-style codes, as this is checkable by a knowledgeable judge and would be an instant credibility loss.

## 3. Classification taxonomy — fully deterministic, zero LLM judgment calls at runtime

The core intellectual property of this project is that classification is **rule-based on structured signals**, not a vague LLM prompt asking "should we retry this?" An LLM may be used only to generate a human-readable explanation of a decision already made by the rules — never to make the decision itself. This is a deliberate architecture choice: deterministic rules are auditable, reproducible, and defensible to a judge asking "how do you know this is correct"; an LLM-only classifier is not.

### 3.1 Input signal schema (per failed event)

Every failure event carries these fields, all of which must be present in your synthetic data generator's output:

```
{
  "event_id": "evt_00001",
  "customer_id": "cust_0042",
  "mandate_id": "mandate_0042_ott",
  "merchant_id": "merch_demo",
  "amount_inr": 499,
  "failure_code": "Z9",
  "failure_timestamp": "2026-09-01T08:12:00+05:30",
  "mandate_status": "ACTIVE",          // ACTIVE | PAUSED | REVOKED | EXPIRED
  "mandate_created_at": "2025-11-15T10:00:00+05:30",
  "mandate_expiry_at": "2026-11-15T10:00:00+05:30",
  "cycle_frequency": "MONTHLY",         // MONTHLY | WEEKLY | QUARTERLY
  "customer_payment_history": {
    "total_cycles_billed": 10,
    "total_cycles_succeeded": 8,
    "total_cycles_failed": 2,
    "consecutive_failures": 1,
    "last_success_at": "2026-08-01T08:12:00+05:30",
    "historical_success_days_of_month": [1, 2, 3, 4, 5, 28, 29, 30],
       // days of month on which this customer's past debits succeeded — used to time retries
    "prior_retry_attempts_this_cycle": 0,
    "days_since_last_retry": null
  },
  "customer_risk_signals": {
    "refund_count_last_90d": 0,
    "chargeback_count_last_90d": 0,
    "distinct_failure_codes_last_90d": ["Z9"]
  }
}
```

Every one of these fields must actually be populated by your synthetic generator (Section 5) — nothing here is decorative. `historical_success_days_of_month` is what drives the WAIT/retry-timing decision, and it must be derived from a genuinely generated payment history per customer, not hardcoded.

### 3.2 Branch logic — exact deterministic rules

Evaluate branches **in this fixed priority order**; the first matching branch wins. This ordering itself is a designed decision, not arbitrary — infrastructure failures must be checked before customer-fault failures, because retrying during a bank outage wastes an attempt regardless of the customer's ability to pay.

**Branch 1 — WAIT (infrastructure/transient failure)**
- Condition: `failure_code IN {"U69", "U28"}`
- Rationale: these codes indicate the failure is on the bank/PSP side, not the customer's account state. Retrying immediately against a down system is guaranteed to fail again.
- Action: schedule automatic retry after a fixed cooldown (`U69` → retry in 30 minutes; `U28` → retry in 4 hours, since bank-down incidents are typically resolved same-day). No customer contact.
- Stopping rule: max 3 auto-retries under this branch; if still failing after 3, re-evaluate through the full branch order again (do not loop indefinitely).

**Branch 2 — STOP (customer cannot currently pay / structurally dead)**
- Condition: `failure_code IN {"01", "02", "07"}` OR (`failure_code == "Z9"` AND `customer_payment_history.consecutive_failures >= 3`)
- Rationale: account closed, non-existent, or under litigation are not recoverable by any retry logic — these require merchant-side account closure, not automation. Three consecutive insufficient-funds failures on the same mandate indicates a structural affordability problem, not a timing problem; continuing to retry here is pure waste and, per Track 02's fraud-adjacent lens, is also poor practice (repeated failed debit attempts can itself trigger bank-side risk flags on the customer).
- Action: **no retry scheduled**. Flag for merchant dashboard review; optionally trigger a single low-pressure human-reachable message (not repeated auto-retries) offering a lower-tier plan or pause option.
- This is the branch that makes your demo's "not every failure deserves a retry" thesis concrete and countable — log every event that lands here as an explicit "retries avoided."

**Branch 3 — REAUTHORIZE (mandate-level problem, not payment-level)**
- Condition: `mandate_status IN {"PAUSED", "REVOKED", "EXPIRED"}` OR `failure_code == "06"`
- Rationale: the debit itself may be perfectly payable, but there is no valid standing authorization to execute it against. No amount of retrying a payment will succeed without a new/reactivated mandate.
- Action: generate a one-tap re-mandate link (simulate via Razorpay test-mode subscription "create mandate" flow) and send via the Hinglish nudge template (Section 4). Do not retry the payment itself until reauthorization is confirmed.
- Stopping rule: send at most 2 reauthorization nudges, spaced 3 days apart; if unresolved after that, downgrade to STOP and flag for merchant review.

**Branch 4 — ESCALATE (risk-flagged, do not auto-retry)**
- Condition: `customer_risk_signals.distinct_failure_codes_last_90d` has length ≥ 3 (i.e., the same mandate has failed for 3+ *different* reasons in 90 days — an unstable pattern, not a single consistent cause) OR `customer_risk_signals.chargeback_count_last_90d > 0`
- Rationale: erratic, multi-cause failure patterns combined with any chargeback history are the profile most associated with account compromise, first-party fraud, or synthetic identity behavior — this branch exists specifically to satisfy Track 02's "strictly defense-only" framing: you are not making an offensive fraud call, you are declining to auto-retry and routing to human review, which is the safe, bounded, explainable action.
- Action: **no automated retry, no automated customer contact.** Log to a merchant-facing exceptions queue with the full signal trail. This is the one branch where the system explicitly refuses to act autonomously — call this out in the demo as a designed safety boundary, not a gap.

**Branch 5 — RECOVER (default: payable, timing is the only issue)**
- Condition: everything not caught by Branches 1–4. In practice this is overwhelmingly `failure_code == "Z9"` with `consecutive_failures < 3` and no risk flags — a customer who has succeeded before and is most likely just short of funds on this specific date.
- Action: **do not retry immediately.** Compute the customer's most probable next-success date from `historical_success_days_of_month` (e.g., if this customer has historically succeeded on days 1–5 and 28–30, and today is day 12, schedule retry for day 28, not day 13). This is your single highest-value, most demoable piece of logic — it directly operationalizes the "insufficient balance" root cause identified in the 20M/month statistic, by aligning retry timing to observed salary-credit-like patterns instead of blind immediate re-attempts.
- If no historical pattern exists (new mandate, first failure), default to day 5 and day 28 of the month as the retry attempt dates (aligned to common Indian salary-credit cycles: 1st–7th and 28th–30th).
- Stopping rule: max 2 scheduled retries per cycle under this branch. If both fail, re-run the full classification (a customer landing back on Branch 2/STOP after 3 consecutive failures is the intended outcome of this loop, not a bug).

### 3.3 What the LLM is and is not allowed to do

The LLM's only job: given the branch that the deterministic rules already selected, plus the input signal JSON, generate a one-paragraph, judge-readable explanation string for the audit log (e.g., "Classified as RECOVER: customer has 8/10 successful cycles historically clustering on days 1–5, current failure is Z9 on day 12 — scheduling retry for day 28 rather than immediate re-attempt.") This keeps the LLM as an explainability layer on top of a fully deterministic, testable, judge-inspectable decision system — which is both more defensible and dramatically less build-risk than trying to get an LLM to reliably make the classification call itself under time pressure.

## 4. Recovery action templates (Hinglish nudge — REAUTHORIZE and STOP branches only)

Only REAUTHORIZE and the optional STOP low-pressure message involve customer contact; WAIT, RECOVER, and ESCALATE are silent/backend-only by design (this is itself a talking point: most of your recovered volume requires zero customer friction).

**REAUTHORIZE template (WhatsApp/SMS style, Hinglish):**
> "Namaste [Name], aapka [Merchant] mandate expire/pause ho gaya hai. Payment ₹[Amount] ke liye naya mandate set karein — sirf ek tap: [link]. Koi extra charge nahi hai."

**STOP low-pressure template (sent once only, never repeated):**
> "Namaste [Name], hume notice hua ki aapka recent payment successful nahi hua. Koi dikkat ho toh humein batayein — hum aapke liye plan adjust kar sakte hain: [link]. Koi pressure nahi, jab ready ho tab batayein."

Simulate delivery only (log a "message_sent" event); do not build actual WhatsApp/SMS integration — that is out of scope for 48 hours and adds zero judging credit over a logged simulation.

## 5. Synthetic data generation — this is your highest-priority, highest-risk task

### 5.1 Why this matters more than any other component

Every metric you present (precision/recall, ₹ recovered, retries avoided) is only as credible as the data it's computed on. A Razorpay-affiliated judge will probe this first. Budget **6–8 of your 48 hours** specifically here — more than you'll instinctively want to.

### 5.2 Batch composition (target: 300 synthetic customers, ~600–800 failure events total)

Generate customers across these archetypes, in these approximate proportions (grounded in the real-world proportions implied by the 20M/month insufficient-funds stat dominating the failure landscape):

| Archetype | % of customers | Behavior pattern |
|---|---|---|
| Timing-mismatch payer | 45% | Succeeds reliably but only in a specific 5–7 day window per month (simulate salary-credit clustering); fails with `Z9` outside that window |
| Genuinely struggling | 15% | 3+ consecutive `Z9` failures, declining payment history over time — should resolve to STOP |
| Bank-side instability | 10% | Random `U69`/`U28` events uncorrelated with the customer's own balance — should resolve to WAIT |
| Mandate lifecycle issue | 12% | Mix of `MANDATE_PAUSED`, `MANDATE_EXPIRED`, code `06` — should resolve to REAUTHORIZE |
| Structurally invalid | 8% | Codes `01`, `02`, `07` — should resolve to STOP immediately, no history needed |
| Erratic/risk pattern | 10% | Multiple distinct failure codes across 90 days, some with chargeback history — should resolve to ESCALATE |

### 5.3 Ground-truth labeling (critical for your precision/recall claim)

Because you are generating the data, you know the "true" archetype of each synthetic customer at generation time. Store this as a hidden `ground_truth_branch` field, separate from the fields your classifier sees. **Never let the classifier read `ground_truth_branch`.** After running your rule engine over the batch, compare its output branch to `ground_truth_branch` to compute a confusion matrix and per-branch precision/recall. This is what lets you say "94% precision on STOP-branch classification" with a straight face to a judge — it is a real evaluation against labels you controlled, which is honest and exactly what Track 04/03's "honest metrics" bar wants, without needing a second competing system as a baseline.

### 5.4 Generation method (concrete, no ambiguity)

1. Write a Python script (`generate_synthetic_batch.py`) using `numpy`/`pandas` and Python's `random` with a **fixed seed** (e.g., `42`) so the batch is reproducible if a judge asks you to regenerate it live.
2. For each customer: assign an archetype per the proportions in 5.2, generate a `mandate_created_at` date 3–14 months in the past, generate a monthly billing history (one event per cycle since mandate creation) with success/failure determined by the archetype's rules, and generate the final "current" failure event that will actually be fed to the classifier.
3. Output two files: `synthetic_batch.json` (the full input the classifier sees — matches the schema in 3.1) and `ground_truth.json` (event_id → true archetype/branch, kept separate).
4. Sanity-check by hand: read 15–20 generated events yourself before running anything else. If they don't look plausible to *you*, they won't to a judge.

### 5.5 Should you train an ML model, or is rules-only defensible?

Given 48 hours, **do not train a classifier model to replace the rule engine** — the rule engine is deterministic, auditable, and directly explainable, all things judges reward under this specific rubric ("every money action explainable, bounded and gated"). Introducing an ML classifier here would trade auditability for a a marginal accuracy gain you don't need, since your rules are already grounded in real failure-code semantics.

There is exactly **one place ML/statistics adds real, demonstrable value without threatening your timeline**: the **next-success-date prediction** inside the RECOVER branch (Section 3.2, Branch 5). Instead of a hardcoded "day 5 and day 28" default, fit a simple model per customer:

- **Method:** For customers with ≥4 historical billing cycles, fit a lightweight frequency/probability model over `historical_success_days_of_month` — e.g., a kernel density estimate or even a simple weighted-frequency histogram (bin by day-of-month, weight recent cycles higher) using `scipy.stats.gaussian_kde` or plain `numpy` histogram — then pick the day with highest estimated success probability as the retry date.
- **Why this is "ML" without being risky:** it's a few hours of well-scoped `numpy`/`scipy` work on data you already have, it's easy to visualize (a probability-by-day-of-month chart makes a great demo slide), and it directly strengthens your single strongest differentiator (intelligent retry timing) rather than adding a new subsystem.
- **Do not attempt:** any deep learning, any model requiring GPU training, any external ML API calls for this — all unnecessary risk for a distribution-fitting problem this simple.

### 5.6 Future roadmap — replacing the rule engine with a trained classifier (explicitly NOT built in the 48-hour window)

Present this only as a forward-looking architecture slide if asked "what would you do with more time," never as working code in the hackathon build. The rule engine in Section 3.2 remains the actual v1 system; this section describes the v2 evolution path, and the reasoning for why it's deliberately deferred.

**Why defer it:** the rule engine is deterministic, fully auditable, and directly traceable to real NPCI failure-code semantics — exactly what Track 03's "explainable, bounded, gated" bar rewards, and exactly what a 48-hour window has time to validate against ground truth (Section 5.3). A trained classifier introduces a second source of error (model miscalibration) on top of label-quality risk, with no offsetting benefit at this data scale — 300 synthetic customers is not enough to meaningfully outperform well-grounded rules, and using a tiny synthetic set to train a model you'd then evaluate on the same synthetic distribution proves nothing to a judge. This is a real engineering judgment, not a shortcut: rules-first, model-later is the correct order for this problem.

**What the v2 model would actually be, once real production data exists:**

- **Task framing:** not a replacement for the 5-branch taxonomy itself (that taxonomy is a business policy decision, not something to learn), but a **confidence/calibration layer on top of it** — specifically, a model that predicts *probability of successful recovery* for events routed to the RECOVER branch, so that retry scheduling becomes a ranked, probability-weighted decision instead of a single fixed candidate date.
- **Model type:** gradient-boosted trees (e.g., `XGBoost` or `LightGBM`) over structured tabular features — not deep learning. This class of model is the industry-standard choice for payment-recovery/collections scoring because it handles the mixed categorical/numeric feature types here well (failure code, day-of-month, cycle frequency, historical success ratios) and remains inspectable via feature importance, which matters for the same explainability requirement that justified rules-first in v1.
- **Features (all derivable from the schema already defined in Section 3.1 — no new data collection required to start):** failure code (one-hot), day-of-month of failure, mandate age in days, cycle frequency, `total_cycles_succeeded / total_cycles_billed` ratio, `consecutive_failures`, days since `last_success_at`, count of distinct historical success days-of-month (spread of the customer's success window), amount as a fraction of the customer's historical average successful amount, and count of distinct failure codes in the last 90 days.
- **Label:** binary — did a subsequent retry within the observed window actually succeed — collected from real production outcomes over a period (realistically 3–6 months of live merchant data), not synthetic data. This is the actual blocker to building this now: the label doesn't exist until the v1 rule-based system has been running in production long enough to generate outcomes to learn from. This is a deliberate, disclosable reason to defer, not an oversight.
- **Evaluation:** hold out the most recent month of production data as a test set (time-based split, never random split, since retry-timing behavior is seasonal — e.g., salary-cycle clustering around month-end/month-start); report AUC-ROC and, more importantly for this use case, calibration (predicted probability vs. observed success rate in deciles), since the model's output is meant to rank/weight retry timing, not just classify.
- **Where it plugs in without disrupting the audited architecture:** the rule engine still owns branch assignment (WAIT/STOP/REAUTHORIZE/ESCALATE/RECOVER) exactly as in v1; the trained model only refines the *scheduling* decision inside the already-audited RECOVER branch, and every model-driven date choice still gets logged with its predicted probability in the audit trail — preserving the same explainability guarantee, just with a statistically sharper number behind it.

### 5.7 Privacy grounding — how the synthetic data must mirror real-world handling, not invented conventions

This section exists because "synthetic data" is not an automatic privacy pass — if it's structured carelessly, both your demo and your write-up will misrepresent how Indian payment data is actually required to be handled, which a Razorpay-affiliated judge will notice immediately. Ground every identifier and field format decision in the actual rules below, not convenience.

**Legal grounding (state this explicitly in your submission, it costs one sentence and buys real credibility):**
- India's **Digital Personal Data Protection Act, 2023 (DPDP Act)**, with the **DPDP Rules, 2025** notified 13 November 2025, is the operative law. Its rules explicitly list **encryption, obfuscation, masking, or the use of virtual tokens mapped to personal data** as required "reasonable security measures" for any data fiduciary. Your schema should mirror this by construction, not as an afterthought.
- **Fully synthetic, generated-from-scratch data (never real customer records, never "anonymized" real records) is the only defensible approach for a hackathon build.** Anonymized-but-real data still carries re-identification risk and ambiguous status under DPDPA; fabricated-from-distributions data carries none. Say this explicitly in your pitch: "every customer, mandate, and transaction in this demo is synthetically generated — no real personal data was used at any point," because it pre-empts the one privacy question a judge is likely to ask.
- Payment aggregators/banks handling this kind of data in production are frequently in scope as **Significant Data Fiduciaries** under DPDPA given transaction volume, meaning additional DPO/DPIA/audit obligations apply to them — you don't need to implement any of this for a demo, but naming it shows you understand the compliance surface a real version of this product would sit inside, alongside RBI's Payment Aggregator/Payment Gateway guidelines, which overlap with but are distinct from DPDPA.
- Card/bank account numbers, if you ever reference them (you shouldn't need to — UPI mandates don't require storing card PANs), fall under **PCI DSS**, a separate and stricter standard from DPDPA; the cleanest choice for this project is to never generate or store anything resembling a card number or full bank account number at all, since UPI Autopay/eNACH mandate flows don't require your system to hold this even in production.

**Concrete field-format decisions (apply these exactly, they replace anything hypothetical in Section 3.1's schema):**

| Field | Real-world convention to mirror | Why |
|---|---|---|
| `customer_id` | Opaque token, e.g. `cust_0042` — never a real or realistic-looking name, phone number, or email | This is exactly the "virtual token mapped to personal data" pattern DPDP Rules 2025 names directly; real PSPs never expose raw PII in transaction-processing pipelines, only in a separately access-controlled identity layer you are not building |
| Customer display name (only needed for the Hinglish nudge templates in Section 4, nowhere else) | Generate using a synthetic-data library (`Faker` with the `en_IN` locale) at render time only, never stored alongside transaction/failure records | Keeps PII-shaped data confined to the one UI surface that needs it for demo realism, mirroring real systems' separation between a "notifications" service (needs a name) and a "payments/risk" service (should not need one) |
| `mandate_id`, `event_id` | Opaque tokens, not sequential real-looking UPI transaction reference numbers | Real UPI transaction IDs (RRNs) are 12-digit NPCI-issued values with their own format; do not fabricate realistic-looking real ones, since that blurs the line between "obviously synthetic" and "could be mistaken for real" — always prefer obviously-synthetic formats |
| VPA (UPI ID), if referenced at all in the nudge template mockups | Masked display format only, matching how UPI apps actually show it to reduce exposure — e.g. `ra**@okhdfcbank`, first two characters plus provider handle, rest masked | This is the actual masking convention Indian UPI apps use for on-screen display; reproducing it (rather than a full fake VPA) is both more realistic and inherently privacy-preserving in your demo screenshots |
| Phone number, if shown in a nudge template mockup | Masked format only — `+91-9XXXXX42XX` style, matching real bank/PSP SMS conventions | Same reasoning — full realistic 10-digit numbers in a public demo/repo are unnecessary and avoidable |
| `amount_inr` | Drawn from real Indian subscription/recurring-payment price bands, not arbitrary round numbers | See table below — this is a factual-relevance fix, not a privacy fix, but belongs in the same "nothing hypothetical" pass |

**Realistic amount bands to sample from (use these ranges, not invented figures):**

| Mandate category | Typical ₹ range (monthly) | Notes |
|---|---|---|
| OTT/streaming subscription | ₹149–₹649 | Common published tiers across major Indian streaming platforms |
| SIP / micro-investment mandate | ₹500–₹5,000 | Explicitly called out in the sourced Business Standard reporting as a major category of UPI Autopay insufficient-funds revocations |
| Loan EMI (small-ticket digital lending) | ₹1,000–₹15,000 | Stays within the ₹15,000 UPI Autopay no-PIN ceiling — use this to justify why some of your synthetic mandates should sit just under vs. over that threshold, since amounts above it require PIN re-entry each cycle, which is a real behavioral driver of failure you can model |
| Insurance premium (monthly mode) | ₹500–₹3,000 | Long mandate durations (12+ months), relevant to your `mandate_created_at`/`mandate_expiry_at` realism |
| Utility/subscription-box | ₹99–₹999 | Lower-value, higher-frequency-of-failure-tolerance category |

Assign each synthetic customer a category (weighted, SIP/loan-EMI slightly overrepresented since they're the specific categories named in your sourced revocation-cause reporting) and sample amounts from the corresponding band — this replaces any arbitrary amount generation with numbers a judge could plausibly believe came from a real merchant portfolio.

**One sentence for your submission's README that ties this together:**
> "All data in this project is synthetically generated end-to-end; no real personal data was used. Identifier formats, masking conventions, and security-measure choices (tokenized IDs, masked VPA/phone display) follow the DPDP Rules, 2025 requirement that personal data be protected via encryption, obfuscation, masking, or virtual tokens."

## 6. Architecture (what to actually build, concretely)

```
synthetic_batch.json ──▶ Ingestion script ──▶ Rule Engine (Section 3.2, pure Python)
                                                     │
                                                     ├──▶ Branch decision + confidence signals
                                                     │
                                          ┌──────────┴───────────┐
                                          ▼                       ▼
                              LLM explanation call        Action simulator
                              (1 short prompt per event)  (schedule retry / log nudge /
                                          │                 flag exception / no-op)
                                          ▼                       │
                                   Audit log writer  ◀────────────┘
                                          │
                                          ▼
                              audit_log.jsonl (append-only)
                                          │
                                          ▼
                          Dashboard (single-page web app):
                          - batch summary metrics
                          - per-branch confusion matrix vs ground truth
                          - ₹ amount breakdown by branch
                          - retries-avoided counter
                          - searchable/filterable audit trail table
                          - one sample RECOVER event with day-of-month
                            probability chart
```

**Stack recommendation (optimized for 48-hour execution speed, not resume-building):**
- Rule engine + synthetic data generator: Python (`pandas`, `numpy`, `scipy`)
- LLM explanation calls: Anthropic API (Claude), one short call per event, batched/cached — do not call it per-UI-render, call it once during batch processing and store the explanation string in the audit log
- Dashboard: a single React app (or plain HTML+Chart.js if React setup burns too much time) reading the static `audit_log.jsonl`/`summary.json` output — no live backend needed, this is a batch-processed demo, not a live service, and pretending otherwise adds risk for zero judging benefit
- Razorpay integration: use Razorpay's **test-mode Subscriptions/Recurring Payments API** to actually create a handful (5–10) of real test-mode subscriptions and pull real test-mode webhook payloads for *some* of your events, blended with the synthetic batch for the bulk volume — this lets you honestly say "integrates with Razorpay test-mode APIs" (satisfying the track's explicit ask) while not depending on Razorpay's test environment for your full 600-800 event statistical claims

## 7. Metrics to actually put on the final dashboard slide

State these exactly, computed from your own batch, no invented numbers:

1. **Branch-level precision/recall vs. ground truth** (per Section 5.3) — this is your primary honesty proof.
2. **Retries avoided** — count of events routed to STOP or ESCALATE, each representing a retry a naive "always retry" system would have wasted; multiply by an assumed cost-per-attempt (state your assumption explicitly, e.g., "₹2 per gateway retry attempt, per typical PA pricing" — cite this as an assumption, not a fact, if you don't have a sourced number) to get a "wasted-effort ₹ avoided" figure.
3. **₹ amount successfully routed to RECOVER with optimized timing** vs. what immediate-retry-only would have captured (you can compute this without a second live system: for RECOVER-branch events, check whether `historical_success_days_of_month` indicates the *original* failure date was already outside the customer's success window — if so, an immediate retry on the same day would very likely have failed again; count these as "recovered only because of timing intelligence").
4. **Total ₹ across the batch by final branch outcome** — a simple bar chart, RECOVER/WAIT/REAUTHORIZE/STOP/ESCALATE amounts.

Do not claim a live "recovered revenue" number implying real money moved — you are in test-mode with synthetic data. Be explicit about this in the pitch: "on a synthetic batch modeling real NPCI failure-code distributions."

## 8. Hour-by-hour 48-hour timeline

| Hours | Task | Deliverable checkpoint |
|---|---|---|
| 0–2 | Lock schema (Section 3.1), lock branch rules (Section 3.2) exactly as written above — no further debate once coding starts | Schema + rules doc frozen |
| 2–8 | Build `generate_synthetic_batch.py` per Section 5.4–5.5; hand-review 20 sample events | `synthetic_batch.json` + `ground_truth.json` exist and look plausible |
| 8–10 | Build the day-of-month probability model (Section 5.5) as a standalone tested function | Function returns correct next-retry-date for 3 hand-checked test customers |
| 10–16 | Build the rule engine (Section 3.2) as pure functions, one per branch, with unit tests against 10 hand-crafted edge cases (one per branch minimum) | All 10 hand-crafted cases classify correctly |
| 16–20 | Run rule engine over full synthetic batch; compute confusion matrix vs ground truth; iterate on any rule that's clearly misclassifying an archetype | Confusion matrix looks sane (>85% diagonal per branch) |
| 20–24 | Wire in Razorpay test-mode API: create 5–10 real test subscriptions, capture real webhook payloads, map into your schema | At least 5 real Razorpay test-mode events flowing through the same pipeline |
| 24–28 | Sleep block (do not skip — 48-hour builds fail more often from exhausted decision-making at hour 40 than from lack of hours) | — |
| 28–32 | LLM explanation-string integration (batched call over the processed batch), audit log writer | `audit_log.jsonl` fully populated with human-readable explanations |
| 32–40 | Dashboard build: summary metrics, confusion matrix view, ₹ breakdown chart, filterable audit trail, one RECOVER event probability chart | Dashboard loads and displays real computed numbers, not placeholders |
| 40–44 | Full run-through rehearsal of the demo script (Section 10); fix anything broken; polish visuals only if time remains | Demo runs start-to-finish without manual intervention |
| 44–46 | **Only if fully done:** attempt the Section 9 refund-decision stub as a bonus slide, no live code required | Optional — skip without guilt if not comfortably ahead of schedule |
| 46–48 | Buffer for the inevitable last-minute bug; write/rehearse the exact pitch sentences (Section 10) | Sleep before presenting if at all possible |

## 9. Future roadmap — Refund Decision Engine (explicitly NOT built in the 48-hour window)

Present this only as a forward-looking architecture slide, never as working code, unless Section 8's hour-40 checkpoint is comfortably cleared early.

### 9.1 Why it generalizes from the same engine

The mandate engine already answers: "given structured signals about a money event, which of a small set of bounded actions should fire?" A refund request is structurally the same kind of event — it has a customer, an amount, a history — and can be run through an analogous branch structure:

| Branch | Condition (structured signals only, no image/CV) | Action |
|---|---|---|
| APPROVE | Customer has ≥1 prior successful cycle, `refund_count_last_90d == 0`, refund requested within a merchant-defined return window | Auto-approve, no human step |
| VERIFY | `refund_count_last_90d` between 1–3, OR refund amount > some merchant-defined threshold | Route to human/merchant review queue with full history attached |
| ESCALATE | `refund_count_last_90d >= 4` OR `chargeback_count_last_90d > 0` combined with a new refund request | Do not auto-approve; flag for fraud-review team, same as the mandate ESCALATE branch philosophy |

### 9.2 Explicit scope boundary for v1 of this extension

No image/evidence authenticity verification in the first version of this extension — that requires a separate, much larger computer-vision workstream (product-photo matching, tamper detection) that was correctly deprioritized for the hackathon and should remain deprioritized until the structured-signal version is proven. Ship structured-signal refund routing first; evidence-image verification is a distinct v2 project, not a checkbox to add casually.

### 9.3 Shared infrastructure this reuses

The audit log schema, the LLM-explanation-layer pattern, and the dashboard's filterable-table component are all directly reusable — this is the honest version of "shared intelligence" from earlier planning: not a shared ML model, but a shared *decision-and-audit architecture* that a second event type plugs into.

## 10. Demo script (say these sentences, in this order, rehearsed verbatim)

1. "20 million UPI Autopay mandates fail every month from insufficient balance alone — and almost every merchant's response to a failure is the same: retry immediately, retry blindly."
2. "Our thesis is the opposite: not every failure deserves a retry. Before we retry anything, we classify why it failed, using the real NPCI response codes banks actually return."
3. [Show the 5-branch diagram] "Five outcomes: WAIT if it's the bank's fault, STOP if the customer structurally can't pay, REAUTHORIZE if the mandate itself is the problem, ESCALATE if the pattern looks unstable or risky — and only then, RECOVER."
4. [Show the RECOVER branch probability chart for one sample customer] "For the customers who can pay, we don't retry blindly either — we learn when they've historically succeeded, and time the retry to that window instead of the day it happened to fail."
5. [Show confusion matrix] "We validated this against a synthetic batch of 300 customers modeling real NPCI failure-code distributions — here's our precision and recall per branch, against ground truth we controlled."
6. [Show ₹ breakdown + retries-avoided counter] "This is what that looks like in rupees — and this is how many wasted retry attempts we avoided by knowing when to say stop."
7. [Show audit log row] "Every decision is logged with a plain-language reason, so a merchant — or a regulator — can see exactly why we did what we did."
8. [Close, one slide, no live demo] "The same decision architecture — classify, route, explain, log — applies to the other side of revenue leakage: refunds. That's the next event type this plugs into, not a second system."

Keep total spoken demo under 4 minutes; leave time for Q&A, where judges will most likely probe the synthetic data methodology (Section 5) and the branch-priority ordering (Section 3.2) — know both cold.
