import React, { useState, useMemo } from 'react';
import { Search, ChevronRight, ExternalLink } from 'lucide-react';

const PILL_MAP = {
  RECOVER:'pill-recover', WAIT:'pill-wait',
  REAUTHORIZE:'pill-reauth', STOP:'pill-stop', ESCALATE:'pill-escalate',
};
const CODE_MAP = {
  Z9: 'Insufficient Funds (Z9)',
  U69: 'PSP/Server Unavailable (U69)',
  U28: 'Remitter Bank Down (U28)',
  Z7: 'Velocity Limit Hit (Z7)',
  Z8: 'Per-Txn Limit (Z8)',
  '01': 'Account Closed (01)',
  '02': 'No Such Account (02)',
  '06': 'Customer Revoked (06)',
  '07': 'Court Order / Litigation (07)',
  MANDATE_PAUSED: 'Mandate Paused',
};
const BRANCH_HUMAN = {
  RECOVER: 'Retry on Salary Day',
  WAIT: 'Bank Cooldown',
  REAUTHORIZE: 'Send Re-Auth Link',
  STOP: 'Stop Retries',
  ESCALATE: 'Manual Review',
};

export default function AuditLogExplorer({ auditLog = [], onSelectEvent, activeBranchFilter }) {
  const [search,     setSearch]     = useState('');
  const [branch,     setBranch]     = useState(activeBranchFilter || 'ALL');
  const [code,       setCode]       = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');

  const rzpCount = useMemo(() => auditLog.filter(e => e._source === 'razorpay_live').length, [auditLog]);

  const filtered = useMemo(() => auditLog.filter(e => {
    const q = search.toLowerCase();
    const matchQ = !q
      || e.event_id?.toLowerCase().includes(q)
      || e.customer_id?.toLowerCase().includes(q)
      || e.failure_code?.toLowerCase().includes(q);
    const matchB = branch === 'ALL' || e.branch === branch || e.decision?.branch === branch;
    const matchC = code === 'ALL' || e.failure_code === code;
    const matchS = sourceFilter === 'ALL'
      || (sourceFilter === 'rzp' && e._source === 'razorpay_live')
      || (sourceFilter === 'synthetic' && e._source !== 'razorpay_live');
    return matchQ && matchB && matchC && matchS;
  }), [auditLog, search, branch, code, sourceFilter]);

  return (
    <div className="card p-5 card-glow-blue">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse-glow" />
            <h3 className="text-[13px] font-bold text-white">Mandate Audit Stream</h3>
            {rzpCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 border border-rose-500/40 text-rose-300">
                🔴 {rzpCount} Live Razorpay
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Append-only log of {auditLog.length} AI mandate decisions. Real Razorpay test-mode events
            are highlighted in red — verifiable via the Razorpay dashboard.
          </p>
        </div>
        <div className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[11px] font-mono text-slate-300 shrink-0">
          <span className="text-white font-bold">{filtered.length}</span> / {auditLog.length}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-12 gap-2.5 mb-4">
        <div className="col-span-5 relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input w-full pl-8 text-[12px]"
            placeholder="Search event ID, customer ID, NPCI code…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="col-span-2">
          <select className="select w-full text-[11px]" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            <option value="ALL">All Sources</option>
            <option value="rzp">🔴 Razorpay Live</option>
            <option value="synthetic">Synthetic Batch</option>
          </select>
        </div>
        <div className="col-span-3">
          <select className="select w-full text-[11px]" value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="ALL">All AI Actions</option>
            <option value="RECOVER">RECOVER — Salary Retry</option>
            <option value="WAIT">WAIT — Bank Cooldown</option>
            <option value="REAUTHORIZE">REAUTHORIZE — Re-Auth</option>
            <option value="STOP">STOP — Save Fees</option>
            <option value="ESCALATE">ESCALATE — Risk Review</option>
          </select>
        </div>
        <div className="col-span-2">
          <select className="select w-full text-[11px]" value={code} onChange={e => setCode(e.target.value)}>
            <option value="ALL">All NPCI Codes</option>
            <option value="Z9">Z9 — Insufficient Funds</option>
            <option value="U69">U69 — PSP Outage</option>
            <option value="U28">U28 — Bank Down</option>
            <option value="01">01 — Acct Closed</option>
            <option value="06">06 — Revoked</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              {['Source','Customer / Event','Amount','NPCI Reason','AI Action','Recommendation',''].map(h => (
                <th key={h} className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map(evt => {
              const b = evt.branch || evt.decision?.branch || 'UNKNOWN';
              const isLive = evt._source === 'razorpay_live';
              const orderId = evt.razorpay?.order_id;

              return (
                <tr key={evt.event_id} onClick={() => onSelectEvent?.(evt)}
                  className={`border-b border-white/[0.05] cursor-pointer transition-colors group
                    ${isLive ? 'hover:bg-rose-950/30' : 'hover:bg-white/[0.04]'}`}>

                  {/* Source badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {isLive ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-500/20 border border-rose-500/35 text-rose-300">
                          🔴 LIVE
                        </span>
                        {orderId && (
                          <span className="text-[9px] font-mono text-rose-400/70 truncate max-w-[72px]">
                            {orderId.slice(0, 16)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-700/60 border border-slate-600/30 text-slate-400">
                        SYNTHETIC
                      </span>
                    )}
                  </td>

                  {/* Event / Customer */}
                  <td className="py-2.5 px-3">
                    <div className={`text-[11px] font-bold font-mono leading-none ${isLive ? 'text-rose-200' : 'text-white'}`}>
                      {evt.event_id}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{evt.customer_id}</div>
                  </td>

                  {/* Amount */}
                  <td className="py-2.5 px-3 font-mono font-bold text-[13px] text-white whitespace-nowrap">
                    ₹{Number(evt.amount_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>

                  {/* NPCI code */}
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08] text-slate-200 font-mono text-[10px] font-bold">
                      {CODE_MAP[evt.failure_code] || evt.failure_code}
                    </span>
                  </td>

                  {/* Branch */}
                  <td className="py-2.5 px-3">
                    <span className={`pill ${PILL_MAP[b] || ''}`}>{BRANCH_HUMAN[b] || b}</span>
                  </td>

                  {/* Explanation */}
                  <td className="py-2.5 px-3 max-w-[200px]">
                    <span className="text-[10px] text-slate-300 leading-snug line-clamp-2">
                      {evt.explanation || evt.action?.details || '—'}
                    </span>
                  </td>

                  {/* Arrow */}
                  <td className="py-2.5 px-3 text-right">
                    <span className={`w-7 h-7 inline-flex items-center justify-center rounded-lg transition-all
                      ${isLive
                        ? 'bg-rose-900/30 group-hover:bg-rose-500/25 group-hover:text-rose-300 text-rose-500/60'
                        : 'bg-white/[0.04] group-hover:bg-cyan-500/20 group-hover:text-cyan-300 text-slate-500'}`}>
                      <ChevronRight size={13} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-slate-500 text-[12px]">No matching events found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-slate-500 mt-3 flex items-center gap-1.5">
        <ExternalLink size={10} />
        🔴 Live events have real Razorpay <code className="text-rose-400/80 font-mono">order_</code> IDs —
        verifiable at dashboard.razorpay.com → Orders (test mode)
      </p>
    </div>
  );
}
