/**
 * ComparativeReports — peer/asset comparison views inside /reports.
 *
 *   A. MTTR by Asset Type — horizontal aqua-glass CylinderBar list (semantic color)
 *   B. Peer Comparison    — RadarChart (axes = asset-types, polygons = supervisors)
 *   C. 4-level drilldown  — Station → Location summary → Location asset-types → Individual assets
 *
 * Visible to SUP/RO/ASUP/Admin/SA. Inspectors blocked by route guard.
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, ChevronRight, Home } from 'lucide-react';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { useAuth } from '../lib/auth-context';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import CylinderBar from '../components/CylinderBar';
import RadarChart from '../components/RadarChart';

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

// Vibrant per-asset-type palette (used for Card C clusters)
const ASSET_TYPE_PALETTE = [
  '#0e7c6b', '#0891b2', '#7c3aed', '#dc2626', '#f59e0b',
  '#10b981', '#3b82f6', '#ec4899', '#84cc16', '#f97316',
  '#06b6d4', '#a855f7'
];

// Semantic color: low MTTR (fast repair) = green, high = red.
// Used in Card A/single-bar contexts where the value itself encodes "good vs bad".
function semanticColor(value, peerMax) {
  if (value == null || peerMax == null || peerMax === 0) return '#94a3b8';
  const t = Math.max(0, Math.min(1, value / peerMax));
  // Green (#10b981) → Yellow (#eab308) → Orange (#f97316) → Red (#dc2626)
  if (t < 0.33) {
    const k = t / 0.33;
    return lerp('#10b981', '#eab308', k);
  } else if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    return lerp('#eab308', '#f97316', k);
  } else {
    const k = Math.min(1, (t - 0.66) / 0.34);
    return lerp('#f97316', '#dc2626', k);
  }
}
function lerp(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

// ─── Card A: MTTR by Asset Type — horizontal cylinder bars ────────────────
function CardA({ user, windowDays, stat, deptId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const params = { window_days: windowDays, stat };
    if (deptId) params.dept_id = deptId;
    axios.get(`${BACKEND}/api/reports/comparative/by-asset-type/${user._id}`, { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load Card A'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, deptId]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />;
  if (!data?.rows?.length) return <p className="text-sm text-slate-500 text-center py-6">No resolved repairs in window.</p>;
  const peerMax = Math.max(...data.rows.map(r => r[stat] || 0), 1);
  // p90 across rows for broken-axis
  const sorted = [...data.rows.map(r => r[stat]).filter(v => v != null)].sort((a, b) => a - b);
  const p90 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.9)] : null;
  const items = data.rows.map(r => ({
    id: r.asset_type_id,
    label: r.label,
    value: r[stat],
    n: r.n, min: r.min, max: r.max,
    color: semanticColor(r[stat], peerMax),
    sub: r.n != null ? `min ${r.min ?? '—'} · max ${r.max ?? '—'}` : '',
  }));
  return <CylinderBar data={items} stat={stat} p90={p90} maxLabel="hrs" />;
}

// ─── Card B: Peer Comparison — RadarChart ─────────────────────────────────
function CardB({ user, windowDays, stat, assetTypeIds, deptId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const params = { window_days: windowDays, stat };
    if (deptId) params.dept_id = deptId;
    if (assetTypeIds && assetTypeIds.length) params.asset_type_ids = assetTypeIds.join(',');
    axios.get(`${BACKEND}/api/reports/comparative/by-supervisor-radar/${user._id}`, { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load Card B'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, assetTypeIds, deptId]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />;
  if (!data?.axes?.length) return <p className="text-sm text-slate-500 text-center py-6">No data for radar.</p>;
  if (data.axes.length < 3) return <p className="text-sm text-slate-500 text-center py-6">Need ≥3 asset types for radar (currently {data.axes.length}).</p>;
  return (
    <div>
      {data.anonymised && (
        <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2">
          Peers are anonymised. Only your own polygon shows your name.
        </p>
      )}
      <RadarChart axes={data.axes} series={data.series} stat={stat} maxLabel="hrs" />
    </div>
  );
}

// ─── Card C: 4-level drilldown using horizontal CylinderBar ───────────────
function CardC({ user, windowDays, stat, assetTypeIds, deptId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Drill stack — each entry: { level, parent_id, parent_asset_type_id, label }
  const [stack, setStack] = useState([{ level: 'station', parent_id: null, parent_asset_type_id: null, label: 'All Stations' }]);
  const cur = stack[stack.length - 1];
  const [historyAsset, setHistoryAsset] = useState(null);

  // Reset stack when filters change so drilldown context stays consistent
  useEffect(() => {
    setStack([{ level: 'station', parent_id: null, parent_asset_type_id: null, label: 'All Stations' }]);
  }, [deptId, assetTypeIds.join(','), windowDays]);

  useEffect(() => {
    setLoading(true);
    const params = { level: cur.level, window_days: windowDays, stat };
    if (cur.parent_id) params.parent_id = cur.parent_id;
    if (cur.parent_asset_type_id) params.parent_asset_type_id = cur.parent_asset_type_id;
    if (deptId) params.dept_id = deptId;
    if (assetTypeIds && assetTypeIds.length) params.asset_type_ids = assetTypeIds.join(',');
    axios.get(`${BACKEND}/api/reports/comparative/grouped/${user._id}`, { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load drilldown chart'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, assetTypeIds, deptId, cur.level, cur.parent_id, cur.parent_asset_type_id]);

  const drillInto = (g, bar) => {
    if (cur.level === 'station') {
      setStack([...stack, { level: 'location_summary', parent_id: g.id, parent_asset_type_id: null, label: g.label }]);
    } else if (cur.level === 'location_summary') {
      setStack([...stack, { level: 'location_types', parent_id: g.id, parent_asset_type_id: null, label: g.label }]);
    } else if (cur.level === 'location_types') {
      // g.id is the asset_type_id at this level
      setStack([...stack, { level: 'asset', parent_id: cur.parent_id, parent_asset_type_id: g.id, label: g.label }]);
    } else if (cur.level === 'asset') {
      // Open asset history
      setHistoryAsset({ id: g.id, number: g.label });
    }
  };
  const popTo = (idx) => setStack(stack.slice(0, idx + 1));

  // Build display rows for cylinder bars
  // For "station" level we have clustered bars per asset-type → one cylinder PER (station, asset-type) row.
  // For other levels each group has 1 bar → one cylinder per group.
  const rows = useMemo(() => {
    if (!data?.groups) return [];
    if (cur.level === 'station') {
      const out = [];
      for (const g of data.groups) {
        for (const b of g.bars) {
          if ((b.n || 0) === 0) continue; // skip empty bars at station level
          out.push({
            id: `${g.id}::${b.asset_type_id}`,
            label: `${g.label}`,
            sub: b.asset_type,
            value: b[stat],
            n: b.n, min: b.min, max: b.max,
            color: b.color,
            drillable: true,
            _group: g, _bar: b,
          });
        }
      }
      out.sort((a, b) => (b.value || 0) - (a.value || 0));
      return out;
    }
    return data.groups.map((g) => {
      const b = g.bars[0];
      return {
        id: g.id,
        label: g.label,
        sub: b?.asset_count != null ? `${b.asset_count} assets · ${b.asset_type || ''}` : (b?.asset_type || ''),
        value: b?.[stat],
        n: b?.n, min: b?.min, max: b?.max,
        color: b?.color || '#0e7c6b',
        drillable: !!g.drillable || cur.level === 'asset',
        _group: g, _bar: b,
      };
    });
  }, [data, cur.level, stat]);

  return (
    <div data-testid="card-c-root">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-xs mb-3">
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
          (Click a bar to drill {cur.level === 'asset' ? 'into asset history' : 'down'})
        </span>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />
      ) : !rows.length ? (
        <p className="text-sm text-slate-500 text-center py-6">No data at this level.</p>
      ) : (
        <CylinderBar
          data={rows}
          stat={stat}
          p90={data?.p90}
          maxLabel="hrs"
          onSelect={(item) => drillInto(item._group, item._bar)}
        />
      )}

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
  const [deptId, setDeptId] = useState('');
  const [assetTypeIds, setAssetTypeIds] = useState([]);

  useEffect(() => {
    Promise.all([
      axios.get(`${BACKEND}/api/asset-types`).then(r => r.data || []).catch(() => []),
      axios.get(`${BACKEND}/api/departments`).then(r => r.data || []).catch(() => []),
    ]).then(([asset_types, departments]) => {
      setMeta({ asset_types, departments });
    });
  }, []);

  // Cascade: when dept changes, drop selected asset-type-ids that aren't in dept
  useEffect(() => {
    if (!meta || !deptId) return;
    const inDept = new Set(meta.asset_types.filter(t => t.department_id === deptId).map(t => t._id));
    setAssetTypeIds(prev => prev.filter(id => inDept.has(id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId]);

  const isAllowed = useMemo(() => {
    return ['supervisor', 'reporting_officer', 'approving_supervisor', 'admin', 'superadmin'].includes(user?.role);
  }, [user]);

  if (!isAllowed) return <p className="p-6 text-sm text-slate-500">No access.</p>;
  if (!meta) return <Loader2 className="h-8 w-8 animate-spin text-teal-700 mx-auto py-12" />;

  const filteredAssetTypes = deptId
    ? meta.asset_types.filter(t => t.department_id === deptId)
    : meta.asset_types;

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
            <Label className="text-xs">Department</Label>
            <Select value={deptId || '__all'} onValueChange={(v) => setDeptId(v === '__all' ? '' : v)}>
              <SelectTrigger data-testid="comp-dept"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All departments</SelectItem>
                {meta.departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Asset Types {assetTypeIds.length ? `(${assetTypeIds.length})` : '(top 5)'}</Label>
            <CardCAssetTypePicker options={filteredAssetTypes} selected={assetTypeIds} onChange={setAssetTypeIds} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">A · MTTR by Asset Type (your scope)</CardTitle>
            <p className="text-[11px] text-slate-500">
              Lower is better — green = fast repair, red = slow.
            </p>
          </CardHeader>
          <CardContent><CardA user={user} windowDays={windowDays} stat={stat} deptId={deptId} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">B · Peer Comparison Radar</CardTitle>
            <p className="text-[11px] text-slate-500">
              Each axis = one asset-type. You vs peer supervisors in same department.
            </p>
          </CardHeader>
          <CardContent>
            <CardB user={user} windowDays={windowDays} stat={stat} assetTypeIds={assetTypeIds} deptId={deptId} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">C · 4-level Drilldown</CardTitle>
          <p className="text-[11px] text-slate-500">
            Station → Location summary → Location asset-types → Individual assets. Click a bar to drill in.
          </p>
        </CardHeader>
        <CardContent>
          <CardC user={user} windowDays={windowDays} stat={stat} assetTypeIds={assetTypeIds} deptId={deptId} />
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
        <span className="truncate">{sel.size === 0 ? 'Default (top 5 in scope)' : `${sel.size} selected`}</span>
        <ChevronRight className="h-3 w-3 text-slate-400 rotate-90" />
      </button>
      {openMenu && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white border rounded-md shadow-lg p-2">
          <button className="w-full text-left text-xs text-teal-700 px-2 py-1 hover:bg-slate-50 rounded"
                  onClick={() => onChange([])} data-testid="comp-types-clear">
            Clear (use top 5 default)
          </button>
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
