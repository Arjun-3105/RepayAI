"""
llm_explainer.py
================
Generates plain-language audit explanations for classified events.

The LLM's ONLY job: given the branch already selected by the deterministic
rule engine + the input signals, produce a one-paragraph judge-readable
explanation for the audit log.

The LLM does NOT make the classification decision — that is always done
by rule_engine.py first.

Provider chain (plan Section: LLM explanation calls):
  1. OpenRouter (anthropic/claude-3-haiku) — primary
  2. Google Gemini (gemini-1.5-flash) — fallback
  3. Template-based — offline fallback (no API calls)

Set environment variables:
  OPENROUTER_API_KEY — for OpenRouter
  GEMINI_API_KEY     — for Gemini fallback
"""

from __future__ import annotations
import json
import os
import sys
import time
from typing import Any, Dict, Optional
from datetime import datetime, timezone, timedelta

# ---------------------------------------------------------------------------
# Template-based fallback (no API key needed)
# ---------------------------------------------------------------------------

def _template_explanation(event: Dict[str, Any], branch: str, rule_rationale: str) -> str:
    """Generate a deterministic template explanation when no LLM API is available."""
    hist = event.get("customer_payment_history", {})
    fc   = event.get("failure_code", "unknown")
    amount = event.get("amount_inr", 0)
    succeeded = hist.get("total_cycles_succeeded", 0)
    total = hist.get("total_cycles_billed", 1)
    consecutive = hist.get("consecutive_failures", 0)
    success_days = hist.get("historical_success_days_of_month", [])

    templates = {
        "WAIT": (
            f"Classified as WAIT: failure code {fc} indicates a transient infrastructure "
            f"issue (bank/PSP side), not a customer-account problem. "
            f"Retrying immediately against a down system would waste the attempt. "
            f"Scheduled automatic retry after cooldown; no customer contact needed."
        ),
        "STOP": (
            f"Classified as STOP: failure code {fc} with {consecutive} consecutive failures "
            f"indicates this mandate is not recoverable through retries. "
            f"Customer has {succeeded}/{total} successful cycles historically. "
            f"No retry scheduled; merchant flagged for account-level review. "
            f"A single low-pressure message has been sent — not repeated."
        ),
        "REAUTHORIZE": (
            f"Classified as REAUTHORIZE: the mandate itself (status: {event.get('mandate_status')}) "
            f"lacks valid standing authorization for a ₹{amount:,.2f} debit — "
            f"no payment retry can succeed without a new mandate. "
            f"Re-mandate link generated; Hinglish nudge scheduled (max 2 attempts, 3-day spacing)."
        ),
        "ESCALATE": (
            f"Classified as ESCALATE: risk signals indicate an erratic, multi-cause failure "
            f"pattern for this customer. No automated action or customer contact — "
            f"full signal trail logged to merchant exceptions queue for human review. "
            f"This is a designed safety boundary."
        ),
        "RECOVER": (
            f"Classified as RECOVER: customer has {succeeded}/{total} successful cycles "
            f"historically (success rate {succeeded/max(total,1):.0%}), clustering on "
            f"days {success_days if success_days else '[5, 28] (default salary-cycle)'}. "
            f"Current failure (code {fc}) occurred outside that window. "
            f"Retry scheduled for customer's known success window rather than immediately — "
            f"aligning to observed salary-credit patterns for ₹{amount:,.2f}."
        ),
    }
    return templates.get(branch, rule_rationale)


# ---------------------------------------------------------------------------
# OpenRouter call
# ---------------------------------------------------------------------------

def _call_openrouter(
    event: Dict[str, Any],
    branch: str,
    rule_rationale: str,
    api_key: str,
    model: str = "anthropic/claude-3-haiku",
) -> Optional[str]:
    try:
        import requests
        prompt = _build_prompt(event, branch, rule_rationale)
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/recoverability-engine",
                "X-Title": "Recoverability Engine",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 180,
                "temperature": 0.3,
            },
            timeout=15,
        )
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Gemini fallback call
# ---------------------------------------------------------------------------

def _call_gemini(
    event: Dict[str, Any],
    branch: str,
    rule_rationale: str,
    api_key: str,
) -> Optional[str]:
    try:
        import requests
        prompt = _build_prompt(event, branch, rule_rationale)
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-1.5-flash:generateContent?key={api_key}"
        )
        response = requests.post(
            url,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": 180, "temperature": 0.3},
            },
            timeout=15,
        )
        if response.status_code == 200:
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_prompt(event: Dict[str, Any], branch: str, rule_rationale: str) -> str:
    hist = event.get("customer_payment_history", {})
    risk = event.get("customer_risk_signals", {})

    return f"""You are an audit log writer for a UPI AutoPay mandate recoverability engine.
A deterministic rule engine has already classified the following failed payment event.
Your job is to write ONE concise paragraph (2-4 sentences, plain English) explaining the
decision for the audit log — suitable for a merchant or regulator to read.

Do NOT second-guess the classification. Do NOT add disclaimers. Write in an authoritative, factual tone.

EVENT SIGNALS:
- failure_code: {event.get("failure_code")}
- mandate_status: {event.get("mandate_status")}
- amount_inr: ₹{event.get("amount_inr")}
- consecutive_failures: {hist.get("consecutive_failures", 0)}
- total_cycles_succeeded / total_cycles_billed: {hist.get("total_cycles_succeeded")}/{hist.get("total_cycles_billed")}
- historical_success_days_of_month: {hist.get("historical_success_days_of_month")}
- distinct_failure_codes_last_90d: {risk.get("distinct_failure_codes_last_90d")}
- chargeback_count_last_90d: {risk.get("chargeback_count_last_90d")}

CLASSIFICATION RESULT:
- Branch: {branch}
- Rule rationale: {rule_rationale}

Write the audit explanation:"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_explanation(
    event: Dict[str, Any],
    branch: str,
    rule_rationale: str,
    use_llm: bool = True,
) -> Dict[str, str]:
    """
    Generate a plain-language explanation for the audit log.

    Args:
        event: The failure event dict.
        branch: Classified branch (already determined by rule_engine.py).
        rule_rationale: Rule-based rationale string from rule_engine.py.
        use_llm: If False, use template fallback only (for --skip-llm mode).

    Returns:
        Dict with 'explanation' (str) and 'explanation_source' (str).
    """
    if not use_llm:
        return {
            "explanation": _template_explanation(event, branch, rule_rationale),
            "explanation_source": "template",
        }

    openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    # Try OpenRouter first
    if openrouter_key and openrouter_key != "your_openrouter_api_key_here":
        model_name = os.getenv("OPENROUTER_MODEL", "inclusionai/ling-3.0-flash-fin:free")
        result = _call_openrouter(event, branch, rule_rationale, openrouter_key, model=model_name)
        if result:
            return {"explanation": result, "explanation_source": f"openrouter:{model_name}"}

    # Try Gemini fallback
    if gemini_key and gemini_key != "your_gemini_api_key_here":
        result = _call_gemini(event, branch, rule_rationale, gemini_key)
        if result:
            return {"explanation": result, "explanation_source": "gemini-1.5-flash"}

    # Template fallback
    return {
        "explanation": _template_explanation(event, branch, rule_rationale),
        "explanation_source": "template",
    }


def generate_explanations_batch(
    events: list,
    classifications: list,
    use_llm: bool = True,
    rate_limit_delay: float = 0.2,
) -> list:
    """
    Generate explanations for a full batch.
    Adds rate-limit delay between LLM calls to avoid throttling.
    """
    results = []
    for i, (event, clf) in enumerate(zip(events, classifications)):
        result = generate_explanation(
            event,
            clf["branch"],
            clf["rule_rationale"],
            use_llm=use_llm,
        )
        results.append(result)

        # Rate-limit only for real LLM calls
        if use_llm and result["explanation_source"] != "template" and i < len(events) - 1:
            time.sleep(rate_limit_delay)

        if (i + 1) % 50 == 0:
            source = result["explanation_source"]
            print(f"  LLM explainer: {i+1}/{len(events)} ({source})")

    return results
