import React, { useState } from 'react';
import { X, Play, RefreshCw, Zap, CheckCircle2, ShieldCheck, FileText } from 'lucide-react';

const MANDATE_CODES = [
  { code: 'Z9',  label: 'Z9 — Low Balance (Soft Failure)' },
  { code: 'U69', label: 'U69 — Bank / NPCI Network Down' },
  { code: 'U28', label: 'U28 — UPI Server Timeout' },
  { code: '01',  label: '01 — Account Blocked / Closed (Hard Fail)' },
  { code: '06',  label: '06 — Mandate Revoked by Customer' },
  { code: '07',  label: '07 — Invalid Bank Credentials' },
];

const MANDATE_STATUSES = [
  { val: 'ACTIVE',  label: 'ACTIVE — Mandate valid & live' },
  { val: 'PAUSED',  label: 'PAUSED — Paused by customer' },
  { val: 'REVOKED', label: 'REVOKED — Customer revoked mandate' },
  { val: 'EXPIRED', label: 'EXPIRED — Mandate end-date passed' },
];

const REFUND_ARCHETYPES = [
  { val: 'legitimate_high',      label: 'Legitimate Claim — High Proof (Clear Damage & Serial Match)' },
  { val: 'legitimate_medium',    label: 'Legitimate Claim — Standard Valid Evidence' },
  { val: 'ai_generated',         label: 'AI-Generated / Deepfake Damage Photo' },
  { val: 'manipulated_evidence', label: 'Manipulated Packaging / Photoshop Artifacts' },
  { val: 'wrong_product_claim',   label: 'Wrong Product Image Uploaded' },
  { val: 'reused_evidence',      label: 'Reused / Stolen Image from Previous Claim' },
  { val: 'ordinary_abuse',       label: 'Policy Abuse / Excessive Refund Remorse' },
];

const BADGE_MAP = {
  RECOVER: 'luxe-badge-recover',
  WAIT: 'luxe-badge-wait',
  REAUTHORIZE: 'luxe-badge-reauth',
  STOP: 'luxe-badge-stop',
  ESCALATE: 'luxe-badge-escalate',
};

function evaluateMandate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }) {
  if (['U69', 'U28'].includes(failureCode)) {
    return {
      branch: 'WAIT',
      title: 'Apply Infrastructure Cooldown (30m–4h)',
      desc: 'NPCI / Remitter bank infrastructure is temporarily down. Retries paused without penalty.',
      retryDate: null,
    };
  }
  if (['01', '02', '07'].includes(failureCode) || (failureCode === 'Z9' && consecutiveFails >= 3)) {
    return {
      branch: 'STOP',
      title: 'Halt Retries — Prevent Gateway Waste',
      desc: `Permanent failure detected (${failureCode === 'Z9' ? `${consecutiveFails} consecutive Z9s` : `Code ${failureCode}`}). Avoided ₹2 fee per wasted attempt.`,
      retryDate: null,
    };
  }
  if (['PAUSED', 'REVOKED', 'EXPIRED'].includes(mandateStatus) || failureCode === '06') {
    return {
      branch: 'REAUTHORIZE',
      title: 'Dispatch 1-Click Mandate Re-Auth Link',
      desc: `Mandate status is ${mandateStatus}. Requires customer re-authorization prior to next charge attempt.`,
      retryDate: null,
    };
  }
  if (distinctCodes >= 3) {
    return {
      branch: 'ESCALATE',
      title: 'Escalate to Risk Desk Review',
      desc: `${distinctCodes} distinct failure codes in 90 days indicates irregular account patterns.`,
      retryDate: null,
    };
  }
  return {
    branch: 'RECOVER',
    title: 'Schedule Bayesian Salary-Window Retry',
    desc: `Soft low-balance failure. Retry queued for customer's Bayesian peak salary credit day.`,
    retryDate: '2026-10-06',
  };
}

function evaluateRefund({ archetype, amount }) {
  switch (archetype) {
    case 'legitimate_high':
    case 'legitimate_medium':
      return {
        decision: 'APPROVED',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        title: 'Auto-Approve Refund Request',
        confidence: 96,
        desc: `Valid evidence verified. Dispatch serial number matches box photo. Payout of ₹${Number(amount).toLocaleString('en-IN')} approved.`,
      };
    case 'ai_generated':
      return {
        decision: 'VERIFY',
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        title: 'Require Live Video Verification',
        confidence: 42,
        desc: `Spectral diffusion artifacts detected in damage photograph. Link sent to customer for 10-second unboxing video.`,
      };
    case 'manipulated_evidence':
    case 'reused_evidence':
    case 'wrong_product_claim':
      return {
        decision: 'MANUAL_REVIEW',
        badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        title: 'Block Claim & Flag Abuse Pattern',
        confidence: 15,
        desc: `Evidence verification failed: image match confirmed identical photo was submitted on prior claim. Protected ₹${Number(amount).toLocaleString('en-IN')}.`,
      };
    default:
      return {
        decision: 'MANUAL_REVIEW',
        badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        title: 'Policy Frequency Limit Exceeded',
        confidence: 38,
        desc: `Customer claim velocity exceeds policy limits. Forwarded to operations desk for manual determination.`,
      };
  }
}

export default function LiveSimulatorModal({ isOpen, onClose }) {
  const [mode, setMode] = useState('mandate');
  const [failureCode, setFailureCode] = useState('Z9');
  const [consecutiveFails, setConsecutiveFails] = useState(1);
  const [mandateStatus, setMandateStatus] = useState('ACTIVE');
  const [distinctCodes, setDistinctCodes] = useState(1);
  const [mandateAmount, setMandateAmount] = useState(2999);

  const [refundArchetype, setRefundArchetype] = useState('ai_generated');
  const [refundAmount, setRefundAmount] = useState(4999);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!isOpen) return null;

  const handleRun = () => {
    setLoading(true);
    setResult(null);
    setTimeout(() => {
      if (mode === 'mandate') {
        setResult({
          type: 'mandate',
          data: evaluateMandate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }),
        });
      } else {
        setResult({
          type: 'refund',
          data: evaluateRefund({ archetype: refundArchetype, amount: refundAmount }),
        });
      }
      setLoading(false);
    }, 300);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#040507]/80 backdrop-blur-md flex items-center justify-center p-4 font-sans"
      onClick={onClose}
    >
      <div
        className="luxe-card specular-line w-full max-w-xl p-6 bg-[#090a0f] shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
                INTERACTIVE // SIMULATION SANDBOX
              </span>
            </div>
            <h3 className="font-display text-lg font-bold text-white mt-1">
              Decision Engine Sandbox
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        {/* Mode Selector (Segmented Dock) */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg border border-white/[0.08] bg-white/[0.02] mb-5">
          <button
            onClick={() => { setMode('mandate'); setResult(null); }}
            className={`py-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'mandate'
                ? 'bg-white text-black shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Zap size={13} /> AutoPay Mandate Engine
          </button>
          <button
            onClick={() => { setMode('refund'); setResult(null); }}
            className={`py-1.5 px-3 rounded-md text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'refund'
                ? 'bg-white text-black shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ShieldCheck size={13} /> RefundGuard Forensics
          </button>
        </div>

        {/* Form Inputs */}
        {mode === 'mandate' ? (
          <div className="grid grid-cols-2 gap-3.5 mb-5 font-mono">
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">NPCI FAILURE CODE</label>
              <select
                className="luxe-select w-full text-xs font-mono"
                value={failureCode}
                onChange={e => setFailureCode(e.target.value)}
              >
                {MANDATE_CODES.map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">MANDATE STATUS</label>
              <select
                className="luxe-select w-full text-xs font-mono"
                value={mandateStatus}
                onChange={e => setMandateStatus(e.target.value)}
              >
                {MANDATE_STATUSES.map(({ val, label }) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">CONSECUTIVE FAILS</label>
              <input
                type="number"
                min={1}
                max={10}
                className="luxe-input w-full font-mono text-xs"
                value={consecutiveFails}
                onChange={e => setConsecutiveFails(parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">DISTINCT CODES (90D)</label>
              <input
                type="number"
                min={1}
                max={5}
                className="luxe-input w-full font-mono text-xs"
                value={distinctCodes}
                onChange={e => setDistinctCodes(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">MANDATE AMOUNT (₹)</label>
              <input
                type="number"
                min={100}
                step={100}
                className="luxe-input w-full font-mono text-xs"
                value={mandateAmount}
                onChange={e => setMandateAmount(parseFloat(e.target.value) || 100)}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5 mb-5 font-mono">
            <div className="col-span-2">
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">EVIDENCE CLAIM ARCHETYPE</label>
              <select
                className="luxe-select w-full text-xs font-mono"
                value={refundArchetype}
                onChange={e => setRefundArchetype(e.target.value)}
              >
                {REFUND_ARCHETYPES.map(({ val, label }) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">CLAIM AMOUNT (₹)</label>
              <input
                type="number"
                min={100}
                step={100}
                className="luxe-input w-full font-mono text-xs"
                value={refundAmount}
                onChange={e => setRefundAmount(parseFloat(e.target.value) || 100)}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1.5 font-medium">FORENSIC PIPELINE</label>
              <div className="luxe-input w-full text-xs font-mono text-cyan-300 flex items-center gap-1.5">
                <FileText size={13} /> Multi-Modal Active
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 mb-3">
          <button onClick={onClose} className="btn-luxe-secondary text-xs">
            Abort
          </button>
          <button onClick={handleRun} disabled={loading} className="btn-luxe-primary text-xs">
            {loading ? (
              <>
                <RefreshCw size={13} className="animate-spin" /> Evaluating...
              </>
            ) : (
              <>
                <Play size={13} className="fill-current" /> Execute Triage
              </>
            )}
          </button>
        </div>

        {/* Result Preview */}
        {result && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <span className="font-mono text-[10px] uppercase text-zinc-400 font-medium">
                DETERMINATION RESULT
              </span>
              {result.type === 'mandate' ? (
                <span className={`luxe-badge ${BADGE_MAP[result.data.branch]}`}>
                  {result.data.branch}
                </span>
              ) : (
                <span className={`px-2.5 py-0.5 rounded border text-[10px] font-bold ${result.data.badgeClass}`}>
                  {result.data.decision}
                </span>
              )}
            </div>

            <div className="font-display text-sm font-bold text-white">
              {result.data.title}
            </div>
            <p className="text-zinc-400 leading-relaxed text-xs">{result.data.desc}</p>

            {result.data.retryDate && (
              <div className="pt-1.5 text-emerald-400 font-bold flex items-center gap-1.5 text-xs font-mono">
                <CheckCircle2 size={13} />
                NEXT RETRY DATE: <span className="text-white">{result.data.retryDate}</span> (Customer Payday Peak)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
