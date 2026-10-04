import React, { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ShieldCheck } from 'lucide-react';

const BRANCH_CONFIG = {
  RECOVER: {
    fill: '#10b981',
    text: 'text-emerald-400',
    badge: 'luxe-badge-recover',
    label: 'SALARY RETRY',
    desc: 'Bayesian peak scheduled on customer salary credit window.',
  },
  WAIT: {
    fill: '#38bdf8',
    text: 'text-sky-400',
    badge: 'luxe-badge-wait',
    label: 'BANK COOLDOWN',
    desc: 'NPCI/PSP bank downtime. Cooldown applied with zero fee waste.',
  },
  REAUTHORIZE: {
    fill: '#c084fc',
    text: 'text-purple-400',
    badge: 'luxe-badge-reauth',
    label: 'REAUTH LINK',
    desc: 'Mandate paused/revoked. 1-click re-link link dispatched.',
  },
  STOP: {
    fill: '#fb7185',
    text: 'text-rose-400',
    badge: 'luxe-badge-stop',
    label: 'HALT RETRIES',
    desc: 'Hard account failure. Suspended to prevent gateway penalties.',
  },
  ESCALATE: {
    fill: '#fbbf24',
    text: 'text-amber-400',
    badge: 'luxe-badge-escalate',
    label: 'RISK REVIEW',
    desc: 'Multi-failure velocity risk flagged for operations audit.',
  },
};

const CustomTooltip = ({ active, payload, totalAmount }) => {
  if (!active || !payload?.length) return null;
  const { name, value, count } = payload[0].payload;
  const cfg = BRANCH_CONFIG[name] || {};
  const pct = totalAmount ? ((value / totalAmount) * 100).toFixed(1) : 0;

  return (
    <div className="rc-tooltip font-mono">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.fill }} />
        <span className="font-bold text-white text-xs">{name}</span>
        <span className="text-[11px] text-zinc-400">({pct}%)</span>
      </div>
      <div className={`text-[11px] ${cfg.text} font-semibold mb-1`}>{cfg.label}</div>
      <div className="text-[11px] text-zinc-400 leading-relaxed max-w-xs">{cfg.desc}</div>
      <div className="text-xs font-bold text-white mt-2 pt-2 border-t border-white/[0.08]">
        ₹{Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · {count} mandates
      </div>
    </div>
  );
};

export default function EvilRevenueFunnel({ amountByBranch, countByBranch, retriesAvoided, totalAmount }) {
  const counterRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (counterRef.current && totalAmount) {
      const obj = { val: 0 };
      animate(obj, {
        val: totalAmount,
        duration: 1000,
        ease: 'outExpo',
        onUpdate: () => {
          if (counterRef.current) counterRef.current.textContent = `₹${(obj.val / 1e5).toFixed(2)}L`;
        },
      });
    }
    if (containerRef.current) {
      animate('.funnel-item', { opacity: [0, 1], translateY: [6, 0], delay: stagger(35), ease: 'outCubic' });
    }
  }, [amountByBranch, totalAmount]);

  if (!amountByBranch) return null;

  const pieData = Object.keys(amountByBranch).map(branch => ({
    name: branch,
    value: amountByBranch[branch],
    count: countByBranch[branch] || 0,
  }));

  const totalCount = Object.values(countByBranch || {}).reduce((a, b) => a + b, 0);

  return (
    <div ref={containerRef} className="luxe-card specular-line p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 mb-5 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
              TELEMETRY // ROUTING PARTITION
            </span>
          </div>
          <h3 className="font-display text-xl font-bold tracking-tight text-white mt-1">
            Revenue Recovery Partition
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Deterministic allocation of ₹{(totalAmount / 1e5).toFixed(2)}L across 5 classified mandate pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300 flex items-center gap-2 shadow-sm">
            <ShieldCheck size={13} className="text-emerald-400" />
            <span className="text-white font-bold">{retriesAvoided?.total || 131}</span> retries halted
            <span className="text-zinc-600">·</span>
            <span className="text-emerald-400 font-semibold">₹{retriesAvoided?.estimated_inr_saved || 262} saved</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Donut chart */}
        <div className="lg:col-span-5 h-60 relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={92}
                paddingAngle={3}
                dataKey="value"
                stroke="#090a0f"
                strokeWidth={2}
              >
                {pieData.map(entry => (
                  <Cell key={entry.name} fill={BRANCH_CONFIG[entry.name]?.fill || '#71717a'} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip totalAmount={totalAmount} />} />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Donut Center */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">TOTAL EVALUATED</span>
            <span ref={counterRef} className="font-mono text-2xl font-extrabold tracking-tight text-white mt-0.5">
              ₹0
            </span>
            <span className="font-mono text-[11px] text-zinc-400 mt-0.5">{totalCount} MANDATES</span>
          </div>
        </div>

        {/* Breakdown Rows */}
        <div className="lg:col-span-7 space-y-2">
          {pieData.map(entry => {
            const cfg = BRANCH_CONFIG[entry.name] || {};
            const pct = totalAmount ? ((entry.value / totalAmount) * 100).toFixed(1) : 0;
            return (
              <div
                key={entry.name}
                className="funnel-item flex items-center justify-between gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04] transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: cfg.fill }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{entry.name}</span>
                      <span className={`text-[10px] ${cfg.text} font-mono font-medium`}>[{cfg.label}]</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate max-w-sm">{cfg.desc}</div>
                  </div>
                </div>

                <div className="text-right shrink-0 font-mono">
                  <div className="text-xs font-bold text-white">
                    ₹{Number(entry.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {pct}% · {entry.count} txns
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
