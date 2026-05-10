/**
 * CylinderBar — Horizontal 3D aqua-glass cylinder bars with broken-axis support.
 *
 * Props:
 *   data:    [{ id, label, value, n, min, max, color, sub?, drillable?, onClick? }]
 *   stat:    'median' | 'mean' (used in tooltip text only)
 *   p90:     number — 90th-percentile across data; bars > 2× p90 break the axis
 *   maxLabel?: string — label suffix (default "hrs")
 *   onSelect?: (item) => void
 *
 * Features:
 *   - Horizontal cylinder with vibrant per-item gradient (front face, top ellipse, end cap shading)
 *   - Inner glass highlight (inset white stripe near top) for 3D feel
 *   - Broken-axis: if v > 2 * p90, renders zigzag and shows raw numeric value at the tip
 *   - "No data" rows render as grey shell with dashed outline
 *   - All 100% pure SVG (no extra deps)
 */
import React, { useMemo } from 'react';

const ROW_H = 38;
const LABEL_W = 200;
const VAL_W = 80;
const PAD_L = 8;
const PAD_R = 16;
const BAR_H = 22;

// Lighten/darken an #rrggbb hex by amount in [-1..1]
function shade(hex, amt) {
  const h = (hex || '#94a3b8').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (c) => {
    const v = amt >= 0 ? c + (255 - c) * amt : c * (1 + amt);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(f(r))}${toHex(f(g))}${toHex(f(b))}`;
}

export default function CylinderBar({ data, stat = 'median', p90, maxLabel = 'hrs', onSelect, width = 880 }) {
  const safeData = data || [];
  const H = Math.max(80, safeData.length * ROW_H + 24);
  const barAreaX = LABEL_W + PAD_L;
  const barAreaW = width - barAreaX - VAL_W - PAD_R;

  // Broken-axis threshold = 2× p90 (skip if p90 missing or all values ≤ 2× p90)
  const threshold = (p90 != null && p90 > 0) ? p90 * 2 : null;
  const hasOutlier = threshold && safeData.some((d) => (d.value || 0) > threshold);

  const visibleMax = useMemo(() => {
    if (threshold && hasOutlier) {
      // Cap visible scale at threshold so non-outliers stay readable; outliers will show broken
      const inRange = safeData.filter((d) => d.value != null && d.value <= threshold);
      return Math.max(1, ...inRange.map((d) => d.value || 0), threshold);
    }
    return Math.max(1, ...safeData.map((d) => d.value || 0));
  }, [safeData, threshold, hasOutlier]);

  const xFor = (v) => {
    if (v == null) return 0;
    if (threshold && hasOutlier && v > threshold) {
      // Broken: show 88% of bar area
      return barAreaW * 0.86;
    }
    return Math.max(2, (v / visibleMax) * barAreaW * 0.94);
  };

  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H} style={{ maxWidth: '100%' }} data-testid="cylinder-bar-chart">
      <defs>
        {safeData.map((d, i) => {
          const c = d.color || '#0e7c6b';
          const light = shade(c, 0.45);
          const lighter = shade(c, 0.7);
          const dark = shade(c, -0.35);
          return (
            <React.Fragment key={i}>
              <linearGradient id={`cyl-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lighter} />
                <stop offset="35%" stopColor={light} />
                <stop offset="55%" stopColor={c} />
                <stop offset="100%" stopColor={dark} />
              </linearGradient>
              <linearGradient id={`cyl-cap-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={dark} stopOpacity="0.9" />
                <stop offset="100%" stopColor={c} stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id={`cyl-shine-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </React.Fragment>
          );
        })}
      </defs>

      {safeData.map((d, i) => {
        const cy = 12 + i * ROW_H + BAR_H / 2;
        const yTop = cy - BAR_H / 2;
        const has = d.value != null;
        const isOutlier = threshold && hasOutlier && has && d.value > threshold;
        const w = has ? xFor(d.value) : 0;
        const ellipseRx = 5;
        const labelClick = !!d.drillable || !!onSelect;

        return (
          <g key={d.id || i} style={{ cursor: labelClick ? 'pointer' : 'default' }}
             onClick={() => labelClick && onSelect && onSelect(d)}
             data-testid={`cyl-row-${i}`}>
            {/* Row label */}
            <text x={LABEL_W - 6} y={cy + 4} fontSize="11" textAnchor="end"
                  fill={d.drillable ? '#0e7c6b' : '#334155'}
                  style={{ fontWeight: d.drillable ? 600 : 500 }}>
              <title>{d.label}</title>
              {d.label && d.label.length > 28 ? d.label.slice(0, 27) + '…' : d.label}
            </text>
            {d.sub && (
              <text x={LABEL_W - 6} y={cy + 14} fontSize="8.5" textAnchor="end" fill="#94a3b8">
                {d.sub}
              </text>
            )}

            {/* Empty shell (no data) */}
            {!has && (
              <g>
                <rect x={barAreaX} y={yTop} width={Math.min(60, barAreaW * 0.15)} height={BAR_H}
                      fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="3,2" rx="3" />
                <text x={barAreaX + 6} y={cy + 4} fontSize="9" fill="#94a3b8" fontStyle="italic">no data</text>
              </g>
            )}

            {/* Cylinder body */}
            {has && (
              <g>
                {/* Back (left) end cap — small ellipse */}
                <ellipse cx={barAreaX} cy={cy} rx={ellipseRx} ry={BAR_H / 2}
                         fill={`url(#cyl-cap-${i})`} stroke={shade(d.color || '#0e7c6b', -0.4)} strokeWidth="0.5" />
                {/* Body rect */}
                <rect x={barAreaX} y={yTop} width={Math.max(2, w - (isOutlier ? 28 : 0))} height={BAR_H}
                      fill={`url(#cyl-grad-${i})`} stroke={shade(d.color || '#0e7c6b', -0.3)} strokeWidth="0.4" />
                {/* Glass shine strip */}
                <rect x={barAreaX} y={yTop + 2} width={Math.max(1, w - (isOutlier ? 28 : 0) - 2)} height={Math.max(2, BAR_H * 0.32)}
                      fill={`url(#cyl-shine-${i})`} rx="2" />
                {/* Outlier zigzag break */}
                {isOutlier && (() => {
                  const bx = barAreaX + w - 28;
                  return (
                    <g>
                      <path d={`M ${bx} ${yTop} l 6 6 l -6 6 l 6 6 l -6 4`} stroke="#fff" strokeWidth="2.5" fill="none" />
                      <path d={`M ${bx} ${yTop} l 6 6 l -6 6 l 6 6 l -6 4`} stroke="#0f172a" strokeWidth="1" fill="none" />
                      <rect x={bx + 8} y={yTop} width={14} height={BAR_H} fill={`url(#cyl-grad-${i})`} />
                      <rect x={bx + 8} y={yTop + 2} width={12} height={Math.max(2, BAR_H * 0.32)} fill={`url(#cyl-shine-${i})`} rx="2" />
                    </g>
                  );
                })()}
                {/* Front (right) end cap — full ellipse */}
                <ellipse cx={barAreaX + w} cy={cy} rx={ellipseRx} ry={BAR_H / 2}
                         fill={shade(d.color || '#0e7c6b', 0.15)}
                         stroke={shade(d.color || '#0e7c6b', -0.3)} strokeWidth="0.5" />
                {/* Tip dot for clarity */}
                <circle cx={barAreaX + w} cy={cy} r={1.5} fill="#fff" opacity="0.9" />
                <title>{d.label}: {d.value} {maxLabel} (n={d.n}, min={d.min}, max={d.max})</title>
              </g>
            )}

            {/* Numeric value at tip */}
            {has && (
              <text x={Math.min(width - PAD_R, barAreaX + w + 8)} y={cy + 4} fontSize="11"
                    fontWeight={isOutlier ? 700 : 600}
                    fill={isOutlier ? '#b91c1c' : '#0f172a'}>
                {d.value}{isOutlier ? '★' : ''}
                <tspan fontSize="9" fill="#94a3b8" dx="2">
                  {maxLabel}{d.n != null ? ` · n=${d.n}` : ''}
                </tspan>
              </text>
            )}
          </g>
        );
      })}

      {/* Footer: broken-axis legend */}
      {hasOutlier && (
        <g>
          <text x={barAreaX} y={H - 4} fontSize="9" fill="#94a3b8">
            Axis broken (∿) where value &gt; 2× p90 ({(p90 || 0)} {maxLabel}). ★ marks outliers.
          </text>
        </g>
      )}
    </svg>
  );
}
