/**
 * CylinderBar — Horizontal 3D aqua-glass cylinder bars with broken-axis.
 *
 * Props:
 *   data:     [{ id, label, value, n, min, max, color, sub?, drillable?,
 *                badge? {text, color}, meta? extraLine }]
 *   stat:     'median' | 'mean'
 *   p90:      number — bars > 2× p90 break the axis
 *   maxLabel?: string (default "hrs")
 *   onSelect?: (item) => void
 *
 * Visual upgrade: 6-stop gradient, drop shadow filter, ambient highlight,
 * thicker rim, deeper end-cap shading, larger zigzag with white outline.
 */
import React, { useMemo, useId } from 'react';

const ROW_H = 42;
const LABEL_W = 200;
const VAL_W = 96;
const PAD_L = 8;
const PAD_R = 16;
const BAR_H = 24;

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

export default function CylinderBar({
  data, stat = 'median', p90, maxLabel = 'hrs', onSelect, width = 920,
}) {
  const safeData = data || [];
  const filterId = useId();
  const H = Math.max(80, safeData.length * ROW_H + 28);
  const barAreaX = LABEL_W + PAD_L;
  const barAreaW = width - barAreaX - VAL_W - PAD_R;

  const threshold = (p90 != null && p90 > 0) ? p90 * 2 : null;
  const hasOutlier = threshold && safeData.some((d) => (d.value || 0) > threshold);

  const visibleMax = useMemo(() => {
    if (threshold && hasOutlier) {
      const inRange = safeData.filter((d) => d.value != null && d.value <= threshold);
      return Math.max(1, ...inRange.map((d) => d.value || 0), threshold);
    }
    return Math.max(1, ...safeData.map((d) => d.value || 0));
  }, [safeData, threshold, hasOutlier]);

  const xFor = (v) => {
    if (v == null) return 0;
    if (threshold && hasOutlier && v > threshold) return barAreaW * 0.86;
    return Math.max(4, (v / visibleMax) * barAreaW * 0.94);
  };

  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H}
         style={{ maxWidth: '100%' }} data-testid="cylinder-bar-chart">
      <defs>
        <filter id={`cb-shadow-${filterId}`} x="-2%" y="-30%" width="104%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
          <feOffset dx="0" dy="1.5" result="off" />
          <feComponentTransfer><feFuncA type="linear" slope="0.32" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {safeData.map((d, i) => {
          const c = d.color || '#0e7c6b';
          const top = shade(c, 0.72);
          const upper = shade(c, 0.38);
          const lower = shade(c, -0.18);
          const bottom = shade(c, -0.42);
          return (
            <React.Fragment key={i}>
              <linearGradient id={`cyl-grad-${filterId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={top} />
                <stop offset="12%" stopColor={upper} />
                <stop offset="42%" stopColor={c} />
                <stop offset="72%" stopColor={lower} />
                <stop offset="100%" stopColor={bottom} />
              </linearGradient>
              <linearGradient id={`cyl-cap-${filterId}-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={bottom} stopOpacity="0.95" />
                <stop offset="100%" stopColor={c} stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id={`cyl-shine-${filterId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`cyl-ao-${filterId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
              </linearGradient>
            </React.Fragment>
          );
        })}
      </defs>

      {safeData.map((d, i) => {
        const cy = 14 + i * ROW_H + BAR_H / 2;
        const yTop = cy - BAR_H / 2;
        const has = d.value != null;
        const isOutlier = threshold && hasOutlier && has && d.value > threshold;
        const w = has ? xFor(d.value) : 0;
        const ellipseRx = 6;
        const labelClick = !!d.drillable || !!onSelect;

        return (
          <g key={d.id || i} style={{ cursor: labelClick ? 'pointer' : 'default' }}
             onClick={() => labelClick && onSelect && onSelect(d)}
             data-testid={`cyl-row-${i}`}>
            {/* Row label */}
            <text x={LABEL_W - 6} y={cy - 2} fontSize="11.5" textAnchor="end"
                  fill={d.drillable ? '#0e7c6b' : '#0f172a'}
                  style={{ fontWeight: d.drillable ? 700 : 600 }}>
              <title>{d.label}</title>
              {d.label && d.label.length > 28 ? d.label.slice(0, 27) + '…' : d.label}
            </text>
            {d.sub && (
              <text x={LABEL_W - 6} y={cy + 11} fontSize="9" textAnchor="end" fill="#64748b">
                {d.sub}
              </text>
            )}

            {/* Status badge to the left of bar */}
            {d.badge && (
              <g transform={`translate(${barAreaX}, ${cy - BAR_H / 2 - 4})`}>
                <rect x="0" y="-9" width={d.badge.text.length * 6 + 10} height="14" rx="7"
                      fill={d.badge.color} opacity="0.92" />
                <text x={(d.badge.text.length * 6 + 10) / 2} y="1" fontSize="9"
                      textAnchor="middle" fill="#fff" fontWeight="700">
                  {d.badge.text}
                </text>
              </g>
            )}

            {/* Empty shell */}
            {!has && (
              <g>
                <rect x={barAreaX} y={yTop} width={Math.min(60, barAreaW * 0.15)}
                      height={BAR_H} fill="#f1f5f9" stroke="#cbd5e1"
                      strokeDasharray="3,2" rx="4" />
                <text x={barAreaX + 6} y={cy + 4} fontSize="9" fill="#94a3b8"
                      fontStyle="italic">no data</text>
              </g>
            )}

            {/* Cylinder body */}
            {has && (
              <g filter={`url(#cb-shadow-${filterId})`}>
                {/* Left cap (back) */}
                <ellipse cx={barAreaX} cy={cy} rx={ellipseRx} ry={BAR_H / 2}
                         fill={`url(#cyl-cap-${filterId}-${i})`}
                         stroke={shade(d.color || '#0e7c6b', -0.45)} strokeWidth="0.6" />
                {/* Body */}
                <rect x={barAreaX} y={yTop}
                      width={Math.max(4, w - (isOutlier ? 30 : 0))} height={BAR_H}
                      fill={`url(#cyl-grad-${filterId}-${i})`}
                      stroke={shade(d.color || '#0e7c6b', -0.32)} strokeWidth="0.5" />
                {/* Ambient occlusion at top + bottom edges */}
                <rect x={barAreaX} y={yTop}
                      width={Math.max(4, w - (isOutlier ? 30 : 0))} height={BAR_H}
                      fill={`url(#cyl-ao-${filterId}-${i})`} />
                {/* Glass shine */}
                <rect x={barAreaX + 1} y={yTop + 2}
                      width={Math.max(2, w - (isOutlier ? 30 : 0) - 2)}
                      height={Math.max(3, BAR_H * 0.36)}
                      fill={`url(#cyl-shine-${filterId}-${i})`} rx="2" />
                {/* Outlier zigzag (V-shape break) */}
                {isOutlier && (() => {
                  const bx = barAreaX + w - 30;
                  return (
                    <g>
                      <path d={`M ${bx} ${yTop - 1} l 7 ${BAR_H / 2 + 1} l -7 ${BAR_H / 2 + 1}`}
                            stroke="#fff" strokeWidth="3" fill="none" />
                      <path d={`M ${bx} ${yTop - 1} l 7 ${BAR_H / 2 + 1} l -7 ${BAR_H / 2 + 1}`}
                            stroke="#0f172a" strokeWidth="1.2" fill="none" />
                      <path d={`M ${bx + 8} ${yTop - 1} l 7 ${BAR_H / 2 + 1} l -7 ${BAR_H / 2 + 1}`}
                            stroke="#fff" strokeWidth="3" fill="none" />
                      <path d={`M ${bx + 8} ${yTop - 1} l 7 ${BAR_H / 2 + 1} l -7 ${BAR_H / 2 + 1}`}
                            stroke="#0f172a" strokeWidth="1.2" fill="none" />
                      <rect x={bx + 17} y={yTop} width={13} height={BAR_H}
                            fill={`url(#cyl-grad-${filterId}-${i})`} />
                      <rect x={bx + 17} y={yTop + 2} width={11}
                            height={Math.max(3, BAR_H * 0.36)}
                            fill={`url(#cyl-shine-${filterId}-${i})`} rx="2" />
                    </g>
                  );
                })()}
                {/* Right cap (front, full ellipse) */}
                <ellipse cx={barAreaX + w} cy={cy} rx={ellipseRx} ry={BAR_H / 2}
                         fill={shade(d.color || '#0e7c6b', 0.18)}
                         stroke={shade(d.color || '#0e7c6b', -0.32)} strokeWidth="0.6" />
                <ellipse cx={barAreaX + w - 1} cy={cy - BAR_H * 0.18}
                         rx={ellipseRx * 0.45} ry={BAR_H * 0.18}
                         fill="#fff" opacity="0.55" />
                <title>{d.label}: {d.value} {maxLabel} (n={d.n}, min={d.min}, max={d.max})</title>
              </g>
            )}

            {/* Numeric value at tip */}
            {has && (
              <text x={Math.min(width - PAD_R, barAreaX + w + 10)} y={cy + 4}
                    fontSize="11.5" fontWeight={isOutlier ? 800 : 700}
                    fill={isOutlier ? '#b91c1c' : '#0f172a'}>
                {d.value}{isOutlier ? '★' : ''}
                <tspan fontSize="9" fill="#94a3b8" dx="3">
                  {maxLabel}{d.n != null ? ` · n=${d.n}` : ''}
                </tspan>
              </text>
            )}
            {d.meta && has && (
              <text x={Math.min(width - PAD_R, barAreaX + w + 10)} y={cy + 14}
                    fontSize="8.5" fill="#64748b">{d.meta}</text>
            )}
          </g>
        );
      })}

      {hasOutlier && (
        <text x={barAreaX} y={H - 6} fontSize="9" fill="#94a3b8">
          Axis broken (∿) where value &gt; 2× p90 ({(p90 || 0)} {maxLabel}). ★ marks outliers.
        </text>
      )}
    </svg>
  );
}
