import React, { useState } from 'react';
import { X, Play, RefreshCw, Zap, CheckCircle2 } from 'lucide-react';

const CODES = [
  { code:'Z9',  label:'Z9 — Low Balance (Soft Failure)' },
  { code:'U69', label:'U69 — Bank / NPCI Network Down' },
  { code:'U28', label:'U28 — UPI Server Timeout' },
  { code:'01',  label:'01 — Account Blocked / Closed (Hard Fail)' },
  { code:'06',  label:'06 — Mandate Revoked by Customer' },
  { code:'07',  label:'07 — Invalid Bank Credentials' },
];

const STATUSES = [
  { val:'ACTIVE',  label:'ACTIVE — Mandate valid & live' },
  { val:'PAUSED',  label:'PAUSED — Paused by customer' },
  { val:'REVOKED', label:'REVOKED — Customer revoked mandate' },
  { val:'EXPIRED', label:'EXPIRED — Mandate end-date passed' },
];

const PILL_MAP = {
  RECOVER:'pill-recover', WAIT:'pill-wait', REAUTHORIZE:'pill-reauth', STOP:'pill-stop', ESCALATE:'pill-escalate',
};

function evaluate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }) {
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

export default function LiveSimulatorModal({ isOpen, onClose }) {
  const [failureCode, setFailureCode] = useState('Z9');
  const [consecutiveFails, setConsecutiveFails] = useState(1);
  const [mandateStatus, setMandateStatus] = useState('ACTIVE');
  const [distinctCodes, setDistinctCodes] = useState(1);
  const [amount, setAmount] = useState(2999);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!isOpen) return null;

  const handleRun = () => {
    setLoading(true);
    setResult(null);
    setTimeout(() => {
      setResult(evaluate({ failureCode, consecutiveFails, mandateStatus, distinctCodes }));
      setLoading(false);
    }, 420);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.07) 0%, transparent 70%)' }} />

        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/[0.08]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: 'linear-gradient(135deg,#0ea5e9,#3b82f6)', boxShadow: '0 4px 16px rgba(59,130,246,0.4)' }}>
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-white">Live AI Decision Simulator</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Test any UPI mandate failure scenario against the 5-branch rule engine.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <div className="grid grid-cols-2 gap-3.5 mb-5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">NPCI Failure Reason</label>
              <select className="select w-full" value={failureCode} onChange={e => setFailureCode(e.target.value)}>
                {CODES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Mandate Status</label>
              <select className="select w-full" value={mandateStatus} onChange={e => setMandateStatus(e.target.value)}>
                {STATUSES.map(({ val, label }) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Consecutive Failures</label>
              <input type="number" min={1} max={10} className="input w-full font-mono" value={consecutiveFails}
                onChange={e => setConsecutiveFails(parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">Mandate Amount (₹)</label>
              <input type="number" min={100} step={100} className="input w-full font-mono" value={amount}
                onChange={e => setAmount(parseFloat(e.target.value) || 100)} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mb-4">
            <button onClick={onClose} className="btn btn-ghost text-[12px]">Cancel</button>
            <button onClick={handleRun} disabled={loading} className="btn btn-primary text-[12px]">
              {loading ? <><RefreshCw size={13} className="animate-spin-slow" /> Evaluating…</> : <><Play size={13} className="fill-current" /> Run AI Decision</>}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="border border-cyan-500/25 rounded-xl p-4 bg-white/[0.03]">
              <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/[0.07]">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Decision:</span>
                  <span className={`pill ${PILL_MAP[result.branch]}`}>{result.branch}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">Evaluated at {new Date().toLocaleTimeString()}</span>
              </div>

              <div className="font-bold text-[13px] text-white mb-1">{result.title}</div>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-3">{result.desc}</p>

              {result.branch === 'RECOVER' && result.retryDate && (
                <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                  <CheckCircle2 size={13} />
                  Next retry scheduled: <span className="font-mono">{result.retryDate}</span> (salary window)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
