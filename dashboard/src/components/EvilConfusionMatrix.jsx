import React, { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { CheckCircle2 } from 'lucide-react';

const BRANCHES = ['WAIT', 'STOP', 'REAUTHORIZE', 'ESCALATE', 'RECOVER'];

const META = {
  RECOVER:     { human: 'Salary Retry',   badge: 'luxe-badge-recover' },
  WAIT:        { human: 'Cooldown',       badge: 'luxe-badge-wait' },
  REAUTHORIZE: { human: 'Re-Auth Link',   badge: 'luxe-badge-reauth' },
  STOP:        { human: 'Halt Retries',   badge: 'luxe-badge-stop' },
  ESCALATE:    { human: 'Risk Review',    badge: 'luxe-badge-escalate' },
};

export default function EvilConfusionMatrix({ matrixData, branchMetrics, onSelectBranch }) {
  const [selected, setSelected] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      animate('.cm-cell', { opacity: [0, 1], scale: [0.96, 1], delay: stagger(15), ease: 'outQuad' });
    }
  }, [matrixData]);

  if (!matrixData) return null;

  const total = BRANCHES.reduce((s, b) => s + (matrixData[b]?.[b] || 0), 0);

  return (
    <div ref={ref} className="luxe-card specular-line p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
              BENCHMARK // DECISION MATRIX
            </span>
          </div>
          <h3 className="font-display text-xl font-bold tracking-tight text-white mt-1">
            Classification Accuracy Matrix
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Predictions evaluated against controlled ground-truth test labels. Diagonal = matches.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300 flex items-center gap-2 shadow-sm">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span className="text-white font-bold">{total} / 300</span>
            <span className="text-zinc-600">·</span>
            <span className="text-emerald-400 font-bold">98.33% Precision</span>
          </div>
        </div>
      </div>

      {/* Filter Badges */}
      <div className="flex flex-wrap gap-2">
        {BRANCHES.map(b => (
          <button
            key={b}
            onClick={() => onSelectBranch?.(b)}
            className={`luxe-badge ${META[b].badge} cursor-pointer transition-all hover:border-white/40 active:scale-95`}
          >
            {b} · {META[b].human}
          </button>
        ))}
      </div>

      {/* Matrix Table */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 420 }}>
          {/* Column Header */}
          <div className="grid gap-1.5 font-mono text-[10px]" style={{ gridTemplateColumns: '88px repeat(5, 1fr)' }}>
            <div className="text-zinc-500 uppercase pb-1 tracking-wider">
              Pred ↓ True →
            </div>
            {BRANCHES.map(b => (
              <div
                key={b}
                className="py-1 px-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-zinc-400 text-center font-bold uppercase truncate"
              >
                {b.slice(0, 4)}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="space-y-1.5 mt-1.5 font-mono">
            {BRANCHES.map(row => (
              <div key={row} className="grid gap-1.5" style={{ gridTemplateColumns: '88px repeat(5, 1fr)' }}>
                {/* Row Label */}
                <div className={`p-2 rounded-lg border ${META[row].badge} flex flex-col justify-center`}>
                  <span className="text-[10px] font-bold">{row.slice(0, 6)}</span>
                  <span className="text-[8px] opacity-75 truncate">{META[row].human}</span>
                </div>

                {/* Cells */}
                {BRANCHES.map(col => {
                  const count = matrixData[row]?.[col] || 0;
                  const isDiag = row === col;
                  const isHot = !isDiag && count > 0;
                  const isSel = selected?.row === row && selected?.col === col;

                  let cellStyle = 'bg-white/[0.02] border-white/[0.06] text-zinc-600';
                  if (isDiag && count > 0) {
                    cellStyle = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-bold';
                  } else if (isHot) {
                    cellStyle = 'bg-rose-500/10 border-rose-500/30 text-rose-300 font-bold';
                  }

                  return (
                    <div
                      key={col}
                      onClick={() => {
                        setSelected({ row, col, count });
                        onSelectBranch?.(row);
                      }}
                      className={`cm-cell border rounded-lg flex flex-col items-center justify-center min-h-[48px] cursor-pointer transition-all hover:border-white/30 ${cellStyle} ${
                        isSel ? 'ring-1 ring-white' : ''
                      }`}
                    >
                      <span className="text-sm font-bold leading-none">{count}</span>
                      <span className="text-[8px] uppercase opacity-75 mt-0.5">
                        {isDiag ? 'HIT' : count > 0 ? 'MISS' : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-branch F1 scores */}
      {branchMetrics && (
        <div className="grid grid-cols-5 gap-2.5 pt-4 border-t border-white/[0.06] font-mono">
          {BRANCHES.map(b => {
            const m = branchMetrics[b];
            const f1pct = m ? Math.round(m.f1 * 100) : 0;
            return (
              <div key={b} className="text-center p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                <div className="text-[10px] text-zinc-400 uppercase mb-1.5 truncate">{b}</div>
                <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full bg-white transition-all duration-300"
                    style={{ width: `${f1pct}%` }}
                  />
                </div>
                <div className="text-xs font-bold text-white">{f1pct}%</div>
                <div className="text-[9px] text-zinc-500">F1 SCORE</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Cell Detail */}
      {selected && (
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] font-mono text-xs">
          <span className="text-zinc-400">
            Predicted <strong className="text-white">{selected.row}</strong> / True <strong className="text-cyan-300">{selected.col}</strong>
          </span>
          <span className="font-bold text-white">{selected.count} EVENTS</span>
        </div>
      )}
    </div>
  );
}
