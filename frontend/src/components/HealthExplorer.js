/**
 * HealthExplorer — Default dashboard view (Feb 2026)
 *
 * Mirrors Comparative Reports → Section A layout but for ASSET HEALTH (not MTTR).
 * 4-level drill backbone:
 *   By Asset Type mode: AssetType → Station → Location → individual Assets
 *   By Station mode:    Station   → AssetType → Location → individual Assets
 *   Level 4 row click → opens existing <AssetHistoryDrawer>.
 *
 * Bars use the existing <CylinderBar> (aqua-glass gradient). Color is
 * threshold-tinted: ≥90% aqua · 70-90% amber · <70% red.
 *
 * Top toolbar: multi-select Stations / Departments / Asset Types (instant
 * refilter). Mode toggle persisted in localStorage('health-explorer-mode').
 *
 * Scoping: server enforces role-scope. Viewer / SA / Admin see global.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { ChevronRight, RefreshCw, Loader2, Filter, X, Activity } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import CylinderBar from './CylinderBar';
import AssetHistoryDrawer from './AssetHistoryDrawer';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Checkbox } from './ui/checkbox';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const MODE_KEY = 'health-explorer-mode';

function bucketChip(label, n, color, key) {
  return (
    <span key={key} className="inline-flex items-center gap-1 text-[11px]"
          style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: color }} />
      {label} <strong>{n}</strong>
    </span>
  );
}

function MultiSelectChip({ label, options, selected, onChange, testid }) {
  const allSelected = selected.length === 0 || selected.length === options.length;
  const display = allSelected ? `All ${label}` : `${selected.length} ${label}`;
  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8" data-testid={testid}>
          <Filter className="h-3 w-3" />
          <span className="text-xs">{display}</span>
          {!allSelected && (
            <X className="h-3 w-3 ml-1 opacity-60 hover:opacity-100"
               onClick={(e) => { e.stopPropagation(); onChange([]); }} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">{label}</span>
          <button className="text-[10px] text-teal-600 hover:underline"
                  onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {options.length === 0 && <p className="text-xs text-slate-400 p-2 italic">None</p>}
          {options.map(o => (
            <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
              <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
              <span className="text-xs text-slate-700">{o.name}{o.code ? ` (${o.code})` : ''}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function HealthExplorer() {
  const { user } = useAuth();
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'asset_type'; } catch { return 'asset_type'; }
  });
  const [filters, setFilters] = useState({ stations: [], depts: [], types: [] });
  const [filterOpts, setFilterOpts] = useState({ stations: [], departments: [], asset_types: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState({ asset_type_id: null, station_id: null, location_id: null });
  const [openAsset, setOpenAsset] = useState(null);  // {id, asset_number}

  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch {} }, [mode]);

  // Reset drill when mode changes
  useEffect(() => {
    setDrill({ asset_type_id: null, station_id: null, location_id: null });
  }, [mode]);

  // Load filter options once
  useEffect(() => {
    if (!user?._id) return;
    axios.get(`${BACKEND}/api/dashboard/health-explorer/${user._id}/filters`)
      .then(r => setFilterOpts(r.data))
      .catch(() => {});
  }, [user]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ mode });
    if (drill.asset_type_id) p.set('asset_type_id', drill.asset_type_id);
    if (drill.station_id) p.set('station_id', drill.station_id);
    if (drill.location_id) p.set('location_id', drill.location_id);
    if (filters.stations.length) p.set('station_ids', filters.stations.join(','));
    if (filters.depts.length) p.set('dept_ids', filters.depts.join(','));
    if (filters.types.length) p.set('asset_type_ids', filters.types.join(','));
    return p.toString();
  }, [mode, drill, filters]);

  const load = useCallback(async () => {
    if (!user?._id) return;
    setLoading(true);
    try {
      const r = await axios.get(`${BACKEND}/api/dashboard/health-explorer/${user._id}?${queryParams}`);
      setData(r.data);
    } catch (e) {
      toast.error('Failed to load health data');
    } finally { setLoading(false); }
  }, [user, queryParams]);

  useEffect(() => { load(); }, [load]);

  const onBarSelect = (row) => {
    if (!row.drillable) {
      // Level 4 — open asset history drawer
      setOpenAsset({ id: row.id, asset_number: row.asset_number || row.label });
      return;
    }
    // Drill deeper based on current level and mode
    const level = data?.level || 1;
    if (mode === 'asset_type') {
      if (level === 1) setDrill(d => ({ ...d, asset_type_id: row.id }));
      else if (level === 2) setDrill(d => ({ ...d, station_id: row.id }));
      else if (level === 3) setDrill(d => ({ ...d, location_id: row.id }));
    } else {
      if (level === 1) setDrill(d => ({ ...d, station_id: row.id }));
      else if (level === 2) setDrill(d => ({ ...d, asset_type_id: row.id }));
      else if (level === 3) setDrill(d => ({ ...d, location_id: row.id }));
    }
  };

  const onCrumbClick = (idx) => {
    // Drop ancestors beyond idx
    const crumbs = data?.breadcrumb || [];
    const next = { asset_type_id: null, station_id: null, location_id: null };
    for (let i = 0; i <= idx; i++) {
      const c = crumbs[i];
      if (c.kind === 'asset_type') next.asset_type_id = c.id;
      else if (c.kind === 'station') next.station_id = c.id;
      else if (c.kind === 'location') next.location_id = c.id;
    }
    setDrill(next);
  };

  const goHome = () => setDrill({ asset_type_id: null, station_id: null, location_id: null });

  const s = data?.summary;
  const buckets = s?.buckets || { working: 0, yellow: 0, orange: 0, red: 0 };

  return (
    <div className="space-y-3" data-testid="health-explorer">
      {/* Top header card with summary + mode toggle */}
      <Card data-testid="he-summary-card">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full flex items-center justify-center"
                   style={{ background: (s?.color || '#0891b2') + '20' }}>
                <Activity className="h-5 w-5" style={{ color: s?.color || '#0891b2' }} />
              </div>
              <div>
                <CardTitle className="text-base">Health Explorer</CardTitle>
                <p className="text-xs text-slate-500">
                  Drill from {mode === 'asset_type' ? 'Asset Type' : 'Station'} → Station → Location → Individual Asset
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-2xl font-bold" style={{ color: s?.color || '#0891b2' }}>
                  {s?.pct_healthy ?? '—'}%
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Healthy · {s?.healthy ?? 0} of {s?.total ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Bucket chips */}
          <div className="flex items-center gap-4 mt-2 flex-wrap text-xs">
            {bucketChip('Working', buckets.working, '#0e7c6b', 'w')}
            {bucketChip('Yellow', buckets.yellow, '#eab308', 'y')}
            {bucketChip('Orange', buckets.orange, '#f97316', 'o')}
            {bucketChip('Red', buckets.red, '#dc2626', 'r')}
          </div>
        </CardHeader>

        <CardContent className="pt-2 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Mode toggle pill */}
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"
                 data-testid="he-mode-toggle">
              <button data-testid="he-mode-type"
                onClick={() => setMode('asset_type')}
                className={`px-3 py-1 text-xs rounded-full transition ${
                  mode === 'asset_type' ? 'bg-white shadow text-teal-700 font-semibold' : 'text-slate-500'
                }`}>By Asset Type</button>
              <button data-testid="he-mode-station"
                onClick={() => setMode('station')}
                className={`px-3 py-1 text-xs rounded-full transition ${
                  mode === 'station' ? 'bg-white shadow text-teal-700 font-semibold' : 'text-slate-500'
                }`}>By Station</button>
            </div>

            <div className="mx-1 h-5 w-px bg-slate-200" />

            <MultiSelectChip label="Stations"
              options={filterOpts.stations} selected={filters.stations}
              onChange={(v) => { setFilters(f => ({ ...f, stations: v })); goHome(); }}
              testid="he-filter-stations" />
            <MultiSelectChip label="Departments"
              options={filterOpts.departments} selected={filters.depts}
              onChange={(v) => { setFilters(f => ({ ...f, depts: v })); goHome(); }}
              testid="he-filter-depts" />
            <MultiSelectChip label="Asset Types"
              options={filterOpts.asset_types} selected={filters.types}
              onChange={(v) => { setFilters(f => ({ ...f, types: v })); goHome(); }}
              testid="he-filter-types" />

            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={load}
                      disabled={loading} className="gap-1.5 h-7" data-testid="he-refresh">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                <span className="text-xs">Refresh</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breadcrumb */}
      {(data?.breadcrumb?.length || 0) > 0 && (
        <div className="flex items-center gap-1.5 text-xs px-1" data-testid="he-breadcrumb">
          <button onClick={goHome}
                  className="text-teal-700 hover:underline font-medium">
            {mode === 'asset_type' ? 'All Types' : 'All Stations'}
          </button>
          {data.breadcrumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-slate-400" />
              {i < data.breadcrumb.length - 1 ? (
                <button onClick={() => onCrumbClick(i)}
                        className="text-teal-700 hover:underline">{c.label}</button>
              ) : (
                <span className="text-slate-700 font-semibold">{c.label}</span>
              )}
            </span>
          ))}
          <Badge variant="outline" className="ml-auto text-[10px]">Level {data.level}</Badge>
        </div>
      )}

      {/* Chart card */}
      <Card>
        <CardContent className="pt-4 pb-3">
          {loading && !data ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="h-6 w-6 text-teal-600 animate-spin" />
            </div>
          ) : (data?.rows?.length || 0) === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400 italic">
              No assets match the current filters.
            </p>
          ) : (
            <CylinderBar
              data={data.rows.map(r => ({
                id: r.id, label: r.label, value: r.value, n: r.n,
                min: 0, max: 100, color: r.color, sub: r.sub, drillable: r.drillable,
                asset_number: r.asset_number,
                status: r.status,
              }))}
              stat="median" p90={null} maxLabel="%"
              onSelect={onBarSelect} />
          )}
        </CardContent>
      </Card>

      <AssetHistoryDrawer
        assetId={openAsset?.id}
        assetNumber={openAsset?.asset_number}
        open={!!openAsset}
        onOpenChange={(o) => !o && setOpenAsset(null)} />
    </div>
  );
}
