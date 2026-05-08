// Reports module — single-file frontend (page + 4 chart components)
// Reads from /api/reports/health/{user_id} and exports via /api/reports/export/*

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth-context';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Loader2, FileDown, FileSpreadsheet, ArrowLeft, ChevronRight } from 'lucide-react';
import { formatDateTime } from '../lib/utils';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

// ─── Color helpers (mirror backend health_color) ──────────────────────────
const HEALTH = { working: '#10b981', yellow: '#eab308', orange: '#f97316', red: '#dc2626' };
const RING_INACTIVE = '#e5e7eb';

function _lerp(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const ar = parseInt(a.slice(1,3),16), ag = parseInt(a.slice(3,5),16), ab = parseInt(a.slice(5,7),16);
  const br = parseInt(b.slice(1,3),16), bg = parseInt(b.slice(3,5),16), bb = parseInt(b.slice(5,7),16);
  const r = Math.round(ar + (br-ar)*t), g = Math.round(ag + (bg-ag)*t), bl = Math.round(ab + (bb-ab)*t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
}
function gradientColor(pct) {
  if (pct >= 100) return '#10b981';
  if (pct >= 95)  return _lerp('#eab308', '#4ade80', (pct - 95) / 5);
  if (pct >= 90)  return _lerp('#f97316', '#eab308', (pct - 90) / 5);
  if (pct >= 80)  return _lerp('#dc2626', '#f97316', (pct - 80) / 10);
  return '#7f1d1d';
}

// ─── ConcentricRings — one ring per group (asset_type or department) ──────
function ConcentricRings({ rings, summary }) {
  const SIZE = 240;
  const CX = SIZE / 2, CY = SIZE / 2;
  const MAX_RADIUS = 105;
  const MIN_RADIUS = 32;
  const RING_GAP = 4;
  const ringCount = Math.max(rings.length, 1);
  const totalSpan = MAX_RADIUS - MIN_RADIUS;
  const ringWidth = Math.max(8, (totalSpan / ringCount) - RING_GAP);

  // Build path arc helper
  const arc = (cx, cy, rOuter, rInner, startDeg, endDeg) => {
    const startRad = (startDeg - 90) * Math.PI / 180;
    const endRad = (endDeg - 90) * Math.PI / 180;
    const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
    const x1 = cx + rOuter * Math.cos(startRad);
    const y1 = cy + rOuter * Math.sin(startRad);
    const x2 = cx + rOuter * Math.cos(endRad);
    const y2 = cy + rOuter * Math.sin(endRad);
    const x3 = cx + rInner * Math.cos(endRad);
    const y3 = cy + rInner * Math.sin(endRad);
    const x4 = cx + rInner * Math.cos(startRad);
    const y4 = cy + rInner * Math.sin(startRad);
    return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  };

  const isAllClear = (summary?.pct_working ?? 100) >= 100 || rings.every(r => (r.yellow + r.orange + r.red) === 0);
  const centerColor = gradientColor(summary?.pct_working ?? 100);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE, margin: '0 auto' }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {rings.length === 0 ? (
          <circle cx={CX} cy={CY} r={MIN_RADIUS + ringWidth/2} fill="none" stroke={RING_INACTIVE} strokeWidth={ringWidth} />
        ) : rings.map((ring, idx) => {
          const rOuter = MIN_RADIUS + ringWidth + (idx * (ringWidth + RING_GAP));
          const rInner = rOuter - ringWidth;
          const total = ring.total || 1;
          // 4 segments: W (grey), Y, O, R sized by count
          const segments = [
            { count: ring.working, color: RING_INACTIVE },
            { count: ring.yellow,  color: HEALTH.yellow },
            { count: ring.orange,  color: HEALTH.orange },
            { count: ring.red,     color: HEALTH.red    },
          ].filter(s => s.count > 0);
          let cur = 0;
          return (
            <g key={idx}>
              {segments.length === 1 ? (
                <circle cx={CX} cy={CY} r={(rOuter + rInner)/2} fill="none" stroke={segments[0].color} strokeWidth={ringWidth} />
              ) : segments.map((seg, sIdx) => {
                const span = (seg.count / total) * 360;
                // Tiny epsilon to avoid degenerate arcs at exactly 360°
                const safeSpan = Math.min(span, 359.99);
                const path = arc(CX, CY, rOuter, rInner, cur, cur + safeSpan);
                cur += span;
                return <path key={sIdx} d={path} fill={seg.color} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-4xl font-extrabold leading-none" style={{ color: centerColor }}>
          {summary?.pct_working?.toFixed(0) ?? 0}%
        </div>
        <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: isAllClear ? HEALTH.working : '#64748b' }}>
          {isAllClear ? '✓ All Clear' : 'Working'}
        </div>
      </div>
    </div>
  );
}

// ─── HealthSparkline — 30-day % working mini-chart ────────────────────────
function HealthSparkline({ trend, testid = 'health-sparkline' }) {
  if (!trend || trend.length === 0) return null;
  const W = 320, H = 56;
  const PAD_X = 4, PAD_TOP = 6, PAD_BOTTOM = 12;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const n = trend.length;

  // Y-domain: clamp to [0,100]; map 0→bottom, 100→top
  const yFor = (pct) => PAD_TOP + (1 - Math.max(0, Math.min(100, pct)) / 100) * innerH;
  const xFor = (i) => PAD_X + (i / (n - 1)) * innerW;

  // Build line + area paths
  const points = trend.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`);
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${xFor(n - 1).toFixed(1)},${(PAD_TOP + innerH).toFixed(1)} L ${xFor(0).toFixed(1)},${(PAD_TOP + innerH).toFixed(1)} Z`;

  const first = trend[0];
  const last = trend[n - 1];
  const delta = +(last - first).toFixed(1);
  const trendUp = delta > 0.5;
  const trendDown = delta < -0.5;
  const trendColor = trendUp ? HEALTH.working : trendDown ? HEALTH.red : '#94a3b8';
  const lineColor = gradientColor(last);
  const arrow = trendUp ? '▲' : trendDown ? '▼' : '▬';

  // 80% reference line (deep-red threshold)
  const refY = yFor(80);

  // Identify min point for highlighting
  let minIdx = 0;
  for (let i = 1; i < n; i++) if (trend[i] < trend[minIdx]) minIdx = i;

  return (
    <div className="mt-3 p-2 bg-white border border-slate-200 rounded-md" data-testid={testid}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">30-day trend</span>
        <span className="text-[10px] font-semibold" style={{ color: trendColor }} data-testid={`${testid}-delta`}>
          {arrow} {Math.abs(delta).toFixed(1)}% vs 30d ago
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        {/* 80% threshold reference */}
        <line x1={PAD_X} y1={refY} x2={W - PAD_X} y2={refY}
              stroke="#fecaca" strokeWidth="1" strokeDasharray="2,2" />
        {/* Area fill */}
        <path d={areaPath} fill={lineColor} fillOpacity="0.12" />
        {/* Line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.6"
              strokeLinejoin="round" strokeLinecap="round" />
        {/* End-point dot */}
        <circle cx={xFor(n - 1)} cy={yFor(last)} r="2.5" fill={lineColor} />
        {/* Min-point marker */}
        {trend[minIdx] < 95 && (
          <circle cx={xFor(minIdx)} cy={yFor(trend[minIdx])} r="2"
                  fill="#fff" stroke={HEALTH.red} strokeWidth="1.2" />
        )}
      </svg>
      <div className="flex justify-between text-[9px] text-slate-400 -mt-1">
        <span>30d ago · {first.toFixed(0)}%</span>
        <span>min {trend[minIdx].toFixed(0)}%</span>
        <span>today · {last.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ─── LocationBars — horizontal stacked bars, worst-first ──────────────────
function LocationBars({ items, label = 'Location', testidPrefix = 'loc-bar' }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-3 p-3 bg-white border border-slate-200 rounded-md">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        {label}-wise health (worst first)
      </div>
      {items.map((it, idx) => {
        const segs = [
          { c: it.working, color: HEALTH.working },
          { c: it.yellow,  color: HEALTH.yellow },
          { c: it.orange,  color: HEALTH.orange },
          { c: it.red,     color: HEALTH.red },
        ].filter(s => s.c > 0);
        return (
          <div key={idx} className="flex items-center gap-2 text-[11px]" data-testid={`${testidPrefix}-${idx}`}>
            <div className="w-24 text-right font-semibold text-slate-700 truncate">{it.name}</div>
            <div className="flex-1 h-[18px] flex rounded overflow-hidden border border-slate-200">
              {segs.map((s, i) => (
                <div key={i} style={{ background: s.color, width: `${(s.c / it.total) * 100}%` }}
                     className="flex items-center justify-center text-white text-[9px] font-semibold">
                  {Math.round((s.c / it.total) * 100)}%
                </div>
              ))}
            </div>
            <div className="w-8 text-left text-slate-500">{it.total}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── StationCard ──────────────────────────────────────────────────────────
function StationCard({ card }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 w-[380px] flex flex-col" data-testid={`station-card-${card.station_id}`}>
      <div className="text-center font-bold text-[15px] tracking-wide" data-testid="station-name">{card.station_name}</div>
      <div className="text-center text-[11px] text-slate-500 mb-3">
        {card.summary.total} assets · {card.summary.working}W{card.summary.yellow ? ` ${card.summary.yellow}Y` : ''}{card.summary.orange ? ` ${card.summary.orange}O` : ''}{card.summary.red ? ` ${card.summary.red}R` : ''}
      </div>
      <ConcentricRings rings={card.rings} summary={card.summary} />
      {card.rings.length > 0 && (
        <div className="mt-3 p-2 bg-white border border-slate-200 rounded-md text-[11px] space-y-0.5" data-testid="ring-legend">
          {card.rings.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="flex-1 font-semibold text-slate-700">{r.name}</span>
              <span className="font-mono">
                {r.working}W
                {r.yellow > 0 && <span className="text-yellow-600 ml-1">{r.yellow}Y</span>}
                {r.orange > 0 && <span className="text-orange-600 ml-1">{r.orange}O</span>}
                {r.red > 0 && <span className="text-red-600 ml-1">{r.red}R</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <LocationBars items={card.locations} label="Location" testidPrefix={`loc-bar-${card.station_id}`} />
      <HealthSparkline trend={card.trend_30d} testid={`station-trend-${card.station_id}`} />
    </div>
  );
}

// ─── SupervisorMiniCard (RO/ASUP view) ────────────────────────────────────
function SupervisorMiniCard({ sup, onDrill }) {
  const s = sup.summary;
  const color = gradientColor(s.pct_working);
  return (
    <div onClick={() => onDrill(sup)}
         className="bg-slate-50 border border-slate-200 rounded-xl p-4 w-[300px] cursor-pointer hover:-translate-y-0.5 hover:shadow-md transition-all"
         data-testid={`sup-card-${sup.user_id}`}>
      <div className="font-bold text-sm" data-testid="sup-name">{sup.name}</div>
      <div className="text-[11px] text-slate-500 mb-3">
        SUPERVISOR · {sup.station_count} stations · {s.total} assets
      </div>
      <div className="text-center text-3xl font-extrabold" style={{ color }}>{s.pct_working.toFixed(0)}%</div>
      <div className="text-center text-[10px] uppercase tracking-wider text-slate-500 mb-3">Working (incl. yellow)</div>
      <div className="grid grid-cols-4 gap-1 text-[11px] text-center">
        <div><b className="block text-base text-emerald-600">{s.working}</b>W</div>
        <div><b className="block text-base text-yellow-600">{s.yellow}</b>Y</div>
        <div><b className="block text-base text-orange-600">{s.orange}</b>O</div>
        <div><b className="block text-base text-red-600">{s.red}</b>R</div>
      </div>
      <div className="text-right text-[10px] text-teal-700 font-semibold mt-2 flex items-center justify-end gap-1">
        Click to drill in <ChevronRight className="h-3 w-3" />
      </div>
    </div>
  );
}

// ─── ROCard (Admin/SA view) ───────────────────────────────────────────────
function ROCard({ ro, onDrill }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 w-[380px] flex flex-col cursor-pointer hover:shadow-md transition-shadow"
         onClick={() => onDrill(ro)} data-testid={`ro-card-${ro.user_id}`}>
      <div className="text-center font-bold text-sm">{ro.name}</div>
      <div className="text-center text-[11px] text-slate-500 mb-3">
        {ro.supervisor_count} supervisors · {ro.station_count} stations · {ro.summary.total} assets
      </div>
      <ConcentricRings rings={ro.rings} summary={ro.summary} />
      {ro.rings.length > 0 && (
        <div className="mt-3 p-2 bg-white border border-slate-200 rounded-md text-[11px] space-y-0.5">
          {ro.rings.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="flex-1 font-semibold text-slate-700">{r.name}</span>
              <span className="font-mono">
                {r.working}W
                {r.yellow > 0 && <span className="text-yellow-600 ml-1">{r.yellow}Y</span>}
                {r.orange > 0 && <span className="text-orange-600 ml-1">{r.orange}O</span>}
                {r.red > 0 && <span className="text-red-600 ml-1">{r.red}R</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <LocationBars items={ro.supervisor_bars?.map(s => ({
        name: s.name || '—', working: s.working, yellow: s.yellow,
        orange: s.orange, red: s.red, total: s.total,
      })) || []} label="Supervisor" testidPrefix={`ro-sup-bar-${ro.user_id}`} />
      <div className="text-right text-[10px] text-teal-700 font-semibold mt-2">
        Click to drill into supervisors →
      </div>
    </div>
  );
}

// ─── Drill-down drawer (modal) ────────────────────────────────────────────
function DrillDrawer({ open, onClose, viewerId, target, depth = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [innerDrill, setInnerDrill] = useState(null);

  useEffect(() => {
    if (!open || !target) return;
    setLoading(true);
    const url = `${BACKEND}/api/reports/health/${viewerId}?drill_user_id=${target.user_id}`;
    axios.get(url).then(r => setData(r.data)).catch(e => toast.error('Load failed'))
      .finally(() => setLoading(false));
  }, [open, target, viewerId]);

  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-y-auto" data-testid="drill-drawer">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <div>
              <span className="text-base">{target?.name}</span>
              <span className="text-xs text-slate-500 font-normal ml-2">({target?.role})</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadPdf(viewerId, target.user_id)} data-testid="drill-export-pdf">
                <FileDown className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadExcel(viewerId, target.user_id)} data-testid="drill-export-xlsx">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center p-12"><Loader2 className="animate-spin h-6 w-6 text-teal-700" /></div>}
        {data && data.view === 'stations' && (
          <div className="flex flex-wrap gap-4 pt-2">
            {data.stations.map(s => <StationCard key={s.station_id} card={s} />)}
            {data.stations.length === 0 && (
              <div className="text-sm text-slate-500 py-8 text-center w-full">No stations with assets in scope.</div>
            )}
          </div>
        )}
        {data && data.view === 'supervisors' && (
          <div className="flex flex-wrap gap-4 pt-2">
            {data.supervisors.map(s => <SupervisorMiniCard key={s.user_id} sup={s} onDrill={setInnerDrill} />)}
          </div>
        )}
        {/* Nested drill (RO drilling into a SUP) */}
        {innerDrill && (
          <DrillDrawer open={!!innerDrill} onClose={() => setInnerDrill(null)}
                       viewerId={viewerId} target={innerDrill} depth={depth + 1} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Download helpers ─────────────────────────────────────────────────────
async function _download(url, fname) {
  try {
    const r = await axios.get(url, { responseType: 'blob' });
    const blob = new Blob([r.data], { type: r.headers['content-type'] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast.error('Download failed');
  }
}
async function downloadPdf(viewerId, drillUserId) {
  const q = drillUserId ? `?drill_user_id=${drillUserId}` : '';
  await _download(`${BACKEND}/api/reports/export/pdf/${viewerId}${q}`, `report-${Date.now()}.pdf`);
}
async function downloadExcel(viewerId, drillUserId) {
  const q = drillUserId ? `?drill_user_id=${drillUserId}` : '';
  await _download(`${BACKEND}/api/reports/export/excel/${viewerId}${q}`, `report-${Date.now()}.xlsx`);
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drillTarget, setDrillTarget] = useState(null);

  const load = useCallback(async () => {
    if (!user?._id) return;
    setLoading(true);
    try {
      const r = await axios.get(`${BACKEND}/api/reports/health/${user._id}`);
      setData(r.data);
    } catch (e) {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [user?._id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex justify-center p-16"><Loader2 className="animate-spin h-8 w-8 text-teal-700" /></div>
  );
  if (!data) return null;

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900" data-testid="reports-title">Health Reports</h1>
          <p className="text-sm text-slate-500">
            Generated: {formatDateTime(data.generated_at)} · Viewer role: <b>{data.viewer.role}</b>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadPdf(user._id)} data-testid="export-pdf-btn">
            <FileDown className="h-4 w-4 mr-2" /> Export PDF
          </Button>
          <Button variant="outline" onClick={() => downloadExcel(user._id)} data-testid="export-xlsx-btn">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
          </Button>
        </div>
      </div>

      {data.view === 'stations' && (
        <div className="flex flex-wrap gap-4">
          {data.stations.length === 0 && <p className="text-sm text-slate-500">No stations in scope.</p>}
          {data.stations.map(s => <StationCard key={s.station_id} card={s} />)}
        </div>
      )}

      {data.view === 'supervisors' && (
        <div className="flex flex-wrap gap-4">
          {data.supervisors.length === 0 && <p className="text-sm text-slate-500">No supervisors in scope.</p>}
          {data.supervisors.map(s => <SupervisorMiniCard key={s.user_id} sup={s} onDrill={setDrillTarget} />)}
        </div>
      )}

      {data.view === 'ros' && (
        <div className="flex flex-wrap gap-4">
          {data.ros.length === 0 && <p className="text-sm text-slate-500">No ROs with assets in scope.</p>}
          {data.ros.map(ro => <ROCard key={ro.user_id} ro={ro} onDrill={setDrillTarget} />)}
        </div>
      )}

      <DrillDrawer open={!!drillTarget} onClose={() => setDrillTarget(null)}
                   viewerId={user._id} target={drillTarget} />
    </div>
  );
}
