import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap, Activity, ShieldCheck, TrendingUp, RotateCcw,
  Sparkles, Layers, BarChart2, AlertOctagon, X,
  CheckCircle2, MessageSquare, Info, RefreshCw,
} from 'lucide-react';

import EvilProbabilityChart from './components/EvilProbabilityChart';
import EvilConfusionMatrix from './components/EvilConfusionMatrix';
import EvilRevenueFunnel from './components/EvilRevenueFunnel';
import LiveSimulatorModal from './components/LiveSimulatorModal';
import AuditLogExplorer from './components/AuditLogExplorer';

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
    WAIT: { WAIT:30, STOP:0, REAUTHORIZE:0, ESCALATE:0, RECOVER:0 },
    STOP: { WAIT:0, STOP:69, REAUTHORIZE:0, ESCALATE:0, RECOVER:0 },
    REAUTHORIZE: { WAIT:0, STOP:0, REAUTHORIZE:36, ESCALATE:0, RECOVER:0 },
    ESCALATE: { WAIT:4, STOP:1, REAUTHORIZE:0, ESCALATE:25, RECOVER:0 },
    RECOVER: { WAIT:0, STOP:0, REAUTHORIZE:0, ESCALATE:0, RECOVER:135 },
  },
  sample_recover_event: {
    event_id: 'evt_cust_0001_014', customer_id: 'cust_0001',
    amount_inr: 3634.66, failure_code: 'Z9',
    historical_success_days_of_month: [1,2,3,4,5],
    probability_curve: { '1':0.1474,'2':0.1992,'3':0.2134,'4':0.1992,'5':0.1474,'6':0.0713,'7':0.0193,'8':0.0027,'9':0.0002,'10':0,'11':0,'12':0,'13':0,'14':0 },
    explanation: 'Customer cust_0001 has a 93% historical success rate with salary credited on Days 1–5. Current Z9 (low-balance) failure is outside this window. Retry has been scheduled for Day 3 of next cycle — aligning to the KDE peak likelihood date, maximising recovery of ₹3,634.66.',
  },
};

const NAV = [
  { id: 'overview', icon: Activity,  label: 'Executive Dashboard' },
  { id: 'kde',      icon: Sparkles,  label: 'Smart Retry Planner' },
  { id: 'matrix',   icon: Layers,    label: 'AI Decision Matrix' },
  { id: 'audit',    icon: BarChart2, label: 'Audit Stream' },
];

export default function App() {
  const [data, setData] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  /* Keyboard shortcut ⌘K */
  useEffect(() => {
    const fn = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSimulatorOpen(p => !p); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const auditLog_filtered = useMemo(() =>
    branchFilter === 'ALL'
      ? auditLog
      : auditLog.filter(e => (e.branch || e.decision?.branch) === branchFilter),
    [auditLog, branchFilter]);

  useEffect(() => {
    fetch('/api/summary.json').then(r => r.ok ? r.json() : null).then(d => d && setData(d)).catch(() => {});
    fetch('/api/audit_log.jsonl').then(r => r.ok ? r.text() : '').then(t => {
      const rows = t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      setAuditLog(rows);
    }).catch(() => {});
  }, []);

  const D = data ?? FALLBACK;
  const totalVol = D.meta.total_amount_inr;
  const accuracy = (D.overall_accuracy * 100).toFixed(1);
  const recovered = D.amount_by_branch.RECOVER;
  const retriesSaved = D.retries_avoided.total;

  const kpis = [
    { label: 'Total Failed Volume', value: `₹${(totalVol/1e5).toFixed(2)}L`, sub: '300 failed UPI AutoPay mandates', color: 'text-cyan-400', glow: 'card-glow-blue',   icon: TrendingUp,   iconColor: 'text-cyan-400' },
    { label: 'Recoverable Volume',  value: `₹${(recovered/1e5).toFixed(2)}L`, sub: '135 mandates on salary-window retry', color: 'text-emerald-400', glow: 'card-glow-emerald', icon: RotateCcw, iconColor: 'text-emerald-400' },
    { label: 'Decision Accuracy',   value: `${accuracy}%`, sub: '100% deterministic classification', color: 'text-purple-300', glow: 'card-glow-purple', icon: ShieldCheck, iconColor: 'text-purple-400' },
    { label: 'Wasted Retries Saved', value: `${retriesSaved}`, sub: '₹262 hard gateway costs avoided', color: 'text-amber-300', glow: 'card-glow-amber',  icon: AlertOctagon, iconColor: 'text-amber-400' },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#06080f] mesh-grid radial-glow-top-left radial-glow-top-right relative">

      {/* ─── Sidebar ──────────────────────────────────── */}
      <aside className="w-[230px] shrink-0 flex flex-col h-full bg-[#080b14] border-r border-white/[0.08] z-20">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.07]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)', boxShadow: '0 0 20px rgba(139,92,246,0.4)' }}>
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-white leading-none tracking-tight">
              Razorpay <span className="text-cyan-400">AI</span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium tracking-widest mt-0.5 uppercase">
              Recoverability
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold px-2 mb-2">Dashboards</p>
          {NAV.map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setActiveTab(id)} className={`nav-item ${activeTab === id ? 'active' : ''}`}>
              <Icon size={15} className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Footer badge */}
        <div className="m-3 p-3 rounded-xl bg-slate-900/70 border border-white/[0.07] text-xs">
          <p className="text-slate-400 text-[11px]">Razorpay Buildathon</p>
          <p className="text-emerald-400 font-bold flex items-center gap-1.5 mt-0.5">
            <ShieldCheck size={12} /> Track 03 · AI Revenue Recovery
          </p>
        </div>
      </aside>

      {/* ─── Main ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header className="shrink-0 h-[58px] flex items-center justify-between px-6 border-b border-white/[0.07]"
                style={{ background: 'rgba(8,11,20,0.9)', backdropFilter: 'blur(12px)' }}>
          <div className="flex items-center gap-3">
            <h1 className="text-[15px] font-bold text-white tracking-tight">UPI AutoPay Mandate Intelligence</h1>
            <span className="chip chip-live">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
              Live Engine
            </span>
          </div>
          <button onClick={() => setSimulatorOpen(true)} className="btn btn-primary">
            <Zap size={14} />
            Run AI Simulator
            <kbd className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-mono font-bold">⌘K</kbd>
          </button>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 animate-fade-up">

          {/* KPI Row */}
          <div className="grid grid-cols-4 gap-4">
            {kpis.map(({ label, value, sub, color, glow, icon: Icon, iconColor }) => (
              <div key={label} className={`kpi-card ${glow}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">{label}</span>
                  <Icon size={15} className={iconColor} />
                </div>
                <div className={`text-2xl font-black tracking-tight font-mono ${color}`}>{value}</div>
                <div className="text-[11px] text-slate-400 mt-1.5 leading-tight">{sub}</div>
              </div>
            ))}
          </div>

          {/* Razorpay live events banner */}
          {auditLog.some(e => e._source === 'razorpay_live') && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-950/40 border border-rose-500/30">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-rose-500/20 border border-rose-500/40">
                <span className="text-sm">🔴</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-rose-200">
                  {auditLog.filter(e => e._source === 'razorpay_live').length} Real Razorpay Test-Mode Events Are Live In This Pipeline
                </div>
                <div className="text-[10px] text-rose-300/70 mt-0.5">
                  Scroll the Audit Stream below to see events with real <code className="font-mono">order_TYQ…</code> IDs —
                  verifiable at <b>dashboard.razorpay.com → Orders (test mode)</b>
                </div>
              </div>
              <button onClick={() => setActiveTab('audit')} className="btn btn-ghost text-[11px] shrink-0 border-rose-500/30 text-rose-300 hover:bg-rose-900/40">
                View Live Events →
              </button>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <EvilRevenueFunnel amountByBranch={D.amount_by_branch} countByBranch={D.count_by_branch} retriesAvoided={D.retries_avoided} totalAmount={totalVol} />
              <div className="grid grid-cols-2 gap-5">
                <EvilProbabilityChart sampleEvent={D.sample_recover_event} />
                <EvilConfusionMatrix matrixData={D.confusion_matrix} branchMetrics={D.branch_metrics} onSelectBranch={setBranchFilter} />
              </div>
              <AuditLogExplorer auditLog={auditLog} activeBranchFilter={branchFilter} onSelectEvent={setSelectedEvent} />
            </div>
          )}

          {activeTab === 'kde' && (
            <div className="space-y-5">
              <EvilProbabilityChart sampleEvent={D.sample_recover_event} />
              <AuditLogExplorer auditLog={auditLog.filter(e => (e.branch || e.decision?.branch) === 'RECOVER')} onSelectEvent={setSelectedEvent} />
            </div>
          )}

          {activeTab === 'matrix' && (
            <EvilConfusionMatrix matrixData={D.confusion_matrix} branchMetrics={D.branch_metrics} onSelectBranch={setBranchFilter} />
          )}

          {activeTab === 'audit' && (
            <AuditLogExplorer auditLog={auditLog} activeBranchFilter={branchFilter} onSelectEvent={setSelectedEvent} />
          )}
        </div>
      </main>

      {/* ─── Simulator modal ──────────────────────────── */}
      <LiveSimulatorModal isOpen={simulatorOpen} onClose={() => setSimulatorOpen(false)} />

      {/* ─── Event inspector modal ────────────────────── */}
      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="modal-panel w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/[0.08]">
              <div>
                <h3 className="text-sm font-bold text-white">Mandate Event Inspector</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedEvent.event_id}</p>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Fields */}
            <div className="space-y-2 text-xs mb-4">
              {[
                ['Customer ID', selectedEvent.customer_id, 'font-mono text-white'],
                ['Amount', `₹${selectedEvent.amount_inr?.toLocaleString()}`, 'text-emerald-400 font-bold text-sm'],
                ['NPCI Failure Code', selectedEvent.failure_code, 'text-rose-300 font-mono font-bold'],
                ['AI Decision', selectedEvent.decision?.branch, 'text-cyan-300 font-mono font-bold'],
              ].map(([k, v, cls]) => (
                <div key={k} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                  <span className="text-slate-300 font-medium">{k}</span>
                  <span className={cls}>{v}</span>
                </div>
              ))}
            </div>

            {/* AI Explanation */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 mb-2 uppercase tracking-wider">
                <Sparkles size={12} /> AI Recommendation
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">{selectedEvent.explanation || selectedEvent.action?.details}</p>
            </div>

            {/* Hinglish nudge for REAUTHORIZE */}
            {selectedEvent.decision?.branch === 'REAUTHORIZE' && (
              <div className="mt-3 p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/25">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-purple-300 mb-2 uppercase tracking-wider">
                  <MessageSquare size={12} /> Dispatched WhatsApp Nudge
                </div>
                <p className="text-[11px] text-purple-200 font-mono leading-relaxed">
                  "Aapka ₹{selectedEvent.amount_inr?.toLocaleString()} AutoPay expire ho gaya hai. 1-click se re-link karein: rzp.io/reauth/{selectedEvent.event_id?.slice(-6)}"
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
