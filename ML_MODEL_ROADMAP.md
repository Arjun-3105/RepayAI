# RecoverOS: ML Model Roadmap

**Moving from hardcoded rules and synthetic scores to measured, model-driven decisions**

Scope: both products in this repo.
- **Recoverability Engine** (failed UPI AutoPay / eNACH mandates): `engine/rule_engine.py`, `engine/day_of_month_model.py`, `engine/action_simulator.py`, `engine/llm_explainer.py`
- **RefundGuard** (refund evidence verification): `engine/generate_refund_batch.py`, dashboard `RefundGuardExplorer.jsx` / `LiveSimulatorModal.jsx`

The document has five parts:

- **Part 0**: What the current numbers do and don't prove (read this first).
- **Part 1**: Track A, the full production stack. Every model to build, where its data comes from, how to train it, and how to measure it.
- **Part 2**: Track B, the lean alternative. Use open-source pretrained models, fine-tune only where it pays off, and train from scratch almost never.
- **Part 3**: Evaluation and proof framework, so every accuracy number is defensible.
- **Part 4**: MLOps, infrastructure, compliance, phased timeline and cost.

---

## Part 0: Honest audit of the current system

Fix these before adding any model. A model trained or evaluated on the current data would inherit the same problems.

### 0.1 The accuracy numbers are circular

| Claim in repo | Where it comes from | Why it isn't evidence |
|---|---|---|
| Mandate engine **98.3% accuracy** (`summary.json`) | `generate_synthetic_batch.py` builds each archetype to trigger a specific rule (e.g. `genuinely_struggling` forces `consecutive_failures = max(..., 3)` and `failure_code = "Z9"`). The rule engine then checks exactly those fields. | The labels are the rules written a second way. The only errors (5 ESCALATE → WAIT/STOP) come from priority ordering, not from real ambiguity. What it actually measures is "the rule engine agrees with the generator". |
| RefundGuard **96.3% test accuracy** (`refund_summary.json`) | `make_scores()` draws `evidence_scores` as `randint` inside bands chosen per archetype. The decision is then a weighted average against thresholds 85/50. | No image, text or model is involved. The scores are sampled from the answer. |
| RefundGuard **precision 0.89 / recall 0.86 vs baseline 0.61 / 0.54** | Hardcoded constants in `generate_refund_batch.py` (`eval_vs_baseline`). | They were never computed. They are the example numbers from the design doc (§20). Remove them from the dashboard immediately. |
| "Pashash/hash matching", "image hash clean", "digitally manipulated" | `RefundGuardExplorer.jsx` and `LiveSimulatorModal.jsx`: static strings, plus `confidence: 96/42/15/38` per dropdown choice | No hashing or image analysis exists in the code. |
| RECOVER "timing improved %" | `evaluator.analyze_recover_timing`: counts failures whose day is not in `historical_success_days` | The generator places the failure outside the window by construction, so this metric is always ~100%. |
| "₹ saved" | `RETRY_COST_PER_ATTEMPT_INR = 2.0`, which is an assumption | It's fine as long as it's labeled as an assumption, and the dashboard should say so. |

### 0.2 Bugs and data defects found while reading

1. **`ingest_razorpay_events.py:81`**: `clf.get("rationale", "")`. The rule engine returns `rule_rationale`, so every live Razorpay event sends an **empty rationale** to the LLM.
2. **Hardcoded Razorpay secret**: `razorpay_mandate_orders.py:20` has a real-looking test key secret as the `os.getenv` default, and it is committed to git. Rotate it in the Razorpay dashboard and remove the default. It is still in git history.
3. **Refund dates are inconsistent**: in `generate_refund_batch.py:722`, `order_date` is re-sampled independently of the `order_date` used to compute `refund_requested_at`. In 1,010 of 3,500 training rows the **refund is requested before the order was placed**.
4. **KDE throws away frequency**: `historical_success_days_of_month` is built as `sorted(set(...))`, so a day that succeeded 10 times weighs the same as a day that succeeded once. The KDE then runs over unique days. The model should receive the full list, weighted by recency.
5. **Time is frozen**: `_today_ist()` and `ist_now()` return `2026-09-01`, and the action simulator also hardcodes it. This is fine for a demo but must be injected in production.
6. **Mandate expiry isn't evaluated**: `mandate_expiry_at` is generated, but no branch checks whether it has passed. (For example, `evt_cust_0001_014` has expiry 2026-07-08 but is classified RECOVER on 2026-08-14.)
7. **The LLM explanation is never checked** against the decision. A hallucinated number or reason would go straight into an "audit" log.
8. The `ESCALATE` rule (`≥3 distinct codes OR any chargeback`) and `STOP` (`≥3 consecutive Z9`) use thresholds with no data behind them.

### 0.3 What should stay deterministic

Replacing every rule with ML is not the goal. Some decisions are **policy or regulation, not prediction**, and must stay as hard guardrails above any model:

- Codes `01` (account closed), `02` (no such account) and `07` (court order): never retry. A model must not be allowed to override this.
- Mandate `REVOKED` / `EXPIRED`: a payment retry is impossible without re-authorization.
- NPCI/RBI limits on retry attempts and pre-debit notification rules for recurring mandates. Encode the current NPCI circulars as a policy layer.
- Money guardrails in RefundGuard (§16 of the design doc): max auto-refund amount, daily cap, and human approval above the cap.

**Target architecture:** `Policy guardrails (rules) → ML models (probabilities) → Decision optimizer (expected ₹ value, constraints) → Action → Outcome logging → Retraining`. Rules become the safety envelope. Models make the decisions inside it.

---

## Part 1: Track A, the full production stack

### 1.0 The data reality (read before picking models)

**No public dataset of UPI AutoPay / eNACH mandate failures with outcomes exists.** Anyone who says otherwise is selling something. You have three sources of real signal:

| Source | What you get | How to obtain |
|---|---|---|
| **Design-partner merchants** (2–5 subscription/EMI/SIP merchants) | Real mandate executions, failure codes, retry outcomes, success-day patterns | Offer the engine free in shadow mode in exchange for anonymized, tokenized event logs under a DPA. **This is the single most important asset for the startup.** |
| **Razorpay / PA webhooks in live mode** | `payment.failed`, `subscription.halted`, `token.*` events with `error_code`, `error_reason`, `error_source`, `error_step` | Razorpay partner program / live account with merchant consent |
| **NPCI and RBI public statistics** | Monthly **bank-wise technical decline (TD) and business decline (BD) %** for UPI remitter banks, AutoPay mandate volumes | NPCI website → *UPI Ecosystem Statistics* / product statistics pages; RBI DBIE. Download monthly and store it. |

Public **proxy datasets** can be used to pre-train, prototype and benchmark the modeling approach before partner data arrives. They are not substitutes for final validation:

| Proxy dataset | Why it's relevant | Where |
|---|---|---|
| **Home Credit Default Risk**: `installments_payments.csv` | Real installment schedules versus actual payment dates and amounts, which directly models "paid late / paid short / paid on which day" | Kaggle competition `home-credit-default-risk` |
| **Berka / PKDD'99 Czech bank** | Real bank transactions with **balances**, **standing orders** and salary credits. You can derive when balance ≥ debit amount per day of month, which is the closest public proxy for Z9 timing. | PKDD'99 Discovery Challenge (mirrored on relational.fit.cvut.cz and Kaggle) |
| **KKBox Churn (WSDM Cup 2018)** | Real subscription transactions: auto-renew flag, payment method, cancellations, renewals. Models subscription involuntary churn. | Kaggle `kkbox-churn-prediction-challenge` |
| **UCI "Default of Credit Card Clients" (Taiwan)** | Monthly repayment status sequences (PAY_0..PAY_6), a proxy for consecutive-failure dynamics | UCI ML Repository |
| **IEEE-CIS Fraud Detection** | Large tabular card-not-present fraud dataset for the ESCALATE / risk model | Kaggle `ieee-fraud-detection` |
| **Bank Account Fraud (BAF) suite**, Feedzai, NeurIPS 2022 | Realistic privacy-preserving tabular fraud with bias-evaluation variants | GitHub `feedzai/bank-account-fraud` / Kaggle |
| **PaySim** | Mobile-money transaction simulation calibrated on real logs | Kaggle `paysim1` |

### 1.1 Model A1: Retry Success Propensity (the core model)

**Replaces:** the implicit "RECOVER = will succeed later" assumption, and the RECOVER/STOP boundary (`consecutive_failures >= 3`).

- **Task:** `P(retry succeeds | event features, candidate retry time t)`. Binary classification, scored for each candidate retry slot (day × hour).
- **Model:** **LightGBM / CatBoost** (CatBoost handles categorical codes, bank handles and merchant category natively). Add a monotonic constraint (success probability can't increase with `consecutive_failures`) to keep the model sane and explainable.
- **Features** (from existing schema plus new ones):
  - failure code, `error_source` / `error_step` (Razorpay), remitter bank / PSP handle (e.g. `@okhdfcbank` → HDFC), mandate category, amount, amount relative to the customer's median successful amount, **amount above or below ₹15,000** (the PIN re-auth threshold)
  - day-of-month, day-of-week, hours since failure, **days to or after month start**, public holiday / bank-holiday flag (RBI holiday calendar per state)
  - success ratio, `consecutive_failures`, days since last success, **full success-day histogram** (not a set), entropy of success days, recency-weighted success density at candidate day *t* (the existing KDE becomes a **feature**, not the decision)
  - mandate age, days to mandate expiry, prior retries this cycle
  - bank-level live TD rate over the last 1h / 24h (from A3)
- **Label:** did the retry at time *t* succeed? It comes from real retry outcomes.
- **Training data:** partner merchant logs, 3–6 months minimum. Pre-train on Home Credit installments (label = paid within N days of due date) to validate the feature pipeline.
- **Split:** **time-based** (train months 1–4, validate month 5, test month 6). Never split randomly, because salary cycles are seasonal. Also report per merchant **group k-fold** so you know it generalizes to a new merchant.
- **Calibration:** isotonic regression or Platt scaling on the validation month. You need calibrated probabilities because they feed an expected-value calculation.
- **Metrics:** ROC-AUC and PR-AUC, **Brier score, Expected Calibration Error (ECE)**, reliability diagram by decile, and **lift in the top decile**. Business metrics: recovery rate per retry attempt, ₹ recovered per 100 retries.
- **Explainability:** SHAP values per decision, with the top 3 SHAP reasons logged in the audit record. These replace `rule_rationale`.
- **Proof bar before launch:** beats the current rules plus KDE baseline on the time-split test month, with bootstrap 95% CI on the ₹-recovered delta excluding 0.

### 1.2 Model A2: Time-to-Recovery / Survival model

**Replaces:** `day_of_month_model.py` (the KDE with hardcoded `[5, 28]` fallback).

- **Task:** for a failed debit, estimate the hazard *h(t)* that the customer's account becomes payable at each future day *t*. This gives a full curve over the next 30 days instead of a single peak day.
- **Models, in order of complexity:**
  1. **Discrete-time hazard model**: LightGBM over (event, day-offset) rows. Simple and strong.
  2. **Cox PH / Weibull AFT** (`lifelines`, `scikit-survival`) as an interpretable baseline.
  3. **DeepSurv / DeepHit** (`pycox`) only if you have more than 100k events.
- **Hierarchical prior for cold start:** customers with fewer than 4 cycles borrow strength from **merchant category × bank × city-tier** priors (empirical Bayes / hierarchical Bayesian model in `PyMC` or `NumPyro`). This replaces the hardcoded "day 5 and 28".
- **Data:** partner logs. For pre-training, derive "balance crosses debit amount" events from **Berka** balances plus standing orders.
- **Metrics:** concordance index (C-index), integrated Brier score, time-dependent AUC. Business metric: **median days-to-recovery** versus baseline.

### 1.3 Model A3: Bank/PSP outage detector (the WAIT branch)

**Replaces:** the static rule `U69 → 30 min, U28 → 4 h`.

- **Task:** a real-time estimate of whether bank X or PSP Y is degraded right now, plus a predicted recovery time.
- **Models:**
  - Streaming anomaly detection on per-bank failure rates: **CUSUM / EWMA control charts** (deterministic and explainable) plus **STL decomposition** for daily and weekly seasonality.
  - Forecasting normal TD rate: **Prophet** or **Chronos / TimesFM** (foundation time-series models, zero-shot).
  - Recovery-time model: survival model over past outage durations per bank.
- **Data:** your own aggregated webhook stream (failures per bank per 5 min), NPCI monthly bank-wise TD statistics as priors, and public status pages/Downdetector-style signals if licensed.
- **Metrics:** detection delay (minutes), false-alarm rate per week, precision/recall on labeled outage windows (label them from post-mortem logs), and ₹ saved by *not* retrying into an outage.

### 1.4 Model A4: Retry-timing policy (contextual bandit)

**Replaces:** "pick top-2 KDE days".

- **Why a bandit:** A1 and A2 predict outcomes under **past** retry policies. Picking the retry slot is a decision, and you need exploration to learn slots you never tried.
- **Model:** a contextual bandit (**LinUCB / Thompson Sampling**, or **Vowpal Wabbit** `--cb_explore_adf`). Candidate arms are retry slots (e.g. `{+30min, +4h, next salary day, day 1, day 5, day 28, +7d}` × `{morning, evening}`). The reward is ₹ collected minus retry cost minus a customer-friction penalty.
- **Guardrails:** max attempts per cycle (NPCI rules), no retry during detected bank outages (A3), and never on STOP-policy codes.
- **Evaluation before going live:** **off-policy evaluation** (IPS, Doubly Robust, SNIPS) on logged data with logged propensities. **Start logging propensities now.** Every scheduled retry should record the probability with which the policy chose it.
- **Online proof:** a **randomized holdout** (e.g. 10% of events get the current rules). This is the only way to claim "X% more ₹ recovered" causally.

### 1.5 Model A5: Uplift model for interventions (REAUTHORIZE / STOP nudges)

**Replaces:** "send Hinglish nudge max 2, 3-day spacing" and "single STOP message".

- **Task:** estimate the **incremental** effect of an intervention (send a re-mandate link, offer a lower plan, change channel between WhatsApp, SMS and email, change send time) on reactivation. Some customers reactivate anyway, and some churn if nudged.
- **Models:** **T-learner / X-learner / DR-learner** (`EconML`, `CausalML`), or uplift trees. Qini / AUUC curves for evaluation.
- **Data:** requires a **randomized experiment**. Randomly withhold or vary nudges for a small percentage. There is no public substitute. KKBox (auto-renew / cancel) can be used to prototype the pipeline.
- **Metrics:** Qini coefficient, AUUC, incremental reactivation rate, and ₹ recovered per message sent. Also track opt-out and complaint rate as a guardrail metric.

### 1.6 Model A6: Risk / anomaly model (the ESCALATE branch)

**Replaces:** `len(distinct_codes) >= 3 OR chargebacks > 0`.

- **Task:** a probability that the mandate or customer shows account-compromise, mule or first-party-abuse behavior. It only routes to human review and never blocks automatically. Keep the safety boundary exactly as designed.
- **Models:**
  - Supervised: **LightGBM** on labeled outcomes (chargeback confirmed, fraud report, manual review verdict).
  - Unsupervised cold start: **Isolation Forest / ECOD** (`PyOD`) over failure-pattern features.
  - Later: a **graph model** (shared device, VPA or bank account across customers) such as GraphSAGE in PyG, or simple graph features like connected-component size.
- **Data:** pre-train and benchmark on **IEEE-CIS**, **BAF** and **PaySim**. Final labels come from merchant chargeback and dispute logs plus reviewer decisions in your exceptions queue. Capture the **review verdict** in the dashboard now, because this is your label factory.
- **Metrics:** PR-AUC (heavy class imbalance), recall at fixed review capacity ("top 2% flagged catch X% of confirmed abuse"), reviewer precision, and **fairness slices** by city tier and bank (BAF supports this).

### 1.7 Model A7: Involuntary-churn / mandate health score

- **Task:** predict mandate failure **before** the debit date (e.g. T-2 days) so the merchant can send a pre-debit reminder or move the debit date. Moving from reactive to proactive is the startup-level differentiator.
- **Model:** LightGBM, where the label is whether the next debit fails with Z9/04. The features are the same as A1 plus trend features.
- **Data:** partner logs. Prototype on **Home Credit installments** and **UCI Taiwan** sequences.
- **Metrics:** PR-AUC, and ₹ saved through pre-debit date shifting (measured in an A/B test).

### 1.8 Model A8: Explanation LLM with faithfulness verification

**Replaces:** the unchecked OpenRouter → Gemini → template chain.

- **Generation:** a hosted LLM with **structured output** (JSON: `decision`, `top_reasons[]`, `numbers_cited{}`, `explanation`). Use `claude-haiku-4-5-20251001` for volume, or `claude-sonnet-5` for regulator-facing text, called once per decision and cached. Feed it the **SHAP top reasons plus policy rule IDs** rather than a free-text rationale.
- **Faithfulness gate** (this makes explanations provable):
  1. **Deterministic check:** every number in the explanation must match a field in the input (regex extraction compared against the event JSON), and the branch named must equal the decision.
  2. **NLI check:** `microsoft/deberta-v3-large` fine-tuned on MNLI, or `MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli`. Each explanation sentence must be *entailed* by a canonical fact list generated from the features.
  3. If either check fails, fall back to the template and log `explanation_verified: false`.
- **Hinglish customer messages:** generate with an LLM, then check with **IndicBERT/MuRIL**-based toxicity and pressure classifiers plus a policy regex (no threats, no fake urgency, as required under RBI fair-practice norms). A/B-test message variants through A5.
- **Metrics:** faithfulness pass rate (target above 99%), hallucinated-number rate, human rating on 200 sampled explanations (clarity/accuracy, 1–5), and inter-rater agreement (Cohen's κ).

---

### 1.9 RefundGuard models

The current RefundGuard has no models. Each sub-score in `evidence_scores` needs a real model behind it.

```
Refund request ──► B1 Claim understanding (text) ─────────────┐
Evidence images ─► B2 Product identity match ────────────────┤
               ├─► B3 Serial/label OCR + order match ─────────┤
               ├─► B4 Damage detection & localization ───────┤
               ├─► B5 Manipulation detection ────────────────┼─► B9 Fusion + calibration + conformal ─► APPROVE / VERIFY / REVIEW
               ├─► B6 AI-generated detection ────────────────┤         (+ B10 adaptive challenge loop)
               ├─► B7 Evidence reuse / copy detection ───────┤
               └─► Metadata / C2PA checks (rules) ───────────┤
Customer history ► B8 Refund-abuse risk (tabular) ────────────┘
```

#### Model B1: Claim understanding (text → structured claim)

- **Task:** classify refund reason (`PRODUCT_DAMAGED`, `WRONG_PRODUCT`, `MISSING_ITEM`, …) and extract entities (part damaged, color, model), including Hinglish text.
- **Model:** fine-tune **MuRIL** or **IndicBERT v2** (handle Hinglish/code-mixed text) or **DeBERTa-v3-base** (English) for classification. Use a GLiNER or LLM structured output for entity extraction.
- **Datasets:**
  - **CFPB Consumer Complaint Database**: millions of real complaints with product/issue labels, for pre-training complaint classification (consumerfinance.gov).
  - **Amazon Reviews 2023** (McAuley Lab, UCSD): filter 1–2★ reviews that mention damage or wrong item, then weakly label them.
  - **L3Cube HingCorpus / HingBERT** and the **LinCE** benchmark for code-mixed Hindi-English.
  - Your own merchant refund tickets. Label 2–5k with Label Studio.
- **Metrics:** macro-F1 per reason, and entity-level F1.

#### Model B2: Product identity match (evidence image ↔ catalog SKU)

- **Task:** does the photographed product match the ordered SKU? Return a similarity score.
- **Model:** image embeddings from **SigLIP 2 / CLIP ViT-L** or **DINOv2**, fine-tuned with **metric learning** (ArcFace / triplet loss) on product-retrieval data. Compare against the merchant's catalog images in **FAISS / Qdrant / pgvector**.
- **Datasets:** **Products-10K** (JD.com, about 10k SKUs), **Stanford Online Products**, **Shopee Product Matching** (Kaggle), **Amazon Berkeley Objects (ABO)**, **DeepFashion2** (apparel), plus merchant catalog photos paired with real customer photos.
- **Metrics:** Recall@1/5, mAP@K, and the verification ROC-AUC of "same SKU vs different SKU".

#### Model B3: Serial number / label OCR and order consistency

- **Task:** read the serial, model number or IMEI from the photo and compare it with the order record. The current `serial_match` field is a synthetic boolean.
- **Model:** **PaddleOCR (PP-OCRv4+)** or **docTR** for detection and recognition. Use **Florence-2 / Qwen2.5-VL** as a fallback for hard cases. Use fuzzy matching (Levenshtein ≤1 with confusion-pair handling such as 0/O and 1/I).
- **Datasets:** **TextOCR**, **ICDAR 2015/2019** scene text, plus **synthetic labels** generated by rendering serial stickers onto product images (SynthText-style). Include 500+ real labeled product-label photos.
- **Metrics:** character error rate (CER), exact-match serial accuracy, and false-mismatch rate. False mismatches matter most, because they cause wrongful escalations.

#### Model B4: Damage detection and localization

- **Task:** is visible damage present, where is it, and does it match the claimed part ("left earcup cracked")?
- **Models:**
  - **Anomaly detection** (needs only good-product images): **PatchCore / EfficientAD** through **anomalib**, trained per SKU family on catalog images.
  - **Supervised detection/segmentation:** fine-tune **YOLO11 / RT-DETR** for damage classes (crack, dent, scratch, crushed box, torn packaging). Use **SAM 2** to speed up mask labeling.
  - **Open-vocabulary check** of the claimed part: **Grounding DINO** ("left earcup") and a spatial IoU with the damage mask.
- **Datasets:** **MVTec AD**, **VisA** and **MVTec LOCO** (industrial defects), **CarDD** (car damage; transfers for dents and scratches), packaging-damage sets from Roboflow Universe (check licenses), plus merchant returns-desk photos, which are the gold standard.
- **Metrics:** image-level AUROC, pixel-level PRO / AUPRO, mAP@0.5 for detection, and "claimed-part consistency" accuracy.

#### Model B5: Image manipulation detection and localization

- **Task:** detect splicing, copy-move, inpainting and Photoshop edits, and localize the edited region.
- **Models:** **TruFor** (pretrained, gives a localization map and a reliability map), **CAT-Net** (JPEG-compression artifacts), **MVSS-Net**, **IML-ViT**. Ensemble two of them.
- **Datasets:** **CASIA v2**, **Columbia**, **COVERAGE** (copy-move), **NIST MFC / Nimble**, **IMD2020**, **DEFACTO**. Also create **your own manipulated set**: take legitimate return photos and synthetically crack, inpaint or splice them, so the model sees your domain.
- **Metrics:** image-level AUC, pixel-level F1/IoU, and **robustness to WhatsApp-style recompression and resizing**. Test this explicitly, because many detectors collapse after recompression.

#### Model B6: AI-generated image detection

- **Task:** a probability that the image is fully or partially generated by a diffusion or GAN model.
- **Models:** **UnivFD** (CLIP features + linear probe, which generalizes best across generators), **NPR**, **DIRE**. Retrain the probe periodically on new generators.
- **Datasets:** **GenImage**, **Synthbuster**, **WildFake**, **ForenSynths** (Wang et al. CNNDetection), **ArtiFact**, **CIFAKE** (toy). Also generate your own: prompt current image models with "cracked wireless headphones on a table" and pair the outputs with real photos of the same SKUs.
- **Provenance:** verify **C2PA Content Credentials** (`c2pa-python`). When present, this is a cryptographic signal rather than a guess.
- **Honesty requirement:** these detectors **degrade on unseen generators**. Always report accuracy on a **held-out generator** (train on SD/GAN, test on a newer model). Never output "definitely AI-generated", as your own design doc §8 says.
- **Metrics:** AUC per generator family, accuracy on unseen generators, and FPR on real phone photos. FPR is the metric that matters here.

#### Model B7: Evidence reuse / copy detection

- **Task:** has this image, or a crop, edit or screenshot of it, been used before, either internally or found on the web (e.g. a stolen catalog or review photo)?
- **Models:**
  - **Perceptual hashes** (`imagehash`: pHash, dHash) plus **PDQ** (Meta) for exact and near-exact matches. These are fast and explainable.
  - **SSCD** (Meta's self-supervised copy-detection model) for crop, edit and overlay robustness.
  - Index everything in **FAISS**. Use reverse image search (Google Cloud Vision *web detection* or the TinEye API) for web-stolen photos.
- **Datasets:** **DISC21** (Facebook Image Similarity Challenge 2021), **Copydays**, **INRIA Holidays**.
- **Metrics:** µAP on DISC21-style queries, Recall@1 under augmentations, and false-match rate on different photos of the same SKU. The last one is the key failure mode, since two genuine photos of identical headphones look alike.

#### Model B8: Refund-abuse risk (customer history, tabular)

- **Task:** a prior probability of abuse from history. Your design doc (§9) correctly says this should **adjust the threshold, never deny on its own**.
- **Model:** LightGBM with monotonic constraints (more refunds must not lower risk). Evaluate fairness by city tier and region.
- **Data:** merchant order/refund/chargeback history. Proxy pre-training on **BAF** and **IEEE-CIS**.
- **Metrics:** PR-AUC, calibration, and parity metrics (FPR gap across segments).

#### Model B9: Fusion, calibration and abstention (replaces the weighted average)

- **Replaces:** `overall_confidence = .25*pm + .25*oc + .20*ea + .20*cc + .10*ch` and the fixed thresholds 85/50.
- **Model:** a **stacked meta-classifier** (logistic regression for interpretability, or small LightGBM) over the B1–B8 outputs, plus missing-evidence indicators. Calibrate with **isotonic regression**.
- **Thresholds:** choose them by **cost-sensitive optimization** on the validation set. Minimize `C_FN × fraudulent ₹ approved + C_FP × (friction + support cost) × legit claims delayed` subject to review-queue capacity. The economic-cost objective is already described in design doc §19. Implement it.
- **Abstention with guarantees:** use **conformal prediction** (`MAPIE`, split-conformal / Mondrian by claim type). Auto-approve only when the prediction set is `{legit}` at a 1−α coverage level. This gives a **formal statistical guarantee** such as "auto-approved claims are fraudulent at most α% of the time, under exchangeability". That is a strong, defensible claim for judges, merchants and regulators.
- **Metrics:** Brier score, ECE, precision at the auto-approve threshold, **fraudulent ₹ approved per ₹1 lakh processed**, % auto-decided (automation rate), and review-queue load.

#### Model B10: Adaptive evidence challenge (video liveness)

- **Task:** verify the fresh video: the challenge code (e.g. `K7P2`) is visible and handwritten or on-screen, the product is the same SKU (B2), the serial matches (B3), the damage is consistent with the original photo (B4 region matching), and the video isn't a replay or screen recording.
- **Models:** OCR (B3) on sampled frames, B2/B4 on keyframes, moiré/screen-recapture detection (a small CNN trained on recaptured versus direct images), and **optical-flow consistency** to catch looped or static video.
- **Metrics:** challenge pass rate for legitimate users (a UX guardrail), and attack success rate in red-team tests.

---

### 1.10 Summary table (Track A)

| # | Model | Replaces (file) | Algorithm | Primary data | Key metric |
|---|---|---|---|---|---|
| A1 | Retry success propensity | `rule_engine._is_recover`, STOP threshold | CatBoost/LightGBM + isotonic | Partner logs (+ Home Credit proxy) | PR-AUC, ECE, ₹/100 retries |
| A2 | Time-to-recovery | `day_of_month_model.py` | Discrete-time hazard GBM, hierarchical Bayes prior | Partner logs (+ Berka proxy) | C-index, IBS, median days-to-recover |
| A3 | Bank outage detector | `_is_wait` static delays | CUSUM/EWMA + STL + Chronos | Own webhook aggregates, NPCI TD stats | Detection delay, false alarms/week |
| A4 | Retry-timing bandit | KDE top-2 days | Contextual bandit (VW) + OPE | Logged retries with propensities | DR-estimated ₹ lift, online holdout |
| A5 | Nudge uplift | Fixed 2-nudge rule | X/DR-learner (EconML) | Randomized nudge experiments | Qini, incremental reactivation |
| A6 | Risk / anomaly | `_is_escalate` | LightGBM + IsolationForest, later GNN | Review verdicts (+ IEEE-CIS/BAF) | PR-AUC, recall@capacity |
| A7 | Pre-debit failure forecast | (new) | LightGBM | Partner logs | PR-AUC, ₹ saved via date shift |
| A8 | Faithful explainer | `llm_explainer.py` | LLM + numeric check + DeBERTa NLI | Own decisions | Faithfulness pass rate |
| B1 | Claim understanding | `refund_reason` random | MuRIL / DeBERTa fine-tune | CFPB, Amazon Reviews, own tickets | Macro-F1 |
| B2 | Product match | `product_match` randint | SigLIP/DINOv2 + ArcFace + FAISS | Products-10K, SOP, ABO, catalog | Recall@1, verification AUC |
| B3 | Serial OCR | `serial_match` synthetic | PaddleOCR / Florence-2 | TextOCR, synthetic labels | CER, false-mismatch rate |
| B4 | Damage detection | `claim_consistency` randint | PatchCore + YOLO11 + Grounding DINO/SAM2 | MVTec, VisA, CarDD, returns photos | AUROC, mAP, part-consistency |
| B5 | Manipulation detection | `evidence_authenticity` randint | TruFor + CAT-Net | CASIA2, IMD2020, DEFACTO, own edits | Image AUC, robustness |
| B6 | AI-gen detection | "may be AI-generated" flag | UnivFD + C2PA | GenImage, Synthbuster, WildFake | Held-out-generator AUC, FPR |
| B7 | Evidence reuse | "96.4% similarity" string | pHash/PDQ + SSCD + FAISS | DISC21, Copydays | µAP, false-match rate |
| B8 | Abuse risk prior | `customer_history_score` randint | Monotonic LightGBM | Merchant history (+ BAF) | PR-AUC, fairness gap |
| B9 | Fusion + conformal | weighted avg + 85/50 | Stacked LR + isotonic + MAPIE | Val split of labeled claims | Fraud ₹ approved, automation rate |
| B10 | Challenge verification | (design only) | OCR + recapture CNN + flow | Red-team + real submissions | Attack success rate |

---

## Part 2: Track B, the lean approach with open-source pretrained models

**Principle:** at seed stage you have little labeled data and little GPU budget. **Almost nothing here needs training from scratch.** The order of preference:

1. **Zero-shot pretrained model**: ship in days. Use it to measure a baseline and start collecting labels.
2. **Frozen embeddings + small head** (logistic regression / linear probe / kNN): hours of CPU or GPU, and needs only hundreds of labels.
3. **Parameter-efficient fine-tuning** (LoRA/QLoRA, or last-layer fine-tuning): a single 24–48 GB GPU, with 1–10k labels.
4. **Full fine-tuning**: only when 1–3 plateau and you have more than 50k labels.
5. **Train from scratch**: only for tabular GBMs, which are cheap anyway, and small task-specific heads.

### 2.1 Component-by-component choices

| Component | Zero-shot / off-the-shelf (Stage 1) | Fine-tune when… (Stage 2–3) | Train from scratch? |
|---|---|---|---|
| **A1/A2/A7 tabular** | **TabPFN v2** (tabular foundation model, strong with fewer than 10k rows and no tuning) as the first model on small partner data | Move to LightGBM/CatBoost once you exceed ~10k labeled events | GBMs *are* trained from scratch, but that takes minutes on CPU. This is fine and expected. |
| **A3 outage** | **Chronos-Bolt / TimesFM** zero-shot forecasting + CUSUM residual alarms | Fine-tune Chronos on 6+ months of per-bank series if false alarms are high | No |
| **A4 bandit** | Thompson sampling with Beta priors per (segment × slot), no library needed | Vowpal Wabbit contextual bandit when you have 50k+ decisions | Online learning. It is "trained" continuously, and cheaply. |
| **A5 uplift** | Simple A/B per segment | EconML DR-learner after about 5k randomized nudges | Cheap tabular |
| **A6 risk** | **Isolation Forest / ECOD** (unsupervised) + current rules as features | LightGBM once you have 200+ confirmed-bad labels | Cheap tabular |
| **A8 explainer** | Hosted LLM (`claude-haiku-4-5-20251001`) with structured output + **pretrained NLI** (`DeBERTa-v3-large-mnli-fever-anli-ling-wanli`) | Fine-tune a small model (e.g. Qwen3-1.7B/4B with LoRA) on 5–10k verified explanations **only** if data-residency or cost forces self-hosting | No |
| **Hinglish messages** | Hosted LLM, or **Sarvam** Indic models / **AI4Bharat IndicTrans2** for translation | LoRA on 1–2k merchant-approved messages | No |
| **B1 claim text** | LLM zero-shot classification with a JSON schema, or **GLiNER** for entities | Fine-tune **MuRIL** on 2–5k labeled tickets (a few GPU-hours) | No |
| **B2 product match** | **SigLIP 2 / DINOv2** embeddings + cosine similarity to catalog images (no training) | Fine-tune the last blocks with ArcFace on ~5k (customer photo, SKU) pairs; ~1 GPU-day | No |
| **B3 OCR** | **PaddleOCR** off the shelf; **Florence-2** for hard crops | Fine-tune the PaddleOCR recognizer on ~2k serial-label crops | No |
| **B4 damage** | **Grounding DINO + SAM 2** with text prompts ("crack", "dent", "scratch"), **PatchCore** (anomalib) fit on catalog images (no labels needed), or a VLM (**Qwen2.5-VL-7B** / hosted Claude vision) asked structured questions | Fine-tune **YOLO11** on 1–3k labeled damage boxes; **LoRA-fine-tune Qwen2.5-VL** on (image, claim, verdict) triples (Unsloth / LLaMA-Factory on a single 24 GB GPU with QLoRA) | No |
| **B5 manipulation** | **TruFor** pretrained weights + **CAT-Net** | Fine-tune on your own synthetic edits of real return photos (the domain-gap fix) | No |
| **B6 AI-gen** | **UnivFD** (CLIP linear probe; pretrained checkpoint) + **C2PA** verification | **Retrain only the linear probe** (minutes) on new generator outputs every quarter | No, never |
| **B7 reuse** | **pHash/PDQ + SSCD** pretrained + FAISS (production-ready as is) | Usually unnecessary | No |
| **B8 risk prior** | Rules as features + TabPFN | LightGBM | Cheap tabular |
| **B9 fusion** | Logistic regression on sub-scores (needs about 500 labeled claims) + **MAPIE** conformal | Swap to LightGBM stacker at 5k+ claims | Cheap |

### 2.2 The "one VLM" shortcut for RefundGuard, and its limits

A tempting MVP is to send the photo, claim and order record to a vision-language model (Claude vision, or self-hosted **Qwen2.5-VL / InternVL**) and ask for a JSON verdict.

- **Good for:** claim-evidence consistency ("is the damage on the left earcup?"), reading labels, and generating the adaptive-challenge text. It gets a demo working in a week.
- **Not good for:** manipulation and AI-generation detection. General VLMs are close to chance on forensic tasks and are overconfident. Their confidence scores aren't calibrated probabilities.
- **Correct use:** treat the VLM as **one feature** into B9 fusion. Keep B5, B6 and B7 as dedicated forensic models, and calibrate everything on labeled data.

### 2.3 Where fine-tuning actually pays off (ranked by ROI)

1. **B2 product match on your merchants' catalog photos.** Domain shift from studio images to phone photos is large, and ArcFace fine-tuning typically closes most of it.
2. **B5 manipulation on your own synthetic edits.** Public forensic datasets don't look like WhatsApp-compressed phone photos of headphones.
3. **B4 damage detector (YOLO11)** once you have about 1–3k labeled return photos.
4. **B6 linear-probe refresh** each quarter as new generators appear. This is cheap and essential.
5. **B1 MuRIL** for Hinglish tickets.

Everything else: zero-shot plus calibration is enough until you have real volume.

### 2.4 What Track B costs (rough order of magnitude)

These are planning estimates, not quotes. Verify current pricing.

| Item | Track B (lean) | Track A (full) |
|---|---|---|
| GPU for fine-tuning | 1× 24–48 GB GPU (cloud, spot) for ~1–2 weeks total across projects | Several GPUs over months, plus experiments |
| Inference | CPU for GBMs, hashes and PaddleOCR; one T4/L4-class GPU for SigLIP, TruFor and UnivFD at low volume | Autoscaled GPU pool (Triton / vLLM), batch plus real-time |
| Labeling | 2–5k refund claims, 1–3k damage boxes (in-house + Label Studio) | 20k+ claims with double annotation and adjudication |
| Team | 1 ML engineer + 1 backend engineer | ML lead + 2–3 MLEs + data engineer + labeling ops |
| Time to first real metrics | 4–6 weeks | 3–6 months (gated by partner data) |

**Recommendation:** start with **Track B**, but build the data, logging and evaluation plumbing from **Track A** (propensity logging, label capture, time-split evaluation, and a model registry) from day one. Then each Track B model can be upgraded to Track A without re-architecting.

---

## Part 3: Evaluation and proof framework

This part makes the accuracy claims defensible.

### 3.1 Ground truth: where real labels come from

| Model | Label source | How to capture |
|---|---|---|
| A1/A2/A4 | Actual retry outcomes (success/fail + timestamp) | Webhooks → outcome table keyed by `event_id`, `retry_attempt_id` |
| A3 | Confirmed outage windows | Incident post-mortems, bank status notices, manual labels on anomaly alerts |
| A5 | Reactivation after randomized nudge vs control | Experiment assignment table (unit, arm, propensity, timestamp) |
| A6/B8 | Chargeback confirmed, fraud report, **reviewer verdict** | Add an "Approve / Confirm-abuse / Unsure" button to the exceptions queue |
| B1–B7 | Human annotation | Label Studio projects; **double-annotate 20%** and report Cohen's κ / Krippendorff's α |
| B9 | Final claim outcome: refund legit (product returned damaged), abuse confirmed at return inspection | Merchant returns-desk inspection result, the strongest label available |

**Never let the generator that creates the data also define the label.** That is the current circularity. Synthetic data is still useful for **unit-testing the pipeline and stress-testing edge cases**, but report it separately and label it clearly: "synthetic sanity check, not accuracy".

### 3.2 Splits and leakage rules

- **Time-based splits** for everything behavioral (A1–A7, B8).
- **Group splits** by `customer_id` and `merchant_id` (no customer appears in both train and test). Report a **leave-one-merchant-out** score for generalization to new merchants.
- **Held-out generator / manipulation type** for B5 and B6.
- **Near-duplicate removal** across splits for images (use B7 itself to dedupe).
- Freeze the test set. Keep a written log of every time it's touched.

### 3.3 Metrics to report for every model

1. **Discrimination:** ROC-AUC, PR-AUC (always for imbalanced problems).
2. **Calibration:** Brier score, ECE, reliability diagram.
3. **Operating point:** precision, recall and FPR at the chosen threshold, and the **cost-weighted loss** at that threshold.
4. **Uncertainty:** **bootstrap 95% confidence intervals** (1,000 resamples) on every headline number. With 750 test cases, ±2–3% is typical. Say so.
5. **Baseline comparison computed on the same test set:** (a) current rules, (b) "always retry immediately", (c) "refund if refund-count < 3". Use a McNemar test for accuracy differences and a paired bootstrap for ₹ metrics.
6. **Ablations:** remove each sub-model from B9 fusion and show the drop. This proves each model contributes.
7. **Slices:** by merchant category, bank, amount band (<₹15k vs ≥₹15k), city tier, and new vs returning customer.
8. **Business metrics:** ₹ recovered per 100 retries, retries avoided (with the cost assumption stated), fraud ₹ approved per ₹1L processed, automation rate, review-queue minutes/day.

### 3.4 Offline → shadow → online ladder

1. **Offline** on the frozen test set, with all of 3.3.
2. **Shadow mode** (2–4 weeks): the model scores live traffic, decisions still come from rules, and you log both. Measure agreement, and for disagreements, measure which one was right using outcomes.
3. **Randomized online test:** 10–20% treatment first, with guardrail metrics (complaints, chargebacks, opt-outs) and pre-registered success criteria and sample size (power analysis).
4. **Full rollout** with a permanent **5% holdout** on the old policy, so the causal lift can be measured continuously. This is what lets you publish "X% more recovered" in a pitch deck with a straight face.

### 3.5 Artifacts that make the proof auditable

- A **model card** per model: data, intended use, metrics with CIs, slices, known failure modes, owner.
- A **datasheet** per dataset: source, license, consent/DPA basis, collection period.
- An **evaluation report** auto-generated per model version (HTML/MD from the eval job), stored in the registry and linked from the dashboard.
- **Replace `summary.json` hardcoded values** with the output of this eval job. The dashboard must read metrics, never write them.

---

## Part 4: MLOps, compliance and rollout

### 4.1 Reference stack (open-source first)

| Layer | Choice |
|---|---|
| Event ingestion | Razorpay webhooks → FastAPI → Kafka/Redpanda (or Postgres queue at small scale) |
| Storage | Postgres (operational) + object store (S3/GCS) for images + Parquet/DuckDB (analytics) |
| Feature store | **Feast** (point-in-time-correct joins prevent label leakage) |
| Experiment tracking + registry | **MLflow** |
| Data/label versioning | **DVC** or lakeFS; **Label Studio** for annotation |
| Orchestration | **Prefect** or Airflow (retraining, eval, drift jobs) |
| Serving | FastAPI + ONNX Runtime (GBMs, small CNNs); **Triton** or BentoML for GPU vision; **vLLM** if self-hosting an LLM or VLM |
| Vector search | FAISS (start) → Qdrant / pgvector |
| Monitoring | **Evidently** (data/prediction drift, calibration drift), Prometheus + Grafana |
| Policy layer | Plain versioned Python or **OPA** rules. Every decision logs `policy_version` and `model_version`. |

### 4.2 Audit log schema additions

Add these to `audit_log_writer.build_audit_record`:

```
model_versions: {propensity: "a1-2026.10.1", survival: ..., fusion: ...}
policy_version: "npci-2026-09"
scores: {p_success_at_slot: {...}, p_risk: 0.07, evidence: {product_match: 0.91, ...}}
conformal: {alpha: 0.05, prediction_set: ["legit"]}
top_reasons: [{feature, shap_value, human_text}]
chosen_action, action_propensity, candidate_actions
explanation_verified: true, explanation_checks: {numbers: pass, nli: pass}
outcome: {filled later by webhook: success/fail, amount, ts}
```

`action_propensity` and `outcome` are what make A4/A5 and every future proof possible. **Start logging them before any model exists.**

### 4.3 Compliance and safety

- **DPDP Act 2023 / DPDP Rules 2025:** a lawful basis for processing partner data (a DPA with each merchant as data fiduciary, with you as processor), purpose limitation, retention limits, and tokenized IDs (already done). Images of customers' homes can contain personal data, so apply face/text redaction before long-term storage.
- **RBI:** recurring-payment e-mandate framework (pre-debit notification, AFA thresholds), Fair Practices Code for recovery messaging (no harassment), and the Payment Aggregator guidelines. Keep the **policy layer** current with circulars.
- **Model risk:** human-in-the-loop for ESCALATE and REVIEW; **no automated denial of refunds** (auto-approve or route to a human only); money caps; a kill-switch per model with fallback to rules.
- **Fairness:** monitor FPR parity for A6, B8 and B9 across geography and bank. Don't use protected attributes or close proxies (name, pin code → community) as features.
- **Security:** rotate the committed Razorpay secret, move all keys to a secrets manager, and sign webhooks (verify `X-Razorpay-Signature`).

### 4.4 Phased plan

| Phase | Duration | Deliverables | Exit criteria |
|---|---|---|---|
| **0. Honesty and plumbing** | 1–2 weeks | Fix bugs in §0.2; remove hardcoded metrics; label synthetic metrics as such; add propensity and outcome logging; eval job skeleton; rotate keys | Dashboard shows only computed numbers; tests pass |
| **1. Lean models (Track B)** | 4–6 weeks | B7 (pHash+SSCD), B2 (SigLIP zero-shot), B3 (PaddleOCR), B5 (TruFor), B6 (UnivFD+C2PA), B9 (LR + MAPIE); A8 faithfulness gate; A3 CUSUM; TabPFN for A1 on proxy data | Each model has a model card with CIs on a small real labeled set (≥500 claims hand-labeled) |
| **2. Design partners + shadow** | 2–3 months | Onboard 2–5 merchants; shadow mode; collect outcomes and review verdicts; label 2–5k refund claims | 3 months of outcome data; shadow agreement report |
| **3. Fine-tune and train (Track A)** | 2–3 months | A1/A2 GBM+hazard on partner data; B2 ArcFace fine-tune; B4 YOLO11; B5 domain fine-tune; A6 supervised | Beats rules on a time-split test with bootstrap CI excluding 0 |
| **4. Causal optimization** | ongoing | A4 bandit with OPE → online; A5 uplift experiments; A7 pre-debit forecast; permanent 5% holdout | Measured causal ₹ lift published internally monthly |

### 4.5 Immediate next steps (this week)

1. Rotate the Razorpay test secret and delete the default from `razorpay_mandate_orders.py:20`.
2. Fix `ingest_razorpay_events.py:81` (`rationale` → `rule_rationale`) and the refund `order_date` bug.
3. Delete the hardcoded `eval_vs_baseline` block and the static confidence values in `LiveSimulatorModal.jsx`. Label the current metrics as a **"synthetic consistency check"** on the dashboard.
4. Pass the full, non-deduplicated success-day list to the day-of-month model, and add a mandate-expiry check.
5. Add `action_propensity`, `model_version`, `policy_version` and `outcome` fields to the audit record.
6. Download the proxy datasets (Home Credit, Berka, KKBox, IEEE-CIS, BAF, DISC21, CASIA2, GenImage) and write datasheets with licenses. Several are **non-commercial / research-only**: check before using them in a commercial product. Use them for benchmarking, and use partner data for production training.
7. Start the design-partner conversation. Every Track A model depends on it.

---

*Model and dataset names reflect what was available at the time of writing. Check each project's current release, license and commercial-use terms before adopting it.*
