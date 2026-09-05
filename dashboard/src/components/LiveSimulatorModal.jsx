import React, { useState } from 'react';
import { X, Play, RefreshCw, Zap, CheckCircle2, ShieldCheck, AlertTriangle, XCircle, FileText } from 'lucide-react';

const MANDATE_CODES = [
  { code:'Z9',  label:'Z9 — Low Balance (Soft Failure)' },
  { code:'U69', label:'U69 — Bank / NPCI Network Down' },
  { code:'U28', label:'U28 — UPI Server Timeout' },
  { code:'01',  label:'01 — Account Blocked / Closed (Hard Fail)' },
  { code:'06',  label:'06 — Mandate Revoked by Customer' },
  { code:'07',  label:'07 — Invalid Bank Credentials' },
];

const MANDATE_STATUSES = [
  { val:'ACTIVE',  label:'ACTIVE — Mandate valid & live' },
  { val:'PAUSED',  label:'PAUSED — Paused by customer' },
  { val:'REVOKED', label:'REVOKED — Customer revoked mandate' },
  { val:'EXPIRED', label:'EXPIRED — Mandate end-date passed' },
];

const REFUND_ARCHETYPES = [
  { val:'legitimate_high',       label:'Legitimate Claim — High Proof (Clear Damage & Serial Match)' },
  { val:'legitimate_medium',     label:'Legitimate Claim — Standard Valid Evidence' },
  { val:'ai_generated',          label:'AI-Generated / Deepfake Damage Photo' },
  { val:'manipulated_evidence',  label:'Manipulated Packaging / Photoshop Artifacts' },
  { val:'wrong_product_claim',    label:'Wrong Product Image Uploaded' },
  { val:'reused_evidence',       label:'Reused / Stolen Image from Previous Claim' },
  { val:'ordinary_abuse',        label:'Policy Abuse / Excessive Refund Remorse' },
];

const PILL_MAP = {
  RECOVER:'pill-recover', WAIT:'pill-wait', REAUTHORIZE:'pill-reauth', STOP:'pill-stop', ESCALATE:'pill-escalate',
};

function evaluateMandate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }) {
  if (['U69','U28'].includes(failureCode))
    return { branch:'WAIT', title:'Apply 30min–4hr Cooldown', desc:'Bank/NPCI infrastructure is temporarily down. Zero retries wasted. Auto-retry after recovery window.', retryDate: null };
  if (['01','02','07'].includes(failureCode) || (failureCode === 'Z9' && consecutiveFails >= 3))
    return { branch:'STOP', title:'Halt All Retries — Save Gateway Fees', desc:`Hard failure condition met (${failureCode === 'Z9' ? `${consecutiveFails} consecutive Z9` : `Code ${failureCode}`}). Each saved retry = ₹2 avoided.`, retryDate: null };
  if (['PAUSED','REVOKED','EXPIRED'].includes(mandateStatus) || failureCode === '06')
    return { branch:'REAUTHORIZE', title:'Dispatch WhatsApp 1-Click Re-Auth', desc:`Mandate is ${mandateStatus}. Customer re-authorization required before collection can resume.`, retryDate: null };
  if (distinctCodes >= 3)
    return { branch:'ESCALATE', title:'Flag for Human Risk Review', desc:`${distinctCodes} distinct failure codes in 90 days signals abnormal account behaviour.`, retryDate: null };
  return { branch:'RECOVER', title:'Schedule Salary-Window Auto-Retry', desc:`Soft failure (Z9 attempt ${consecutiveFails}). Retry queued for customer's peak salary credit day.`, retryDate:'2026-09-03' };
}

function evaluateRefund({ archetype, amount }) {
  switch (archetype) {
    case 'legitimate_high':
    case 'legitimate_medium':
      return {
        decision: 'APPROVED',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        title: 'Auto-Approve Refund Request',
        confidence: 96,
        desc: `Valid evidence provided. Serial number matched original dispatch manifest. Image hash clean. Instant refund of ₹${amount.toLocaleString()} processed.`,
      };
    case 'ai_generated':
      return {
        decision: 'VERIFY',
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        title: 'Require Live Video Proof (AI Synthetic Artifacts Detected)',
        confidence: 42,
        desc: `Diffusion AI spectral artifacts detected in uploaded damage photo. Automatic refund paused. Interoperable SMS link sent requesting live camera capture.`,
      };
    case 'manipulated_evidence':
    case 'reused_evidence':
    case 'wrong_product_claim':
      return {
        decision: 'MANUAL_REVIEW',
        badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        title: 'Block Refund & Flag for Risk Review',
        confidence: 15,
        desc: `Evidence verification failed: image matching confirmed photo was ${archetype === 'reused_evidence' ? 'stolen from a prior 2025 claim' : 'digitally manipulated / wrong item'}. Saved ₹${amount.toLocaleString()} claim payout.`,
      };
    default:
      return {
        decision: 'MANUAL_REVIEW',
        badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        title: 'Flag Policy Farming for Human Audit',
        confidence: 38,
        desc: `Customer refund frequency (4th claim in 30 days) exceeds policy threshold. Escalated to merchant risk queue.`,
      };
  }
}

export default function LiveSimulatorModal({ isOpen, onClose }) {
  const [mode, setMode] = useState('mandate'); // 'mandate' or 'refund'

  // Mandate State
  const [failureCode, setFailureCode] = useState('Z9');
  const [consecutiveFails, setConsecutiveFails] = useState(1);
  const [mandateStatus, setMandateStatus] = useState('ACTIVE');
  const [distinctCodes, setDistinctCodes] = useState(1);
  const [mandateAmount, setMandateAmount] = useState(2999);

  // Refund State
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
        setResult({ type: 'mandate', data: evaluateMandate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }) });
      } else {
        setResult({ type: 'refund', data: evaluateRefund({ archetype: refundArchetype, amount: refundAmount }) });
      }
      setLoading(false);
    }, 420);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }} />

        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)', boxShadow: '0 4px 16px rgba(139,92,246,0.4)' }}>
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-white">Live AI Decision Simulator</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Test real-time scenarios against Mandate Retry AI and Refund Verification AI.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center gap-2 mb-5 p-1 bg-white/[0.04] rounded-xl border border-white/[0.06]">
            <button
              onClick={() => { setMode('mandate'); setResult(null); }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                mode === 'mandate' ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> UPI Mandate Recovery Engine
            </button>
            <button
              onClick={() => { setMode('refund'); setResult(null); }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                mode === 'refund' ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" /> RefundGuard AI Evidence Verification
            </button>
          </div>

          {/* Form */}
          {mode === 'mandate' ? (
            <div className="grid grid-cols-2 gap-3.5 mb-5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">NPCI Failure Reason</label>
                <select className="select w-full text-xs" value={failureCode} onChange={e => setFailureCode(e.target.value)}>
                  {MANDATE_CODES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Mandate Status</label>
                <select className="select w-full text-xs" value={mandateStatus} onChange={e => setMandateStatus(e.target.value)}>
                  {MANDATE_STATUSES.map(({ val, label }) => <option key={val} value={val}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Consecutive Failures</label>
                <input type="number" min={1} max={10} className="input w-full font-mono text-xs" value={consecutiveFails}
                  onChange={e => setConsecutiveFails(parseInt(e.target.value) || 1)} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Mandate Amount (₹)</label>
                <input type="number" min={100} step={100} className="input w-full font-mono text-xs" value={mandateAmount}
                  onChange={e => setMandateAmount(parseFloat(e.target.value) || 100)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 mb-5">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Refund Claim Archetype / Evidence</label>
                <select className="select w-full text-xs" value={refundArchetype} onChange={e => setRefundArchetype(e.target.value)}>
                  {REFUND_ARCHETYPES.map(({ val, label }) => <option key={val} value={val}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Refund Amount (₹)</label>
                <input type="number" min={100} step={100} className="input w-full font-mono text-xs" value={refundAmount}
                  onChange={e => setRefundAmount(parseFloat(e.target.value) || 100)} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Evidence Verification</label>
                <div className="input w-full text-xs text-purple-300 font-mono flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-purple-400" /> Multi-modal Evidence Active
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mb-4">
            <button onClick={onClose} className="btn btn-ghost text-[12px]">Cancel</button>
            <button onClick={handleRun} disabled={loading} className="btn btn-primary text-[12px]">
              {loading ? <><RefreshCw size={13} className="animate-spin-slow" /> Evaluating AI…</> : <><Play size={13} className="fill-current" /> Run AI Simulator</>}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="border border-purple-500/25 rounded-xl p-4 bg-white/[0.03]">
              {result.type === 'mandate' ? (
                <>
                  <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.07]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Mandate Decision:</span>
                      <span className={`pill ${PILL_MAP[result.data.branch]}`}>{result.data.branch}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">Evaluated at {new Date().toLocaleTimeString()}</span>
                  </div>
                  <div className="font-bold text-[13px] text-white mb-1">{result.data.title}</div>
                  <p className="text-[11px] text-slate-300 leading-relaxed mb-3">{result.data.desc}</p>
                  {result.data.branch === 'RECOVER' && result.data.retryDate && (
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 size={13} />
                      Next retry scheduled: <span className="font-mono">{result.data.retryDate}</span> (salary window)
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.07]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Refund Outcome:</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${result.data.badgeClass}`}>
                        {result.data.decision}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-purple-300 font-bold">
                      Evidence Score: {result.data.confidence}%
                    </span>
                  </div>
                  <div className="font-bold text-[13px] text-white mb-1">{result.data.title}</div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{result.data.desc}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
