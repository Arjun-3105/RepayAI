import React, { useState, useMemo } from 'react';
import { Search, ChevronRight, ExternalLink } from 'lucide-react';

const BADGE_MAP = {
  RECOVER: 'luxe-badge-recover',
  WAIT: 'luxe-badge-wait',
  REAUTHORIZE: 'luxe-badge-reauth',
  STOP: 'luxe-badge-stop',
  ESCALATE: 'luxe-badge-escalate',
};

const CODE_MAP = {
  Z9: 'Low Balance (Z9)',
  U69: 'PSP Outage (U69)',
  U28: 'Remitter Down (U28)',
  Z7: 'Velocity Limit (Z7)',
  Z8: 'Per-Txn Limit (Z8)',
  '01': 'Closed (01)',
  '02': 'No Account (02)',
  '06': 'Revoked (06)',
  '07': 'Litigation (07)',
};

const BRANCH_HUMAN = {
  RECOVER: 'SALARY RETRY',
  WAIT: 'COOLDOWN',
  REAUTHORIZE: 'REAUTH LINK',
  STOP: 'HALT RETRIES',
  ESCALATE: 'RISK DESK',
};

export default function AuditLogExplorer({ auditLog = [], onSelectEvent, activeBranchFilter }) {
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState(activeBranchFilter || 'ALL');
  const [code, setCode] = useState('ALL');
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

  const categories = [
    { id: 'ALL', label: 'All Pipelines' },
    { id: 'RECOVER', label: 'Salary Retry' },
    { id: 'WAIT', label: 'Bank Cooldown' },
    { id: 'REAUTHORIZE', label: 'Re-Auth Link' },
    { id: 'STOP', label: 'Halt Retries' },
    { id: 'ESCALATE', label: 'Risk Desk' },
  ];

  return (
    <div className="luxe-card specular-line p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 mb-5 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
              TELEMETRY // EXECUTION LEDGER
            </span>
          </div>
          <h3 className="font-display text-xl font-bold tracking-tight text-white mt-1">
            Mandate Audit Ledger
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Append-only event log of {auditLog.length} evaluated mandate failure events.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          {rzpCount > 0 && (
            <button
              onClick={() => setSourceFilter(sourceFilter === 'rzp' ? 'ALL' : 'rzp')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                sourceFilter === 'rzp'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm'
                  : 'bg-white/[0.03] text-zinc-400 border-white/[0.08] hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
              <span>{rzpCount} Live RZP Hooks</span>
            </button>
          )}

          <div className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300">
            <span className="text-white font-bold">{filtered.length}</span> / {auditLog.length} Events
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden font-mono text-xs">
        {categories.map(cat => {
          const isActive = branch === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setBranch(cat.id)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer border ${
                isActive
                  ? 'border-white bg-white text-black font-semibold shadow-sm'
                  : 'border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/[0.16] bg-white/[0.02]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Filters Form */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-5 font-mono">
        <div className="sm:col-span-6 relative">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="luxe-input w-full pl-9 text-xs font-mono"
            placeholder="Search event ID, customer UUID, or NPCI code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="sm:col-span-3">
          <select
            className="luxe-select w-full text-xs font-mono"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
          >
            <option value="ALL">All Event Origins</option>
            <option value="rzp">Razorpay Test Hooks</option>
            <option value="synthetic">Synthetic Vectors</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <select
            className="luxe-select w-full text-xs font-mono"
            value={code}
            onChange={e => setCode(e.target.value)}
          >
            <option value="ALL">All Failure Reasons</option>
            <option value="Z9">Z9 — Low Balance</option>
            <option value="U69">U69 — PSP Outage</option>
            <option value="U28">U28 — Bank Timeout</option>
            <option value="01">01 — Closed Account</option>
            <option value="06">06 — Mandate Revoked</option>
          </select>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.015]">
        <table className="w-full text-left border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] text-zinc-400 uppercase tracking-wider">
              <th className="py-3 px-4">ORIGIN</th>
              <th className="py-3 px-4">EVENT ID / CUSTOMER</th>
              <th className="py-3 px-4">AMOUNT</th>
              <th className="py-3 px-4">NPCI CODE</th>
              <th className="py-3 px-4">ACTION ROUTED</th>
              <th className="py-3 px-4">CONTEXT</th>
              <th className="py-3 px-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.slice(0, 50).map(evt => {
              const b = evt.branch || evt.decision?.branch || 'UNKNOWN';
              const isLive = evt._source === 'razorpay_live';
              const orderId = evt.razorpay?.order_id;

              return (
                <tr
                  key={evt.event_id}
                  onClick={() => onSelectEvent?.(evt)}
                  className="cursor-pointer hover:bg-white/[0.04] transition-colors group"
                >
                  {/* Origin */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {isLive ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          LIVE RZP
                        </span>
                        {orderId && (
                          <span className="font-mono text-[9px] text-zinc-500 truncate max-w-[80px]">
                            {orderId}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono text-zinc-500 border border-white/[0.06] bg-white/[0.02]">
                        SYNTH
                      </span>
                    )}
                  </td>

                  {/* IDs */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-mono text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {evt.event_id}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-500">{evt.customer_id}</div>
                  </td>

                  {/* Amount */}
                  <td className="py-3 px-4 font-mono font-bold text-white whitespace-nowrap">
                    ₹{Number(evt.amount_inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>

                  {/* NPCI Code */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="font-mono text-xs text-zinc-300 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.08]" title={CODE_MAP[evt.failure_code]}>
                      {CODE_MAP[evt.failure_code] || evt.failure_code}
                    </span>
                  </td>

                  {/* Branch */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`luxe-badge ${BADGE_MAP[b] || ''}`}>
                      {BRANCH_HUMAN[b] || b}
                    </span>
                  </td>

                  {/* Explanation snippet */}
                  <td className="py-3 px-4 max-w-xs truncate text-zinc-400 text-[11px]">
                    {evt.explanation || evt.action?.details || '—'}
                  </td>

                  {/* Action link */}
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-400 group-hover:text-white group-hover:border-white/20 transition">
                      <ChevronRight size={13} />
                    </span>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-zinc-500 text-xs font-mono">
                  No matching telemetry records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-zinc-500">
        <span>Displaying 50 of {filtered.length} events</span>
        <span className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition">
          <ExternalLink size={11} /> Razorpay API Test Mode Environment
        </span>
      </div>
    </div>
  );
}
