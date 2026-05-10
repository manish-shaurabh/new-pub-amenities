/**
 * RadarChart — Spider/radar chart with axis labels and per-supervisor polygons.
 *
 * Props:
 *   axes:    [{ id, name }]                        — N axes (≥3)
 *   series:  [{ supervisor_id, label, is_self,
 *               values: [{ asset_type_id, value, n }] }]
 *   stat:    label only ('median'|'mean')
 *   maxLabel?: string (default 'hrs')
 *
 * Rules:
 *   - Self polygon = teal (#0e7c6b), 0.35 fill opacity, 2.5px stroke
 *   - Peers = light blue (#60a5fa), 0.12 fill opacity, 1.5px stroke
 *   - Anonymous peers labeled "Peer N" (caller controls)
 *   - Axis tip labels show asset-type name and per-axis self-value with units
 *   - Null/missing values rendered at 0 radius (silently)
 */
import React from 'react';

const SIZE = 380;
const CX = SIZE / 2;
const CY = SIZE / 2 + 4;
const R_MAX = 130;

export default function RadarChart({ axes, series, stat = 'median', maxLabel = 'hrs' }) {
  if (!axes || axes.length < 3) {
    return <p className="text-sm text-slate-500 text-center py-6">Need at least 3 axes (asset-types) for radar.</p>;
  }
  // Compute global max across all series for normalisation
  let gMax = 0;
  (series || []).forEach((s) => (s.values || []).forEach((v) => {
    if (v.value != null && v.value > gMax) gMax = v.value;
  }));
  if (gMax <= 0) gMax = 1;

  const N = axes.length;
  const axisAngle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const point = (i, frac) => {
    const a = axisAngle(i);
    return [CX + R_MAX * frac * Math.cos(a), CY + R_MAX * frac * Math.sin(a)];
  };

  // Concentric grid: 4 levels
  const gridLevels = [0.25, 0.5, 0.75, 1];

  const polygonPath = (vals) => {
    return vals.map((v, i) => {
      const frac = (v.value || 0) / gMax;
      const [x, y] = point(i, frac);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ') + ' Z';
  };

  const selfSeries = (series || []).find((s) => s.is_self);

  return (
    <div className="flex flex-col items-center" data-testid="radar-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {/* Grid polygons */}
        {gridLevels.map((lv, gi) => {
          const pts = axes.map((_, i) => point(i, lv).map((n) => n.toFixed(1)).join(',')).join(' ');
          return (
            <polygon key={gi} points={pts}
                     fill={gi === gridLevels.length - 1 ? 'none' : '#f8fafc'}
                     fillOpacity={gi % 2 === 0 ? 0.5 : 0}
                     stroke="#cbd5e1" strokeDasharray="2,3" strokeWidth="0.6" />
          );
        })}
        {/* Axes */}
        {axes.map((ax, i) => {
          const [x, y] = point(i, 1);
          return (
            <g key={ax.id}>
              <line x1={CX} y1={CY} x2={x} y2={y} stroke="#cbd5e1" strokeWidth="0.6" />
            </g>
          );
        })}

        {/* Series polygons (peers first, self last so it overlays) */}
        {(series || [])
          .slice()
          .sort((a, b) => Number(!!a.is_self) - Number(!!b.is_self))
          .map((s, idx) => {
            const isSelf = s.is_self;
            const stroke = isSelf ? '#0e7c6b' : '#60a5fa';
            const fillOp = isSelf ? 0.35 : 0.10;
            const strokeWidth = isSelf ? 2.5 : 1.2;
            return (
              <g key={s.supervisor_id || idx}>
                <path d={polygonPath(s.values || [])}
                      fill={stroke} fillOpacity={fillOp}
                      stroke={stroke} strokeWidth={strokeWidth}
                      strokeLinejoin="round" />
                {isSelf && (s.values || []).map((v, i) => {
                  if (v.value == null) return null;
                  const frac = v.value / gMax;
                  const [x, y] = point(i, frac);
                  return (
                    <circle key={i} cx={x} cy={y} r="3" fill="#0e7c6b" stroke="#fff" strokeWidth="1" />
                  );
                })}
              </g>
            );
          })}

        {/* Axis tip labels */}
        {axes.map((ax, i) => {
          const [lx, ly] = point(i, 1.16);
          const sv = selfSeries?.values?.[i]?.value;
          const align = Math.abs(lx - CX) < 4 ? 'middle' : (lx > CX ? 'start' : 'end');
          return (
            <g key={`lbl-${ax.id}`}>
              <text x={lx} y={ly} fontSize="11" textAnchor={align} fill="#0f172a" fontWeight="600">
                {ax.name}
              </text>
              {sv != null && (
                <text x={lx} y={ly + 13} fontSize="9.5" textAnchor={align} fill="#0e7c6b">
                  you: {sv} {maxLabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Center scale label */}
        <text x={CX} y={CY + 3} fontSize="9" textAnchor="middle" fill="#64748b">
          0 → {gMax.toFixed(0)} {maxLabel}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#0e7c6b' }} />
          <span className="text-slate-700 font-semibold">You</span>
        </div>
        {(series || []).filter((s) => !s.is_self).map((s, i) => (
          <div key={s.supervisor_id || i} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#60a5fa', opacity: 0.7 }} />
            <span className="text-slate-600">{s.label}</span>
          </div>
        ))}
        <span className="ml-2 text-[10px] text-slate-400 self-center">
          ({stat === 'mean' ? 'Mean' : 'Median'} repair time per asset-type)
        </span>
      </div>
    </div>
  );
}
