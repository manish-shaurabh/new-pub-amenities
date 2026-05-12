/**
 * ComparativeReports v3 — Section A drilldown + Section B Station/RO modes.
 *
 *   A. MTTR Explorer — AssetType → Locations (grouped by station) → Assets → History
 *   B. Peer Comparison — pick Station OR RO (single-select) and see SUPs.
 *
 * Visible to SUP / RO / ASUP / Admin / SA.
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, ChevronRight, Home, ChevronDown, AlertTriangle } from 'lucide-react';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { useAuth } from '../lib/auth-context';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import CylinderBar from '../components/CylinderBar';
import ComparativeExportDialog, { ComparativeQuickDownload } from '../components/ComparativeExportDialog';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const WINDOWS = [
  { id: '7', name: '7 days' }, { id: '15', name: '15 days' },
  { id: '30', name: '30 days' }, { id: '90', name: '90 days' },
  { id: 'fy', name: 'Financial Year' }, { id: 'all', name: 'All time' },
];
const STATS = [{ id: 'median', name: 'Median' }, { id: 'mean', name: 'Mean' }];

const STATUS_BADGE = {
  working: { text: 'WORKING', color: '#10b981' },
  yellow:  { text: 'YELLOW',  color: '#eab308' },
  orange:  { text: 'ORANGE',  color: '#f97316' },
  red:     { text: 'RED',     color: '#dc2626' },
};

const DEPT_PALETTE = [
  '#0e7c6b', '#0891b2', '#7c3aed', '#dc2626', '#f59e0b',
  '#10b981', '#3b82f6', '#ec4899', '#84cc16', '#f97316',
];

function semanticColor(value, peerMax) {
  if (value == null || peerMax == null || peerMax === 0) return '#94a3b8';
  const t = Math.max(0, Math.min(1, value / peerMax));
  if (t < 0.33) return lerp('#10b981', '#eab308', t / 0.33);
  if (t < 0.66) return lerp('#eab308', '#f97316', (t - 0.33) / 0.33);
  return lerp('#f97316', '#dc2626', Math.min(1, (t - 0.66) / 0.34));
}
function lerp(a, b, t) {
  const p = (s, i) => parseInt(s.slice(i, i + 2), 16);
  const r = Math.round(p(a, 1) + (p(b, 1) - p(a, 1)) * t);
  const g = Math.round(p(a, 3) + (p(b, 3) - p(a, 3)) * t);
  const bl = Math.round(p(a, 5) + (p(b, 5) - p(a, 5)) * t);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

// ─── Station multi-select ─────────────────────────────────────────────────
function StationMultiSelect({ options, selected, onChange, testid = 'station-picker' }) {
  const [open, setOpen] = useState(false);
  const sel = new Set(selected);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
              data-testid={`${testid}-trigger`}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-white text-left text-sm flex justify-between items-center">
        <span className="truncate">
          {sel.size === 0 ? 'All stations in scope'
            : sel.size <= 2 ? options.filter(o => sel.has(o._id)).map(o => o.name).join(', ')
            : `${sel.size} stations`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-white border rounded-md shadow-lg p-2">
          <button className="w-full text-left text-xs text-teal-700 px-2 py-1 hover:bg-slate-50 rounded"
                  onClick={() => onChange([])}>Clear (all)</button>
          {options.map(o => {
            const on = sel.has(o._id);
            return (
              <label key={o._id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => {
                  const next = new Set(selected);
                  if (on) next.delete(o._id); else next.add(o._id);
                  onChange(Array.from(next));
                }} />
                <span className="truncate">{o.name} {o.code && <span className="text-slate-400 text-[10px]">({o.code})</span>}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section A — MTTR Explorer (Level 1 → 2 → 3 → History) ────────────────
function SectionAExplorer({ user, windowDays, stat, deptId, stationIds }) {
  const [stack, setStack] = useState([{ level: 'type', label: 'All Asset Types' }]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyAsset, setHistoryAsset] = useState(null);
  const cur = stack[stack.length - 1];

  // Reset stack when filters change
  useEffect(() => {
    setStack([{ level: 'type', label: 'All Asset Types' }]);
  }, [deptId, windowDays, stat, stationIds.join(',')]);

  useEffect(() => {
    setLoading(true);
    let url, params;
    if (cur.level === 'type') {
      url = `${BACKEND}/api/reports/comparative/by-asset-type/${user._id}`;
      params = { window_days: windowDays, stat };
      if (deptId) params.dept_id = deptId;
      if (stationIds.length) params.station_ids = stationIds.join(',');
    } else if (cur.level === 'locations') {
      url = `${BACKEND}/api/reports/comparative/asset-type/locations/${user._id}`;
      params = { window_days: windowDays, stat, asset_type_id: cur.parent_id };
      if (stationIds.length) params.station_ids = stationIds.join(',');
    } else if (cur.level === 'assets') {
      url = `${BACKEND}/api/reports/comparative/asset-type/assets/${user._id}`;
      params = { window_days: windowDays, stat, asset_type_id: cur.asset_type_id, location_id: cur.parent_id };
    }
    axios.get(url, { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load Section A data'))
      .finally(() => setLoading(false));
  }, [user._id, windowDays, stat, deptId, stationIds, cur]);

  const popTo = (idx) => setStack(stack.slice(0, idx + 1));

  // ─── Render rows based on level ───
  const rows = useMemo(() => {
    if (!data) return [];
    if (cur.level === 'type') {
      const validRows = (data.rows || []).filter(r => {
        const label = (r.label || '').trim();
        return label && label !== '—';
      });
      const peerMax = Math.max(...validRows.map(r => r[stat] || 0), 1);
      return validRows.map(r => ({
        id: r.asset_type_id,
        label: r.label,
        value: r[stat], n: r.n, min: r.min, max: r.max,
        color: semanticColor(r[stat], peerMax),
        sub: r.n != null ? `min ${r.min ?? '—'} · max ${r.max ?? '—'}` : '',
        drillable: true,
      }));
    }
    if (cur.level === 'locations') {
      // Backend returns groups: [{station_name, locations:[]}]
      const out = [];
      const peerMax = Math.max(
        ...(data.groups || []).flatMap(g => g.locations.map(l => l[stat] || 0)), 1);
      for (const g of data.groups || []) {
        // Insert a station header pseudo-row
        out.push({ _header: true, _station: g.station_name, _code: g.station_code });
        for (const loc of g.locations) {
          out.push({
            id: loc.id,
            label: loc.label,
            sub: loc.asset_count != null ? `${loc.asset_count} asset(s)` : '',
            value: loc[stat], n: loc.n, min: loc.min, max: loc.max,
            color: semanticColor(loc[stat], peerMax),
            drillable: (loc.n || 0) > 0,
            _station_id: g.station_id, _station_name: g.station_name,
          });
        }
      }
      return out;
    }
    if (cur.level === 'assets') {
      const peerMax = Math.max(...(data.rows || []).map(r => r[stat] || 0), 1);
      return (data.rows || []).map(r => ({
        id: r.id,
        label: r.asset_number,
        sub: r.last_inspection_at ? `last insp · ${r.last_inspection_at}` : 'no inspection yet',
        meta: r.days_defective != null ? `defective ${r.days_defective}d` : '',
        value: r[stat], n: r.n, min: r.min, max: r.max,
        color: semanticColor(r[stat], peerMax),
        drillable: true,
        badge: STATUS_BADGE[r.status] || null,
      }));
    }
    return [];
  }, [data, cur, stat]);

  const onSelect = (item) => {
    if (cur.level === 'type') {
      setStack([...stack, { level: 'locations', parent_id: item.id, label: item.label }]);
    } else if (cur.level === 'locations') {
      setStack([...stack, {
        level: 'assets', parent_id: item.id, asset_type_id: cur.parent_id,
        label: `${item._station_name} · ${item.label}`,
      }]);
    } else if (cur.level === 'assets') {
      setHistoryAsset({ id: item.id, number: item.label });
    }
  };

  // Custom render: split rows by _header into station blocks
  const renderRows = () => {
    if (!rows.length) {
      return <p className="text-sm text-slate-500 text-center py-6">No data at this level.</p>;
    }
    if (cur.level !== 'locations') {
      return <CylinderBar data={rows} stat={stat} p90={data?.p90} maxLabel="hrs" onSelect={onSelect} />;
    }
    // Locations grouped: render multiple cylinder blocks with station headers
    const blocks = [];
    let buf = [];
    let header = null;
    for (const r of rows) {
      if (r._header) {
        if (buf.length) blocks.push({ header, items: buf });
        header = { name: r._station, code: r._code };
        buf = [];
      } else {
        buf.push(r);
      }
    }
    if (buf.length) blocks.push({ header, items: buf });
    return (
      <div className="space-y-4">
        {blocks.map((b, i) => (
          <div key={i} className="border-l-4 border-teal-700 pl-3 py-1">
            <div className="text-xs font-semibold text-teal-800 mb-1">
              {b.header.name}
              {b.header.code && <span className="ml-2 text-slate-400 font-normal">[{b.header.code}]</span>}
            </div>
            <CylinderBar data={b.items} stat={stat} p90={data?.p90} maxLabel="hrs" onSelect={onSelect} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div data-testid="section-a-explorer">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-xs mb-3">
        {stack.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-slate-400" />}
            <button onClick={() => popTo(i)}
                    className={`${i === stack.length - 1 ? 'font-semibold text-slate-800' : 'text-teal-700 hover:underline'}`}
                    data-testid={`section-a-crumb-${i}`}>
              {i === 0 ? <Home className="inline h-3 w-3 mr-0.5" /> : null}{s.label}
            </button>
          </span>
        ))}
        <span className="ml-3 text-[10px] text-slate-400">
          (Click a bar to drill {cur.level === 'assets' ? 'into asset history' : 'down'})
        </span>
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />
      ) : renderRows()}

      <AssetHistoryDrawer
        assetId={historyAsset?.id} assetNumber={historyAsset?.number}
        open={!!historyAsset} onOpenChange={(o) => !o && setHistoryAsset(null)}
      />
    </div>
  );
}

// ─── Section B — Station OR RO mode ────────────────────────────────────────
function SectionBPeers({ user, windowDays, stat, deptId }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState('station');  // 'station' | 'ro'
  const [stationId, setStationId] = useState('');
  const [roId, setRoId] = useState('');
  const [stations, setStations] = useState([]);
  const [ros, setRos] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load stations once
  useEffect(() => {
    axios.get(`${BACKEND}/api/stations`).then(r => setStations(r.data || [])).catch(() => {});
  }, []);

  // Load ROs (cascade with deptId)
  useEffect(() => {
    const params = {};
    if (deptId) params.dept_id = deptId;
    axios.get(`${BACKEND}/api/reports/comparative/ros/${user._id}`, { params })
      .then(r => setRos(r.data.rows || []))
      .catch(() => {});
    setRoId('');
  }, [user._id, deptId]);

  // Fetch data when selection changes
  useEffect(() => {
    if (category === 'station' && stationId) {
      setLoading(true);
      axios.get(`${BACKEND}/api/reports/comparative/station-supervisors/${user._id}`,
                { params: { station_id: stationId, window_days: windowDays, stat } })
        .then(r => setData({ kind: 'station', ...r.data }))
        .catch(() => toast.error('Failed to load station supervisors'))
        .finally(() => setLoading(false));
    } else if (category === 'ro' && roId) {
      setLoading(true);
      axios.get(`${BACKEND}/api/reports/comparative/ro-supervisors/${user._id}`,
                { params: { ro_id: roId, window_days: windowDays, stat } })
        .then(r => setData({ kind: 'ro', ...r.data }))
        .catch(() => toast.error('Failed to load RO supervisors'))
        .finally(() => setLoading(false));
    } else {
      setData(null);
    }
  }, [user._id, category, stationId, roId, windowDays, stat]);

  const deptColor = (deptId) => {
    if (!deptId) return '#94a3b8';
    let h = 0;
    for (const c of String(deptId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return DEPT_PALETTE[h % DEPT_PALETTE.length];
  };

  const rowsForBar = (rows) => {
    const peerMax = Math.max(...rows.map(r => r[stat] || 0), 1);
    return rows.map(r => ({
      id: r.id,
      label: r.name,
      sub: r.employee_id ? `${r.employee_id}` : '',
      value: r[stat], n: r.n, min: r.min, max: r.max,
      color: semanticColor(r[stat], peerMax),
      badge: r.department_code
        ? { text: r.department_code, color: deptColor(r.department_id) }
        : null,
      drillable: true,
    }));
  };

  return (
    <div data-testid="section-b-peers">
      {/* Top toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={(v) => { setCategory(v); setStationId(''); setRoId(''); setData(null); }}>
            <SelectTrigger data-testid="section-b-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="station">Station</SelectItem>
              <SelectItem value="ro">Reporting Officer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">
            {category === 'station' ? 'Pick station' : 'Pick RO'}
            {category === 'ro' && deptId && <span className="ml-2 text-[10px] text-amber-700">(filtered by dept)</span>}
          </Label>
          {category === 'station' ? (
            <Select value={stationId} onValueChange={setStationId}>
              <SelectTrigger data-testid="section-b-station"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name} {s.code && `[${s.code}]`}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select value={roId} onValueChange={setRoId}>
              <SelectTrigger data-testid="section-b-ro"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {ros.length === 0 ? <div className="px-3 py-2 text-xs text-slate-500">No ROs found</div> :
                  ros.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.department_code}{r.station_codes.length ? ` · [${r.station_codes.join(', ')}]` : ''}
                    </SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />
        : !data ? <p className="text-sm text-slate-500 text-center py-6">
            Pick a {category === 'station' ? 'station' : 'reporting officer'} to compare supervisors.
          </p>
        : data.kind === 'station' ? (
            <div>
              <div className="mb-2 text-sm">
                <span className="font-semibold text-slate-800">{data.station_name}</span>
                {data.station_code && <span className="ml-2 text-slate-400 text-xs">[{data.station_code}]</span>}
                <span className="ml-3 text-xs text-slate-500">{data.rows.length} supervisor(s)</span>
              </div>
              {!data.rows.length ? <p className="text-sm text-slate-500 text-center py-6">No supervisors at this station.</p>
                : <CylinderBar data={rowsForBar(data.rows)} stat={stat} p90={data.p90} maxLabel="hrs"
                               onSelect={(it) => navigate(`/performance/${it.id}`)} />}
            </div>
          ) : (
            <div>
              {/* RO header */}
              <div className="rounded-lg border border-slate-200 bg-gradient-to-r from-teal-50 to-white p-3 mb-3">
                <div className="flex items-baseline flex-wrap gap-2">
                  <div className="text-base font-semibold text-slate-800">{data.ro.name}</div>
                  <div className="text-xs text-slate-500">{data.ro.employee_id}</div>
                  <div className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                       style={{ background: deptColor(data.ro.id) }}>{data.ro.department_code}</div>
                  <div className="text-xs text-slate-500">
                    {data.ro.station_codes.length ? `[${data.ro.station_codes.join(', ')}]` : ''}
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Average MTTR</div>
                    <div className="text-2xl font-extrabold text-teal-700">
                      {data.ro.avg_mttr != null ? `${data.ro.avg_mttr} hrs` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Supervisors</div>
                    <div className="text-2xl font-extrabold text-slate-700">{data.ro.sup_count}</div>
                  </div>
                </div>
              </div>
              {!data.rows.length ? <p className="text-sm text-slate-500 text-center py-6">No supervisors under this RO.</p>
                : <CylinderBar data={rowsForBar(data.rows)} stat={stat} p90={data.p90} maxLabel="hrs"
                               onSelect={(it) => navigate(`/performance/${it.id}`)} />}
            </div>
          )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════
export default function ComparativeReports() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [windowDays, setWindowDays] = useState('90');
  const [stat, setStat] = useState('median');
  const [deptId, setDeptId] = useState('');
  const [stationIds, setStationIds] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      axios.get(`${BACKEND}/api/asset-types`).then(r => r.data || []).catch(() => []),
      axios.get(`${BACKEND}/api/departments`).then(r => r.data || []).catch(() => []),
      axios.get(`${BACKEND}/api/stations`).then(r => r.data || []).catch(() => []),
    ]).then(([asset_types, departments, stations]) => {
      setMeta({ asset_types, departments, stations });
    });
  }, []);

  const isAllowed = useMemo(() => {
    return ['supervisor', 'reporting_officer', 'approving_supervisor', 'admin', 'superadmin'].includes(user?.role);
  }, [user]);

  if (!isAllowed) return <p className="p-6 text-sm text-slate-500">No access.</p>;
  if (!meta) return <Loader2 className="h-8 w-8 animate-spin text-teal-700 mx-auto py-12" />;

  return (
    <div className="space-y-4" data-testid="comparative-root">
      {/* Quick download bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-slate-500">
          Export the current view (filters & drill state) as PDF or Excel.
        </div>
        <ComparativeQuickDownload
          user={user} windowDays={windowDays} stat={stat}
          deptId={deptId} assetTypeIds={[]}
          drillState={{ level: 'station', parent_id: null, parent_asset_type_id: null }}
          onOpenSettings={() => setExportOpen(true)}
        />
      </div>
      <ComparativeExportDialog
        open={exportOpen} onOpenChange={setExportOpen}
        user={user} windowDays={windowDays} stat={stat}
        deptId={deptId} assetTypeIds={[]}
        drillState={{ level: 'station', parent_id: null, parent_asset_type_id: null }}
      />

      {/* Top filter bar */}
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
            <Label className="text-xs">Stations (Section A)</Label>
            <StationMultiSelect options={meta.stations} selected={stationIds} onChange={setStationIds} testid="comp-stations" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>A · MTTR Explorer</span>
            <span className="text-[11px] font-normal text-slate-500">
              Asset Type → Locations (by station) → Assets → Inspection History
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SectionAExplorer user={user} windowDays={windowDays} stat={stat}
                            deptId={deptId} stationIds={stationIds} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span>B · Peer Comparison</span>
            <span className="text-[11px] font-normal text-slate-500">
              Pick a Station or Reporting Officer · click a supervisor for their performance sheet
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SectionBPeers user={user} windowDays={windowDays} stat={stat} deptId={deptId} />
        </CardContent>
      </Card>

      {/* Friendly warning if any unnamed asset-types exist */}
      {meta.asset_types.some(t => !t.name || !t.name.trim()) && (user?.role === 'admin' || user?.role === 'superadmin') && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>
            Some asset-types have no name and show as <em>(unnamed)</em>. Rename them in Admin → Asset Types for cleaner reports.
          </span>
        </div>
      )}
    </div>
  );
}
