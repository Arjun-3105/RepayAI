import React, { useState, useEffect, useMemo } from 'react';
import {
  X, MessageSquare, Terminal, ChevronRight,
  TrendingUp, RotateCcw, ShieldCheck, AlertOctagon
} from 'lucide-react';

import EvilProbabilityChart from './components/EvilProbabilityChart';
import EvilConfusionMatrix from './components/EvilConfusionMatrix';
import EvilRevenueFunnel from './components/EvilRevenueFunnel';
import LiveSimulatorModal from './components/LiveSimulatorModal';
import AuditLogExplorer from './components/AuditLogExplorer';
import RefundGuardExplorer from './components/RefundGuardExplorer';

const FALLBACK = {
  meta: { total_events: 300, total_amount_inr: 960892.04 },
  overall_accuracy: 0.9833,
  amount_by_branch: { RECOVER: 407526.96, REAUTHORIZE: 106999.09, STOP: 232899.49, WAIT: 133586.79, ESCALATE: 79879.71 },
  count_by_branch: { RECOVER: 135, REAUTHORIZE: 36, STOP: 70, WAIT: 34, ESCALATE: 25 },
  retries_avoided: { total: 131, estimated_inr_saved: 262.0 },
  branch_metrics: {
    RECOVER: { precision: 1.0, recall: 1.0, f1: 1.0 },
    WAIT: { precision: 0.8824, recall: 1.0, f1: 0.9375 },
    STOP: { precision: 0.9857, recall: 1.0, f1: 0.9928 },
    REAUTHORIZE: { precision: 1.0, recall: 1.0, f1: 1.0 },
    ESCALATE: { precision: 1.0, recall: 0.8333, f1: 0.9091 },
  },
  confusion_matrix: {
    WAIT: { WAIT: 30, STOP: 0, REAUTHORIZE: 0, ESCALATE: 0, RECOVER: 0 },
    STOP: { WAIT: 0, STOP: 69, REAUTHORIZE: 0, ESCALATE: 0, RECOVER: 0 },
    REAUTHORIZE: { WAIT: 0, STOP: 0, REAUTHORIZE: 36, ESCALATE: 0, RECOVER: 0 },
    ESCALATE: { WAIT: 4, STOP: 1, REAUTHORIZE: 0, ESCALATE: 25, RECOVER: 0 },
    RECOVER: { WAIT: 0, STOP: 0, REAUTHORIZE: 0, ESCALATE: 0, RECOVER: 135 },
  },
  sample_recover_event: {
    event_id: 'evt_cust_0001_014', customer_id: 'cust_0001',
    amount_inr: 3634.66, failure_code: 'Z9',
    historical_success_days_of_month: [1, 2, 3, 4, 5],
    probability_curve: {
      '1': 0.1474, '2': 0.1992, '3': 0.2134, '4': 0.1992, '5': 0.1474,
      '6': 0.0713, '7': 0.0193, '8': 0.0027, '9': 0.0002, '10': 0,
      '11': 0, '12': 0, '13': 0, '14': 0
    },
    explanation: 'Customer cust_0001 has a 93% historical success rate with salary credited on Days 1–5. Current Z9 (low-balance) failure is outside this window. Retry has been scheduled for Day 3 of next cycle — aligning to the KDE peak likelihood date, maximising recovery of ₹3,634.66.',
  },
};

const NAV_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'kde',      label: 'Salary Kernel' },
  { id: 'matrix',   label: 'Accuracy Matrix' },
  { id: 'audit',    label: 'Audit Ledger' },
  { id: 'refund',   label: 'Refund Forensics' },
];

export default function App() {
  const [data, setData] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  /* Keyboard shortcut ⌘K / Ctrl+K */
  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSimulatorOpen(p => !p);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  useEffect(() => {
    fetch('/api/summary.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});

    fetch('/api/audit_log.jsonl')
      .then(r => r.ok ? r.text() : '')
      .then(t => {
        const rows = t
          .split('\n')
          .filter(Boolean)
          .map(l => {
            try { return JSON.parse(l); } catch { return null; }
          })
          .filter(Boolean);
        setAuditLog(rows);
      })
      .catch(() => {});
  }, []);

  const D = data ?? FALLBACK;
  const totalVol = D.meta.total_amount_inr;
  const accuracy = (D.overall_accuracy * 100).toFixed(1);
  const recovered = D.amount_by_branch.RECOVER;
  const retriesSaved = D.retries_avoided.total;
  const rzpCount = useMemo(() => auditLog.filter(e => e._source === 'razorpay_live').length, [auditLog]);

  const kpis = [
    {
      label: 'Failed Volume Evaluated',
      value: `₹${(totalVol / 1e5).toFixed(2)}L`,
      sub: '300 mandate failure vectors',
      delta: '100% Deterministic',
      deltaColor: 'text-zinc-400',
      icon: TrendingUp,
      accent: 'text-white',
    },
    {
      label: 'Recoverable Volume',
      value: `₹${(recovered / 1e5).toFixed(2)}L`,
      sub: 'Aligned to payday peaks via KDE',
      delta: '135 Mandates Queued',
      deltaColor: 'text-emerald-400',
      icon: RotateCcw,
      accent: 'text-emerald-400',
    },
    {
      label: 'Decision Precision',
      value: `${accuracy}%`,
      sub: 'Evaluated vs blind ground-truth',
      delta: '0% False Recovers',
      deltaColor: 'text-sky-400',
      icon: ShieldCheck,
      accent: 'text-sky-300',
    },
    {
      label: 'Wasted Retries Saved',
      value: `${retriesSaved}`,
      sub: `₹${D.retries_avoided.estimated_inr_saved} gateway penalty fees saved`,
      delta: 'Deflected from Gateway',
      deltaColor: 'text-purple-400',
      icon: AlertOctagon,
      accent: 'text-purple-300',
    },
  ];

  return (
    <div className="min-h-screen bg-[#040507] text-[#f4f4f7] font-sans antialiased selection:bg-white selection:text-black">

      {/* ─── Top Executive Glass Header ─── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#040507]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          
          {/* Brand Mark */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-white/15 flex items-center justify-center text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]">
              <svg viewBox="0 0 374 313" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 text-white">
                <path d="M247 181L237.5 236.5L373.5 313L247 181Z" fill="currentColor" />
                <path d="M187.5 0L154 209L173.5 195L237.5 83L187.5 0Z" fill="currentColor" />
                <path d="M373.5 313L253.761 110.5L197.5 195L237.5 181L212.5 222L0 313H187.5L237.5 236.5L247 181L373.5 313Z" fill="currentColor" />
                <path d="M187.5 0L0 313L154 209L187.5 0Z" fill="currentColor" />
              </svg>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-orbitron font-bold text-base tracking-wider text-white">
                VENGEANCE
              </span>
              <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hidden sm:inline">
                RECOVERABILITY
              </span>
            </div>
          </div>

          {/* Centered Luxury Tab Dock */}
          <div className="hidden md:inline-flex p-1 rounded-lg bg-white/[0.035] border border-white/[0.08] backdrop-blur-md">
            {NAV_TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                    active
                      ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] font-semibold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Actions & Live Telemetry */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs font-mono text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE_KERNEL</span>
              {rzpCount > 0 && (
                <span className="text-rose-400 font-semibold border-l border-white/10 pl-2">
                  {rzpCount} RZP HOOKS
                </span>
              )}
            </div>

            <button
              onClick={() => setSimulatorOpen(true)}
              className="btn-luxe-primary"
            >
              <Terminal size={13} />
              <span>Sandbox</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-black/10 text-black">
                ⌘K
              </kbd>
            </button>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden flex overflow-x-auto px-4 py-2 border-t border-white/[0.06] gap-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap px-3 py-1 rounded-md text-xs font-medium transition ${
                  active
                    ? 'bg-white text-black font-semibold'
                    : 'text-zinc-400 hover:text-white bg-white/[0.03] border border-white/[0.08]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── Hero Executive Section ─── */}
      <section className="relative overflow-hidden pt-12 pb-8 border-b border-white/[0.07] luxe-grid">
        <div className="pointer-events-none absolute inset-0 luxe-glow" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-8">
            <div className="max-w-2xl space-y-3">
              
              {/* Border Beam Chip */}
              <div className="border-beam-badge inline-flex items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-1 text-xs text-zinc-300 font-mono backdrop-blur-md">
                <span className="text-white font-bold">▲ RECOVERABILITY MATRIX</span>
                <span className="text-zinc-600">·</span>
                <span>NPCI UPI AUTOPAY SPEC 2.4</span>
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
                Precision Mandate Recovery &{' '}
                <span className="bg-gradient-to-r from-zinc-100 via-zinc-300 to-zinc-500 bg-clip-text text-transparent">
                  Telemetry Kernel.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-zinc-400 font-normal leading-relaxed max-w-xl">
                Deterministic NPCI failure triage, Bayesian salary-window optimization, and multimodal refund verification for Razorpay recurring collections.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 font-mono text-xs">
              <button
                onClick={() => setActiveTab('audit')}
                className="btn-luxe-secondary justify-between"
              >
                <span>EXPLORE AUDIT LEDGER</span>
                <ChevronRight size={13} className="text-zinc-500" />
              </button>
              <button
                onClick={() => setSimulatorOpen(true)}
                className="btn-luxe-secondary justify-between border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
              >
                <span>OPEN DECISION SANDBOX (⌘K)</span>
                <Terminal size={13} />
              </button>
            </div>
          </div>

          {/* ─── 4 Executive KPI Cards ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {kpis.map(k => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="luxe-card specular-line p-5 group">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                      {k.label}
                    </span>
                    <Icon size={14} className="text-zinc-500 group-hover:text-white transition-colors" />
                  </div>
                  <div className={`font-mono text-3xl font-bold tracking-tight ${k.accent}`}>
                    {k.value}
                  </div>
                  <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-white/[0.05]">
                    <span className="text-zinc-500 text-[11px] truncate">{k.sub}</span>
                    <span className={`font-mono text-[10px] font-semibold ${k.deltaColor} shrink-0`}>
                      {k.delta}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Main Content Canvas ─── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Live Razorpay Banner */}
        {rzpCount > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-rose-500/30 bg-[#0e070b]/60 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_12px_32px_rgba(244,63,94,0.06)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg border border-rose-500/40 bg-rose-500/10 flex items-center justify-center text-rose-400 font-mono text-xs shrink-0">
                ●
              </div>
              <div>
                <h4 className="text-xs font-bold text-rose-200 font-mono">
                  {rzpCount} REAL RAZORPAY TEST-MODE WEBHOOKS SYNCED
                </h4>
                <p className="text-[11px] text-rose-300/80 font-mono mt-0.5">
                  Verifiable via Razorpay Dashboard → Orders (test mode) with matching <code className="text-white">order_</code> tokens.
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('audit')}
              className="btn-luxe-secondary text-xs border-rose-500/40 text-rose-300 hover:bg-rose-950/40 shrink-0 font-mono"
            >
              FILTER LIVE LOGS →
            </button>
          </div>
        )}

        {/* Tab: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <EvilRevenueFunnel
              amountByBranch={D.amount_by_branch}
              countByBranch={D.count_by_branch}
              retriesAvoided={D.retries_avoided}
              totalAmount={totalVol}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <EvilProbabilityChart sampleEvent={D.sample_recover_event} />
              <EvilConfusionMatrix
                matrixData={D.confusion_matrix}
                branchMetrics={D.branch_metrics}
                onSelectBranch={b => {
                  setBranchFilter(b);
                  setActiveTab('audit');
                }}
              />
            </div>

            <AuditLogExplorer
              auditLog={auditLog}
              activeBranchFilter={branchFilter}
              onSelectEvent={setSelectedEvent}
            />
          </div>
        )}

        {/* Tab: Salary Kernel */}
        {activeTab === 'kde' && (
          <div className="space-y-6">
            <EvilProbabilityChart sampleEvent={D.sample_recover_event} />
            <AuditLogExplorer
              auditLog={auditLog.filter(e => (e.branch || e.decision?.branch) === 'RECOVER')}
              onSelectEvent={setSelectedEvent}
            />
          </div>
        )}

        {/* Tab: Accuracy Matrix */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            <EvilConfusionMatrix
              matrixData={D.confusion_matrix}
              branchMetrics={D.branch_metrics}
              onSelectBranch={b => {
                setBranchFilter(b);
                setActiveTab('audit');
              }}
            />
          </div>
        )}

        {/* Tab: Audit Ledger */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <AuditLogExplorer
              auditLog={auditLog}
              activeBranchFilter={branchFilter}
              onSelectEvent={setSelectedEvent}
            />
          </div>
        )}

        {/* Tab: Refund Forensics */}
        {activeTab === 'refund' && (
          <div className="space-y-6">
            <RefundGuardExplorer />
          </div>
        )}
      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-white/[0.07] bg-[#040507] py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="font-orbitron font-bold text-white tracking-wider">VENGEANCE</span>
            <span>// AUTONOMOUS UPI AUTOPAY RECOVERABILITY KERNEL</span>
          </div>
          <div className="text-[11px]">
            KERNEL V2.4 · 300 EVALUATED EVENTS · ZERO RECURSION FAULTS
          </div>
        </div>
      </footer>

      {/* ─── Simulator Modal ─── */}
      <LiveSimulatorModal
        isOpen={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
      />

      {/* ─── Event Inspector Modal ─── */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 bg-[#040507]/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="luxe-card specular-line w-full max-w-lg p-6 bg-[#090a0f] shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/[0.08]">
              <div>
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                  TELEMETRY_RECORD
                </span>
                <h3 className="font-mono text-base font-bold text-white mt-0.5">
                  {selectedEvent.event_id}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="w-7 h-7 rounded-md border border-white/[0.08] bg-white/[0.04] flex items-center justify-center text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>

            {/* Metrics */}
            <div className="space-y-2 font-mono text-xs mb-4">
              {[
                ['Customer UUID', selectedEvent.customer_id, 'text-white'],
                ['Mandate Amount', `₹${Number(selectedEvent.amount_inr || 0).toLocaleString('en-IN')}`, 'text-emerald-400 font-bold'],
                ['NPCI Error Code', selectedEvent.failure_code, 'text-rose-400 font-bold'],
                ['Triage Decision', selectedEvent.decision?.branch || selectedEvent.branch, 'text-cyan-300 font-bold'],
              ].map(([k, v, cls]) => (
                <div
                  key={k}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02]"
                >
                  <span className="text-zinc-500 text-[11px]">{k}</span>
                  <span className={cls}>{v}</span>
                </div>
              ))}
            </div>

            {/* Explanation */}
            <div className="p-3.5 rounded-lg border border-white/[0.06] bg-white/[0.02] font-mono text-xs text-zinc-400 leading-relaxed mb-4">
              <span className="text-white font-bold block mb-1 uppercase text-[10px]">
                Deterministic Decision Log:
              </span>
              {selectedEvent.explanation || selectedEvent.action?.details || 'Standard decision routing applied based on customer history and NPCI code rules.'}
            </div>

            {/* WhatsApp Nudge for REAUTHORIZE */}
            {(selectedEvent.decision?.branch === 'REAUTHORIZE' || selectedEvent.branch === 'REAUTHORIZE') && (
              <div className="p-3.5 rounded-lg border border-purple-500/30 bg-[#0f0914] text-xs font-mono">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-purple-300 mb-1 uppercase">
                  <MessageSquare size={12} /> Dispatched Re-Auth Link
                </div>
                <p className="text-[11px] text-purple-200 leading-relaxed">
                  "Aapka ₹{Number(selectedEvent.amount_inr || 0).toLocaleString('en-IN')} AutoPay expire ho gaya hai. 1-click se re-link karein: rzp.io/reauth/{selectedEvent.event_id?.slice(-6)}"
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
