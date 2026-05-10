/**
 * ComparativeReports — new tab inside /reports.
 *
 * Three cards:
 *   A. MTTR by Asset Type (single-bar list, scoped to user's stations)
 *   B. Comparative Supervisors (peer comparison; SUP sees anonymised peers)
 *   C. Grouped Vertical Bar Chart drillable Station → Location → Asset
 *
 * Visible to SUP / RO / ASUP / Admin / SA. Inspectors are excluded by route guard.
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, ChevronRight, Home } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { useAuth } from '../lib/auth-context';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const WINDOWS = [
  { id: '7', name: '7 days' }, { id: '15', name: '15 days' },
  { id: '30', name: '30 days' }, { id: '90', name: '90 days' },
  { id: 'fy', name: 'Financial Year' }, { id: 'all', name: 'All time' },
];

const STATS = [
  { id: 'median', name: 'Median' },
  { id: 'mean', name: 'Mean' },
];

const PALETTE = ['#0e7c6b', '#0891b2', '#7c3aed', '#dc2626', '#f59e0b',
                 '#10b981', '#3b82f6', '#ec4899', '#84cc16', '#f97316'];

// ─── Card A: MTTR by Asset Type (simple bars) ─────────────────────────────
function CardA({ user, windowDays, stat }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    axios.get(`${BACKEND}/api/reports/comparative/by-asset-type/${user._id}`,
              { params: { window_days: windowDays, stat } })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load Card A'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />;
  if (!data?.rows?.length) return <p className="text-sm text-slate-500 text-center py-6">No resolved repairs in window.</p>;
  const max = Math.max(...data.rows.map(r => r[stat] || 0));
  return (
    <div className="space-y-2">
      {data.rows.map((r, i) => {
        const val = r[stat];
        const pct = max > 0 ? (val / max) * 100 : 0;
        return (
          <div key={r.asset_type_id} className="grid grid-cols-[140px_1fr_140px] items-center gap-3 text-sm">
            <div className="truncate font-medium text-slate-700" title={r.label}>{r.label}</div>
            <div className="h-5 bg-slate-100 rounded overflow-hidden">
              <div className="h-full" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} />
            </div>
            <div className="text-right tabular-nums text-slate-600">
              {val == null ? '—' : `${val} hrs`} <span className="text-slate-400 text-[10px]">(n={r.n}, min={r.min}, max={r.max})</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card B: Comparative Supervisors ──────────────────────────────────────
function CardB({ user, windowDays, stat, assetTypeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!assetTypeId) { setData(null); setLoading(false); return; }
    setLoading(true);
    axios.get(`${BACKEND}/api/reports/comparative/by-supervisor/${user._id}`,
              { params: { window_days: windowDays, stat, asset_type_id: assetTypeId } })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load Card B'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, assetTypeId]);

  if (!assetTypeId) return <p className="text-sm text-slate-500 text-center py-6">Select an asset type to compare supervisors.</p>;
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />;
  if (!data?.rows?.length) return <p className="text-sm text-slate-500 text-center py-6">No repairs in window for this asset type.</p>;
  const max = Math.max(...data.rows.map(r => r[stat] || 0));
  return (
    <div>
      {data.anonymised && <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2">
        Peers are anonymised. Only your own bar shows your name.
      </p>}
      <div className="space-y-2">
        {data.rows.map((r, i) => {
          const val = r[stat];
          const pct = max > 0 ? (val / max) * 100 : 0;
          return (
            <div key={i} className={`grid grid-cols-[140px_1fr_140px] items-center gap-3 text-sm ${r.is_self ? 'bg-teal-50 px-2 py-1 rounded -mx-2' : ''}`}>
              <div className="truncate font-medium text-slate-700" title={r.label}>
                {r.is_self && <span className="text-teal-700 font-bold mr-1">●</span>}
                {r.label}
              </div>
              <div className="h-5 bg-slate-100 rounded overflow-hidden">
                <div className="h-full" style={{ width: `${pct}%`,
                  background: r.is_self ? '#0e7c6b' : '#94a3b8' }} />
              </div>
              <div className="text-right tabular-nums text-slate-600">
                {val == null ? '—' : `${val} hrs`} <span className="text-slate-400 text-[10px]">(n={r.n})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── GroupedBarChart — pure SVG, drillable ───────────────────────────────
function GroupedBarChart({ data, stat, onDrill, onAssetClick }) {
  const groups = data.groups || [];
  const types = data.asset_types || [];
  if (groups.length === 0) return <p className="text-sm text-slate-500 text-center py-6">No data.</p>;
  const isLeaf = data.level === 'asset';
  const W = Math.max(720, groups.length * (isLeaf ? 50 : Math.max(80, types.length * 24 + 30)));
  const H = 320, PAD_T = 20, PAD_B = 70, PAD_L = 50, PAD_R = 12;
  const innerH = H - PAD_T - PAD_B;

  // Find global max
  const allVals = groups.flatMap(g => g.bars.map(b => b[stat] || 0));
  const max = Math.max(...allVals, 1);
  const yFor = (v) => PAD_T + (1 - v / max) * innerH;

  // Group widths
  const groupSlot = (W - PAD_L - PAD_R) / groups.length;
  const barCount = isLeaf ? 1 : Math.max(1, types.length);
  const barW = Math.max(8, (groupSlot * 0.78) / barCount);

  // Y-axis ticks (4 lines)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(max * t * 10) / 10);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="bg-white">
        {/* Y grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yFor(t)} y2={yFor(t)}
                  stroke="#e2e8f0" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '2,2'} />
            <text x={PAD_L - 6} y={yFor(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">{t}</text>
          </g>
        ))}
        <text x="6" y={H / 2} fontSize="9" fill="#64748b" transform={`rotate(-90 12 ${H/2})`}>
          MTTR (hrs)
        </text>

        {/* Groups */}
        {groups.map((g, gIdx) => {
          const cx = PAD_L + gIdx * groupSlot + groupSlot / 2;
          return (
            <g key={g.id}>
              {/* Cluster label */}
              <text x={cx} y={H - PAD_B + 14} fontSize="10" textAnchor="middle"
                    fill={g.drillable ? '#0e7c6b' : '#475569'}
                    style={{ cursor: g.drillable ? 'pointer' : 'default', fontWeight: g.drillable ? 600 : 400 }}
                    onClick={() => g.drillable && onDrill && onDrill(g)}
                    data-testid={`grouped-label-${gIdx}`}>
                {g.label.length > 14 ? g.label.slice(0, 13) + '…' : g.label}
              </text>

              {/* Bars */}
              {g.bars.map((b, bIdx) => {
                const v = b[stat];
                const has = v != null && v > 0;
                const x = cx - (g.bars.length * barW) / 2 + bIdx * barW;
                const y = has ? yFor(v) : yFor(0);
                const h = has ? (yFor(0) - y) : 4;
                const fill = has ? b.color : '#e2e8f0';
                const isClickableLeaf = isLeaf && g.bars.length === 1;
                return (
                  <g key={bIdx}
                     style={{ cursor: (g.drillable || isClickableLeaf) ? 'pointer' : 'default' }}
                     onClick={() => {
                       if (g.drillable) onDrill && onDrill(g);
                       else if (isClickableLeaf) onAssetClick && onAssetClick(g);
                     }}>
                    <rect x={x} y={y} width={barW - 1} height={Math.max(h, 1)}
                          fill={fill} rx="1" data-testid={`grouped-bar-${gIdx}-${bIdx}`}>
                      <title>{b.asset_type}: {has ? `${v} hrs (n=${b.n}, min=${b.min}, max=${b.max})` : 'no data'}</title>
                    </rect>
                    {has && barW >= 18 && (
                      <text x={x + (barW - 1) / 2} y={y - 2} fontSize="8" textAnchor="middle" fill="#0f172a">{v}</text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {!isLeaf && types.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {types.map(t => (
            <div key={t.id} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: t.color }} />
              <span className="text-slate-600">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Card C: Grouped chart with drilldown ─────────────────────────────────
function CardC({ user, windowDays, stat, assetTypeIds }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Drilldown stack: [{level: 'station', parent_id: null, label: 'All Stations'}, ...]
  const [stack, setStack] = useState([{ level: 'station', parent_id: null, label: 'All Stations' }]);
  const cur = stack[stack.length - 1];
  const [historyAsset, setHistoryAsset] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = { level: cur.level, window_days: windowDays, stat };
    if (cur.parent_id) params.parent_id = cur.parent_id;
    if (assetTypeIds && assetTypeIds.length) params.asset_type_ids = assetTypeIds.join(',');
    axios.get(`${BACKEND}/api/reports/comparative/grouped/${user._id}`, { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load grouped chart'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, assetTypeIds, cur.level, cur.parent_id]);

  const drillInto = (g) => {
    const nextLevel = cur.level === 'station' ? 'location' : cur.level === 'location' ? 'asset' : null;
    if (!nextLevel) return;
    setStack([...stack, { level: nextLevel, parent_id: g.id, label: g.label }]);
  };
  const popTo = (idx) => setStack(stack.slice(0, idx + 1));

  return (
    <div data-testid="card-c-root">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs mb-3">
        {stack.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-slate-400" />}
            <button onClick={() => popTo(i)}
                    className={`${i === stack.length - 1 ? 'font-semibold text-slate-800' : 'text-teal-700 hover:underline'}`}
                    data-testid={`card-c-crumb-${i}`}>
              {i === 0 ? <Home className="inline h-3 w-3 mr-0.5" /> : null}{s.label}
            </button>
          </span>
        ))}
        <span className="ml-3 text-[10px] text-slate-400">
          (Click a {cur.level === 'station' ? 'station' : cur.level === 'location' ? 'location' : 'asset'} to drill {cur.level === 'asset' ? 'into history' : 'down'})
        </span>
      </div>
      {loading ? <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" /> :
        data ? <GroupedBarChart data={data} stat={stat}
                                onDrill={drillInto}
                                onAssetClick={(g) => setHistoryAsset({ id: g.id, number: g.label })} />
             : null
      }
      <AssetHistoryDrawer
        assetId={historyAsset?.id} assetNumber={historyAsset?.number}
        open={!!historyAsset} onOpenChange={(o) => !o && setHistoryAsset(null)}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════
export default function ComparativeReports() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [windowDays, setWindowDays] = useState('90');
  const [stat, setStat] = useState('median');
  const [assetTypeId, setAssetTypeId] = useState('');  // for Card B (single)
  const [assetTypeIds, setAssetTypeIds] = useState([]); // for Card C (multi)

  useEffect(() => {
    axios.get(`${BACKEND}/api/asset-types`).then(r => {
      setMeta({ asset_types: r.data || [] });
      if ((r.data || []).length && !assetTypeId) setAssetTypeId(r.data[0]._id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAllowed = useMemo(() => {
    return ['supervisor', 'reporting_officer', 'approving_supervisor', 'admin', 'superadmin'].includes(user?.role);
  }, [user]);

  if (!isAllowed) return <p className="p-6 text-sm text-slate-500">No access.</p>;
  if (!meta) return <Loader2 className="h-8 w-8 animate-spin text-teal-700 mx-auto py-12" />;

  return (
    <div className="space-y-4" data-testid="comparative-root">
      {/* Top bar */}
      <Card>
        <CardContent className="py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Window</Label>
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger data-testid="comp-window"><SelectValue /></SelectTrigger>
              <SelectContent>{WINDOWS.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Stat</Label>
            <Select value={stat} onValueChange={setStat}>
              <SelectTrigger data-testid="comp-stat"><SelectValue /></SelectTrigger>
              <SelectContent>{STATS.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Asset Type (Card B)</Label>
            <Select value={assetTypeId} onValueChange={setAssetTypeId}>
              <SelectTrigger data-testid="comp-asset-type"><SelectValue placeholder="Pick…" /></SelectTrigger>
              <SelectContent>{meta.asset_types.map(t => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Asset Types in Card C ({assetTypeIds.length || 'top 5 default'})</Label>
            <CardCAssetTypePicker options={meta.asset_types} selected={assetTypeIds} onChange={setAssetTypeIds} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">A · MTTR by Asset Type (your scope)</CardTitle></CardHeader>
          <CardContent><CardA user={user} windowDays={windowDays} stat={stat} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">B · Comparative Supervisors (same dept)</CardTitle></CardHeader>
          <CardContent><CardB user={user} windowDays={windowDays} stat={stat} assetTypeId={assetTypeId} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">C · Drilldown: Station → Location → Asset</CardTitle></CardHeader>
        <CardContent>
          <CardC user={user} windowDays={windowDays} stat={stat} assetTypeIds={assetTypeIds} />
        </CardContent>
      </Card>
    </div>
  );
}

function CardCAssetTypePicker({ options, selected, onChange }) {
  const [openMenu, setOpenMenu] = useState(false);
  const sel = new Set(selected);
  return (
    <div className="relative">
      <button type="button"
              onClick={() => setOpenMenu(o => !o)}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-white text-left text-sm flex justify-between items-center"
              data-testid="comp-types-trigger">
        <span className="truncate">{sel.size === 0 ? 'Default (top 5)' : `${sel.size} selected`}</span>
        <ChevronRight className="h-3 w-3 text-slate-400 rotate-90" />
      </button>
      {openMenu && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white border rounded-md shadow-lg p-2">
          <button className="w-full text-left text-xs text-teal-700 px-2 py-1 hover:bg-slate-50 rounded"
                  onClick={() => onChange([])}>Clear (use top 5 default)</button>
          {options.map(o => {
            const on = sel.has(o._id);
            return (
              <label key={o._id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => {
                  const next = new Set(selected);
                  if (on) next.delete(o._id); else next.add(o._id);
                  onChange(Array.from(next));
                }} />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
