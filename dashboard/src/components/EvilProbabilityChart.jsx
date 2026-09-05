import React, { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { Calendar, Sparkles } from 'lucide-react';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rc-tooltip">
      <div className="text-[11px] font-mono font-bold text-white mb-1 flex items-center justify-between gap-3">
        <span>{d.day}</span>
        {d.isSalaryWindow && (
          <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">
            ★ Salary Window
          </span>
        )}
      </div>
      <div className="text-[11px] text-emerald-400 font-semibold flex justify-between gap-4">
        <span>Success Probability:</span>
        <span className="font-mono">{d.probability}%</span>
      </div>
    </div>
  );
};

export default function EvilProbabilityChart({ sampleEvent }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) animate(ref.current, { opacity: [0, 1], translateY: [12, 0], duration: 650, ease: 'outCubic' });
  }, [sampleEvent]);

  if (!sampleEvent?.probability_curve) return null;

  const data = Object.entries(sampleEvent.probability_curve).map(([day, prob]) => ({
    day: `D${day}`,
    dayNum: parseInt(day),
    probability: (prob * 100).toFixed(1),
    probVal: prob,
    isSalaryWindow: sampleEvent.historical_success_days_of_month.includes(parseInt(day)),
  }));

  const peak = data.reduce((a, b) => (a.probVal > b.probVal ? a : b));

  return (
    <div ref={ref} className="card p-5 flex flex-col gap-4 card-glow-emerald">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
            <h3 className="text-[13px] font-bold text-white">Smart Retry Planner</h3>
            <span className="chip chip-info text-[10px]">KDE Salary Model</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-sm">
            Gaussian density model of customer payment history, used to schedule retries on peak-success salary days.
          </p>
          <div className="mt-2 flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/[0.15]">
            <span className="text-emerald-400 text-[10px] font-black uppercase tracking-wider shrink-0 mt-0.5">PROOF:</span>
            <p className="text-[10px] text-emerald-200 leading-snug">
              Each peak in this curve is a statistically-identified salary window.
              Retry on Day 3, not the day it failed — that's the ₹ difference between
              a recovered payment and a wasted attempt.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/12 border border-emerald-500/25 text-emerald-300 text-[11px] font-semibold whitespace-nowrap">
            <Calendar size={11} /> Optimal: Day {peak.dayNum} ({(peak.probVal * 100).toFixed(1)}%)
          </div>
          <div className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-semibold font-mono">
            ₹{sampleEvent.amount_inr?.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-cyan-500/[0.08] border border-cyan-500/[0.15] text-[11px] text-cyan-200">
          <span className="w-3 h-3 rounded mt-0.5 shrink-0 border border-cyan-300 bg-cyan-400/30" />
          <span><b>Highlighted zone</b> — Customer's known salary credit window (Days 1–5)</span>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/[0.15] text-[11px] text-emerald-200">
          <span className="w-3 h-3 rounded mt-0.5 shrink-0 bg-emerald-400" />
          <span><b>Green curve</b> — Probability of successful payment collection each day</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="grad-emerald" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-salary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#22d3ee" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <ReferenceArea x1="D1" x2="D5" fill="url(#grad-salary)" stroke="#22d3ee" strokeOpacity={0.3} strokeDasharray="3 3" />
            <ReferenceLine x={`D${peak.dayNum}`} stroke="#10b981" strokeDasharray="4 3"
              label={{ value: `↑ Day ${peak.dayNum}`, fill: '#34d399', fontSize: 10, fontWeight: 700, position: 'top' }} />
            <XAxis dataKey="day" stroke="#334155" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#1e293b' }} />
            <YAxis stroke="#334155" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#1e293b' }} unit="%" />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="probability" stroke="#10b981" strokeWidth={2.5}
              fillOpacity={1} fill="url(#grad-emerald)"
              activeDot={{ r: 6, fill: '#34d399', stroke: '#064e3b', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Explanation */}
      <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-3">
        <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5">
          <Sparkles size={11} /> AI
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed">{sampleEvent.explanation}</p>
      </div>
    </div>
  );
}
