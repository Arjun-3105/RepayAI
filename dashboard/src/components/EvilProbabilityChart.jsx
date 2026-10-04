import React, { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { Calendar, Cpu } from 'lucide-react';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rc-tooltip font-mono">
      <div className="text-xs font-bold text-white mb-1 flex items-center justify-between gap-3">
        <span>DAY {d.dayNum} OF MONTH</span>
        {d.isSalaryWindow && (
          <span className="text-[10px] bg-cyan-500/15 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
            PAYDAY CLUSTER
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-400 flex items-center justify-between gap-4">
        <span>LIKELIHOOD SCORE:</span>
        <span className="font-bold text-emerald-400">{d.probability}%</span>
      </div>
    </div>
  );
};

export default function EvilProbabilityChart({ sampleEvent }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      animate(ref.current, { opacity: [0, 1], translateY: [6, 0], duration: 400, ease: 'outCubic' });
    }
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
    <div ref={ref} className="luxe-card specular-line p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
              ESTIMATION // BAYESIAN KDE KERNEL
            </span>
          </div>
          <h3 className="font-display text-xl font-bold tracking-tight text-white mt-1">
            Smart Retry Schedule Kernel
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Gaussian density model for customer <code className="text-white font-mono font-bold">{sampleEvent.customer_id}</code>.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-bold flex items-center gap-1.5 shadow-sm">
            <Calendar size={12} />
            <span>Optimal: Day {peak.dayNum} ({(peak.probVal * 100).toFixed(1)}%)</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-white font-bold">
            ₹{Number(sampleEvent.amount_inr).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Technical Summary */}
      <div className="p-3.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-zinc-400 leading-relaxed flex items-start gap-3">
        <Cpu size={15} className="text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <span className="text-white font-semibold">Salary Window Alignment: </span>
          {sampleEvent.explanation || 'Historical salary credits cluster in the early monthly cycle. Auto-retry aligns strictly to peak probability.'}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs font-mono text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-cyan-500/20 border border-cyan-500/40" />
          <span>Payday Window (Days 1–5)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-emerald-400" />
          <span>Collection Density D(x)</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="luxe-emerald" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="luxe-window" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <ReferenceArea
              x1="D1"
              x2="D5"
              fill="url(#luxe-window)"
              stroke="rgba(56, 189, 248, 0.25)"
              strokeDasharray="2 2"
            />

            <ReferenceLine
              x={peak.day}
              stroke="#10b981"
              strokeDasharray="3 3"
              strokeWidth={1.5}
            />

            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
              tick={{ fill: '#71717a', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'JetBrains Mono' }}
              tickFormatter={v => `${v}%`}
            />

            <Tooltip content={<CustomTooltip />} />

            <Area
              type="monotone"
              dataKey="probability"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#luxe-emerald)"
              dot={false}
              activeDot={{ r: 4, fill: '#10b981', stroke: '#040507', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
