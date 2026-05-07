/**
 * Redesigned Superadmin Dashboard.
 *
 * - Overview shows clickable Asset Categories, Stations, and Departments
 *   (each card opens a drill-down list of assets — same UX as RO/ASUP).
 * - Reporting Officers / Approving Supervisors / Supervisors tabs let the
 *   superadmin click any user to "View as <user>" — the dashboard route
 *   uses ?as=<user_id> to render that user's role-specific dashboard.
 * - Multi-station filter scopes the entire overview.
 * - Allocate Assets tab provides single + bulk asset (re)assignment.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { toast } from 'sonner';
import {
  Box, Building2, Layers, Users, ShieldAlert, Wrench, BarChart3, ArrowRight,
  ArrowLeft, ChevronDown, AlertCircle, CheckCircle2, ChevronsUpDown, Check,
  Filter, X, Search, ClipboardList, UserPlus, Boxes, TrendingUp,
} from 'lucide-react';

import { useAuth } from '../../lib/auth-context';
import { errString } from '../../lib/err';
import { dashboardAPI, assetsAPI, usersAPI, stationsAPI, assetTypesAPI, adminAPI } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ScrollArea } from '../ui/scroll-area';
import AdminPerformanceMatrix from '../AdminPerformanceMatrix';

const HEALTH_COLORS = { working: '#0e7c6b', orange: '#f97316', red: '#dc2626', yellow: '#eab308' };

// ----------------------------------------------------------------------------
// Multi-station filter (popover with checkboxes)
// ----------------------------------------------------------------------------
function StationsMultiSelect({ stations, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? stations.filter((s) => (s.name || '').toLowerCase().includes(q)) : stations;
  }, [stations, query]);

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  const clearAll = () => onChange([]);
  const selectAll = () => onChange(stations.map((s) => s._id));

  const label = selected.length === 0
    ? 'All stations'
    : selected.length === 1
      ? (stations.find((s) => s._id === selected[0])?.name || '1 station')
      : `${selected.length} stations`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="justify-between min-w-[200px]"
          data-testid="superadmin-stations-filter"
        >
          <span className="flex items-center gap-2 truncate">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search stations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-muted-foreground">{selected.length} selected</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-primary hover:underline">All</button>
              <button onClick={clearAll} className="text-muted-foreground hover:text-foreground">Clear</button>
            </div>
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1" data-testid="superadmin-station-options-list">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No stations match</p>
          )}
          {filtered.map((s) => {
            const checked = selected.includes(s._id);
            return (
              <button
                key={s._id}
                onClick={() => toggle(s._id)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-muted/40 text-left"
                data-testid={`station-option-${s._id}`}
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="text-sm truncate flex-1">{s.name}</span>
                {checked && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ----------------------------------------------------------------------------
// Reusable health badges
// ----------------------------------------------------------------------------
function HealthBadges({ row }) {
  const issues = (row.orange || 0) + (row.red || 0) + (row.yellow || 0);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
        {row.working || 0} ok
      </Badge>
      {row.orange > 0 && (
        <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">
          {row.orange} orange
        </Badge>
      )}
      {row.red > 0 && (
        <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">
          {row.red} red
        </Badge>
      )}
      {row.yellow > 0 && (
        <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px]">
          {row.yellow} yellow
        </Badge>
      )}
      {issues === 0 && row.asset_count > 0 && (
        <span className="text-[10px] text-muted-foreground">all healthy</span>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Clickable card components for Overview
// ----------------------------------------------------------------------------
function CategoryCard({ c, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={`superadmin-category-${c.asset_type_id}`}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Box className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <h3 className="mt-3 font-medium text-sm">{c.asset_type_name || c.name}</h3>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{c.asset_count}</p>
      <div className="mt-2"><HealthBadges row={c} /></div>
      {typeof c.pct_functional === 'number' && (
        <p className="text-[11px] text-muted-foreground mt-2">{c.pct_functional}% functional time</p>
      )}
    </button>
  );
}

function StationCard({ s, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={`superadmin-station-${s._id}`}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <h3 className="mt-3 font-medium text-sm">{s.name}</h3>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{s.asset_count}</p>
      <div className="mt-2"><HealthBadges row={s} /></div>
      {typeof s.pct_functional === 'number' && (
        <p className="text-[11px] text-muted-foreground mt-2">{s.pct_functional}% functional time</p>
      )}
    </button>
  );
}

function DepartmentCard({ d, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={`superadmin-department-${d._id}`}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <h3 className="mt-3 font-medium text-sm">{d.name}</h3>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{d.asset_count}</p>
      <div className="mt-2"><HealthBadges row={d} /></div>
      {typeof d.pct_functional === 'number' && (
        <p className="text-[11px] text-muted-foreground mt-2">{d.pct_functional}% functional time</p>
      )}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Drill-down view (priority + working asset list)
// ----------------------------------------------------------------------------
function DrillDownView({ title, subtitle, payload, loading, onBack }) {
  const renderRow = (a, isPriority) => (
    <div key={a._id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
          a.health_class === 'red' ? 'bg-red-50 text-red-600' :
          a.health_class === 'orange' ? 'bg-orange-50 text-orange-600' :
          a.health_class === 'yellow' ? 'bg-yellow-50 text-yellow-600' :
          'bg-emerald-50 text-emerald-600'
        }`}>
          {isPriority ? <Wrench className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{a.asset_number}</p>
          <p className="text-xs text-muted-foreground truncate">
            {a.asset_type_name && <>{a.asset_type_name} &middot; </>}
            {a.station_name} &middot; {a.location_name}
            {a.supervisor_name ? <> &middot; {a.supervisor_name}</> : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isPriority && a.defective_since && (
          <span className="text-[11px] text-muted-foreground hidden sm:block">
            since {new Date(a.defective_since).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </span>
        )}
        <Badge className={
          a.health_class === 'red' ? 'bg-red-100 text-red-700 border-red-200 text-[10px]' :
          a.health_class === 'orange' ? 'bg-orange-100 text-orange-700 border-orange-200 text-[10px]' :
          a.health_class === 'yellow' ? 'bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]' :
          'bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]'
        }>
          {a.status === 'needs_repair' ? 'NEEDS REPAIR'
            : a.status === 'pending_approval' ? 'YELLOW'
            : a.status === 'not_ok' ? 'NOT OK'
            : a.health_class === 'working' ? 'OK' : a.health_class.toUpperCase()}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="superadmin-drilldown-back"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <Badge variant="secondary" className="text-xs">{subtitle}</Badge>}
        {payload && (
          <Badge variant="outline" className="text-xs">
            {payload.totals.priority} priority &middot; {payload.totals.working} working
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-14 bg-muted/50 animate-pulse rounded-xl" />)}
        </div>
      ) : !payload ? null : (
        <>
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-500" /> Priority — Not OK / Needs Repair
                <Badge className="ml-auto bg-orange-50 text-orange-700 border-orange-200 text-[10px]">
                  {payload.priority.length}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Sorted by most recent defect first</p>
            </CardHeader>
            <CardContent className="p-0">
              {payload.priority.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-6">No priority items</p>
                : payload.priority.map((a) => renderRow(a, true))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Working
                <Badge className="ml-auto bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                  {payload.working.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payload.working.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-6">No working assets</p>
                : payload.working.map((a) => renderRow(a, false))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// User row (clickable) for ROs / ASUPs / Supervisors
// ----------------------------------------------------------------------------
function UserClickRow({ u, badges, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 hover:border-primary/40 hover:bg-muted/30 transition text-left"
      data-testid={testId}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
          {(u.name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{u.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{u.employee_id}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {badges}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------------
// Allocate Assets tab — single + bulk
// ----------------------------------------------------------------------------
function AllocateAssetsTab({ user, supervisors, stations, onChanged }) {
  const [allAssets, setAllAssets] = useState([]);
  const [allTypes, setAllTypes] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  // Filters for the asset list
  const [stationFilter, setStationFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [supFilter, setSupFilter] = useState('all'); // all | unassigned | <supervisor_id>
  const [search, setSearch] = useState('');

  // Selection
  const [selected, setSelected] = useState(new Set());
  const [bulkSupervisor, setBulkSupervisor] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Single-asset form
  const [singleAssetId, setSingleAssetId] = useState('');
  const [singleSupervisorId, setSingleSupervisorId] = useState('');
  const [singleBusy, setSingleBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadingData(true);
    try {
      const [aRes, tRes] = await Promise.all([
        assetsAPI.list(),
        assetTypesAPI.list(),
      ]);
      setAllAssets(aRes.data || []);
      setAllTypes(tRes.data || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load assets');
    } finally {
      setLoadingData(false);
    }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const stationName = useCallback((id) => stations.find((s) => s._id === id)?.name || '—', [stations]);
  const typeName = useCallback(
    (id) => allTypes.find((t) => t._id === id)?.name || '—', [allTypes]
  );
  const supervisorName = useCallback(
    (id) => supervisors.find((s) => s._id === id)?.name || '—', [supervisors]
  );

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allAssets.filter((a) => {
      if (stationFilter !== 'all' && a.station_id !== stationFilter) return false;
      if (typeFilter !== 'all' && a.asset_type_id !== typeFilter) return false;
      if (supFilter === 'unassigned' && a.assigned_supervisor_id) return false;
      if (supFilter !== 'all' && supFilter !== 'unassigned' && a.assigned_supervisor_id !== supFilter) return false;
      if (q && !(a.asset_number || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allAssets, stationFilter, typeFilter, supFilter, search]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(filteredAssets.map((a) => a._id)));
  const clearSelection = () => setSelected(new Set());

  const doSingle = async () => {
    if (!singleAssetId) { toast.error('Select an asset'); return; }
    setSingleBusy(true);
    try {
      await adminAPI.assignAssetsBulk([singleAssetId], singleSupervisorId || null, user._id);
      toast.success(singleSupervisorId
        ? `Asset assigned to ${supervisorName(singleSupervisorId)}`
        : 'Asset unassigned');
      setSingleAssetId('');
      setSingleSupervisorId('');
      await loadAll();
      onChanged && onChanged();
    } catch (e) {
      console.error(e);
      toast.error(errString(e, 'Failed to assign'));
    } finally {
      setSingleBusy(false);
    }
  };

  const doBulk = async () => {
    if (selected.size === 0) { toast.error('Select at least one asset'); return; }
    setBulkBusy(true);
    try {
      const r = await adminAPI.assignAssetsBulk(Array.from(selected), bulkSupervisor || null, user._id);
      const updated = r.data?.assets_updated ?? selected.size;
      toast.success(bulkSupervisor
        ? `${updated} asset(s) assigned to ${supervisorName(bulkSupervisor)}`
        : `${updated} asset(s) unassigned`);
      clearSelection();
      setBulkSupervisor('');
      await loadAll();
      onChanged && onChanged();
    } catch (e) {
      console.error(e);
      toast.error(errString(e, 'Bulk assignment failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Single-asset quick form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Quick Assign — Single Asset
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick an asset and a supervisor to (re)assign in one click. Leave supervisor empty to unassign.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Asset</label>
              <Select value={singleAssetId} onValueChange={setSingleAssetId}>
                <SelectTrigger className="mt-1" data-testid="single-assign-asset-select">
                  <SelectValue placeholder="Select asset..." />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {allAssets.length === 0 && (
                    <SelectItem value="none" disabled>No assets available</SelectItem>
                  )}
                  {allAssets.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.asset_number} — {typeName(a.asset_type_id)} ({stationName(a.station_id)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Supervisor</label>
              <Select value={singleSupervisorId} onValueChange={setSingleSupervisorId}>
                <SelectTrigger className="mt-1" data-testid="single-assign-supervisor-select">
                  <SelectValue placeholder="Pick supervisor (or leave to unassign)..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassign">— Unassign —</SelectItem>
                  {supervisors.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name} ({s.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => {
                // The "unassign" sentinel just empties the supervisor id
                const sup = singleSupervisorId === 'unassign' ? '' : singleSupervisorId;
                setSingleSupervisorId(sup);
                doSingle();
              }}
              disabled={singleBusy || !singleAssetId}
              data-testid="single-assign-button"
            >
              {singleBusy ? 'Assigning...' : 'Assign'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" /> Bulk Allocate / Reassign
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Filter, multi-select, and assign in one go. Works for new allocations and reassignments.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Station</label>
              <Select value={stationFilter} onValueChange={setStationFilter}>
                <SelectTrigger className="mt-1" data-testid="bulk-station-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stations</SelectItem>
                  {stations.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Asset type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="mt-1" data-testid="bulk-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {allTypes.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Current supervisor</label>
              <Select value={supFilter} onValueChange={setSupFilter}>
                <SelectTrigger className="mt-1" data-testid="bulk-sup-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any</SelectItem>
                  <SelectItem value="unassigned">Unassigned only</SelectItem>
                  {supervisors.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Search asset #</label>
              <div className="relative mt-1">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. FAN-7"
                  className="pl-7 h-9"
                  data-testid="bulk-asset-search"
                />
              </div>
            </div>
          </div>

          {/* Selection toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
            <div className="text-xs text-muted-foreground" data-testid="bulk-selection-count">
              {selected.size} of {filteredAssets.length} selected
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={filteredAssets.length === 0} data-testid="bulk-select-all">
                Select all visible
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selected.size === 0}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </div>
          </div>

          {/* Asset list */}
          <div className="border rounded-lg">
            {loadingData ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted/40 animate-pulse rounded" />)}
              </div>
            ) : filteredAssets.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No assets match the filters</p>
            ) : (
              <ScrollArea className="h-[360px]">
                <div className="divide-y">
                  {filteredAssets.map((a) => {
                    const isSel = selected.has(a._id);
                    return (
                      <button
                        key={a._id}
                        onClick={() => toggleSelect(a._id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 text-left ${isSel ? 'bg-primary/5' : ''}`}
                        data-testid={`bulk-asset-row-${a._id}`}
                      >
                        <Checkbox checked={isSel} className="pointer-events-none" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.asset_number}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {typeName(a.asset_type_id)} &middot; {stationName(a.station_id)}
                            {a.assigned_supervisor_id ? <> &middot; {supervisorName(a.assigned_supervisor_id)}</> : ' · unassigned'}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {a.status === 'working' ? 'OK' : a.status?.toUpperCase() || 'OK'}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Bulk action */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end border-t pt-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Assign selected to supervisor</label>
              <Select value={bulkSupervisor} onValueChange={setBulkSupervisor}>
                <SelectTrigger className="mt-1" data-testid="bulk-assign-supervisor">
                  <SelectValue placeholder="Pick supervisor (leave empty to unassign)..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassign">— Unassign —</SelectItem>
                  {supervisors.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name} ({s.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => {
                const sup = bulkSupervisor === 'unassign' ? '' : bulkSupervisor;
                setBulkSupervisor(sup);
                doBulk();
              }}
              disabled={bulkBusy || selected.size === 0}
              data-testid="bulk-assign-apply"
            >
              {bulkBusy ? 'Applying...' : `Apply to ${selected.size}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------
export default function SuperadminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stationIds, setStationIds] = useState([]);   // selected stations (multi)
  const [activeTab, setActiveTab] = useState('overview');

  // Drill-down state — exclusive (one at a time)
  const [drilldown, setDrilldown] = useState(null); // { kind, id, title, subtitle, params }
  const [drillPayload, setDrillPayload] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dashboardAPI.superadminFull(stationIds.length ? { station_ids: stationIds } : null);
      setData(r.data);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [stationIds]);
  useEffect(() => { load(); }, [load]);

  // Load drill-down list whenever drilldown changes
  useEffect(() => {
    if (!drilldown) { setDrillPayload(null); return; }
    let cancelled = false;
    (async () => {
      setDrillLoading(true);
      try {
        const r = await dashboardAPI.oversightCategoryAssets(user._id, drilldown.params);
        if (!cancelled) setDrillPayload(r.data);
      } catch (e) {
        console.error(e);
        toast.error('Failed to load asset list');
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drilldown, user._id]);

  const openCategoryDrill = (c) => {
    const params = { asset_type_id: c.asset_type_id || c._id };
    if (stationIds.length === 1) params.station_id = stationIds[0];
    setDrilldown({ kind: 'category', title: c.asset_type_name || c.name, subtitle: `${c.asset_count} assets`, params });
  };
  const openStationDrill = (s) => {
    setDrilldown({
      kind: 'station',
      title: s.name,
      subtitle: `${s.asset_count} assets`,
      params: { station_id: s._id },
    });
  };
  const openDepartmentDrill = (d) => {
    const params = { department_id: d._id };
    if (stationIds.length === 1) params.station_id = stationIds[0];
    setDrilldown({ kind: 'department', title: d.name, subtitle: `${d.asset_count} assets`, params });
  };

  const viewAs = (uid) => navigate(`/?as=${uid}`);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  // ---- Drill-down view (exclusive)
  if (drilldown) {
    return (
      <DrillDownView
        title={drilldown.title}
        subtitle={drilldown.subtitle}
        payload={drillPayload}
        loading={drillLoading}
        onBack={() => setDrilldown(null)}
      />
    );
  }

  const pieData = [
    { name: 'Working', value: data.health.working, color: HEALTH_COLORS.working },
    { name: 'Orange (≤24h)', value: data.health.orange, color: HEALTH_COLORS.orange },
    { name: 'Red (>24h)', value: data.health.red, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0);
  const pendingVerificationCount = data.health.yellow || 0;
  const activeDefectsCount = (data.health.orange || 0) + (data.health.red || 0);

  return (
    <div className="space-y-6" data-testid="superadmin-dashboard">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs">Superadmin</Badge>
            <p className="text-sm text-muted-foreground">
              System-wide overview {stationIds.length ? `· ${stationIds.length} station${stationIds.length === 1 ? '' : 's'} selected` : '· all stations'}
            </p>
          </div>
        </div>
        <StationsMultiSelect
          stations={data.available_stations || []}
          selected={stationIds}
          onChange={setStationIds}
        />
      </div>

      {/* Top-level summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <SummaryTile icon={Box} label="Asset Categories" value={data.totals.asset_categories} sub={`${data.totals.assets} assets`} testId="tile-categories" onClick={() => setActiveTab('categories')} />
        <SummaryTile icon={Building2} label="Stations" value={data.totals.stations} testId="tile-stations" onClick={() => setActiveTab('stations')} />
        <SummaryTile icon={Layers} label="Departments" value={data.totals.departments} testId="tile-departments" onClick={() => setActiveTab('departments')} />
        <SummaryTile icon={Wrench} label="Reporting Officers" value={data.totals.reporting_officers} testId="tile-ro" onClick={() => setActiveTab('reporting-officers')} />
        <SummaryTile icon={ShieldAlert} label="Approving Sup." value={data.totals.approving_supervisors} testId="tile-asup" onClick={() => setActiveTab('approving-supervisors')} />
        <SummaryTile icon={Users} label="Supervisors" value={data.totals.supervisors} testId="tile-supervisors" onClick={() => setActiveTab('supervisors')} />
      </div>

      {/* Health tiles row — Working / Orange / Red / Pending Verification */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="health-tiles-row">
        <div className="rounded-xl border bg-emerald-50/60 px-4 py-3" data-testid="health-tile-working">
          <p className="text-xs text-emerald-700/80 font-medium">Working</p>
          <p className="text-2xl font-semibold text-emerald-700 mt-1">{data.health.working || 0}</p>
        </div>
        <div className="rounded-xl border bg-orange-50/60 px-4 py-3" data-testid="health-tile-orange">
          <p className="text-xs text-orange-700/80 font-medium">Orange (Active ≤ 24h)</p>
          <p className="text-2xl font-semibold text-orange-700 mt-1">{data.health.orange || 0}</p>
        </div>
        <div className="rounded-xl border bg-red-50/60 px-4 py-3" data-testid="health-tile-red">
          <p className="text-xs text-red-700/80 font-medium">Red (Active &gt; 24h)</p>
          <p className="text-2xl font-semibold text-red-700 mt-1">{data.health.red || 0}</p>
        </div>
        <div className="rounded-xl border bg-yellow-50/60 px-4 py-3" data-testid="health-tile-pending-verification">
          <p className="text-xs text-yellow-700/80 font-medium">Pending Verification</p>
          <p className="text-2xl font-semibold text-yellow-700 mt-1">{pendingVerificationCount}</p>
          <p className="text-[10px] text-yellow-700/60 mt-0.5">Rectified, awaiting ASUP check</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto justify-start">
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="stations" data-testid="tab-stations">Stations</TabsTrigger>
          <TabsTrigger value="departments" data-testid="tab-departments">Departments</TabsTrigger>
          <TabsTrigger value="reporting-officers" data-testid="tab-reporting-officers">Reporting Officers</TabsTrigger>
          <TabsTrigger value="approving-supervisors" data-testid="tab-approving-supervisors">Approving Sup.</TabsTrigger>
          <TabsTrigger value="supervisors" data-testid="tab-supervisors">Supervisors</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance"><TrendingUp className="h-4 w-4 mr-2" /> Performance</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Overall Health
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{data.totals.assets} assets in scope</p>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                        {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-10">No assets in scope</p>}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> Department Health
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Click a department to drill into its assets</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.departments.length === 0 && (
                    <p className="text-sm text-muted-foreground col-span-full text-center py-6">No departments yet</p>
                  )}
                  {data.departments.map((d) => (
                    <DepartmentCard key={d._id} d={d} onClick={() => openDepartmentDrill(d)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Asset categories */}
          <div>
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Box className="h-4 w-4 text-primary" /> Asset Categories
              <span className="text-xs text-muted-foreground font-normal">— Click a card to drill in</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.asset_categories.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-6 col-span-full">No asset categories yet</p>
                : data.asset_categories.map((c) => (
                    <CategoryCard key={c.asset_type_id} c={c} onClick={() => openCategoryDrill(c)} />
                  ))}
            </div>
          </div>

          {/* Stations snapshot */}
          <div>
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Stations Snapshot
              <span className="text-xs text-muted-foreground font-normal">— Click for asset breakdown</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.stations.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-6 col-span-full">No stations in scope</p>
                : data.stations.map((s) => (
                    <StationCard key={s._id} s={s} onClick={() => openStationDrill(s)} />
                  ))}
            </div>
          </div>
        </TabsContent>

        {/* CATEGORIES */}
        <TabsContent value="categories" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.asset_categories.length === 0
              ? <p className="text-sm text-muted-foreground text-center py-6 col-span-full">No asset categories yet</p>
              : data.asset_categories.map((c) => (
                  <CategoryCard key={c.asset_type_id} c={c} onClick={() => openCategoryDrill(c)} />
                ))}
          </div>
        </TabsContent>

        {/* STATIONS */}
        <TabsContent value="stations" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.stations.length === 0
              ? <p className="text-sm text-muted-foreground text-center py-6 col-span-full">No stations in scope</p>
              : data.stations.map((s) => (
                  <StationCard key={s._id} s={s} onClick={() => openStationDrill(s)} />
                ))}
          </div>
        </TabsContent>

        {/* DEPARTMENTS */}
        <TabsContent value="departments" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.departments.length === 0
              ? <p className="text-sm text-muted-foreground text-center py-6 col-span-full">No departments yet</p>
              : data.departments.map((d) => (
                  <DepartmentCard key={d._id} d={d} onClick={() => openDepartmentDrill(d)} />
                ))}
          </div>
        </TabsContent>

        {/* REPORTING OFFICERS */}
        <TabsContent value="reporting-officers" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">Click any officer to view their dashboard.</p>
          {data.reporting_officers.length === 0
            ? <p className="text-sm text-muted-foreground text-center py-6">No reporting officers yet</p>
            : data.reporting_officers.map((u) => (
                <UserClickRow
                  key={u._id}
                  u={u}
                  testId={`ro-row-${u._id}`}
                  badges={
                    <>
                      {u.department_name && <Badge variant="outline" className="text-[10px]">{u.department_name}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{u.assigned_stations_count} stations</Badge>
                      <Badge variant="secondary" className="text-[10px]">{u.supervisors_count} sups</Badge>
                    </>
                  }
                  onClick={() => viewAs(u._id)}
                />
              ))}
        </TabsContent>

        {/* APPROVING SUPERVISORS */}
        <TabsContent value="approving-supervisors" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">Click any approving supervisor to view their dashboard.</p>
          {data.approving_supervisors.length === 0
            ? <p className="text-sm text-muted-foreground text-center py-6">No approving supervisors yet</p>
            : data.approving_supervisors.map((u) => (
                <UserClickRow
                  key={u._id}
                  u={u}
                  testId={`asup-row-${u._id}`}
                  badges={<Badge variant="secondary" className="text-[10px]">{u.assigned_stations_count} stations</Badge>}
                  onClick={() => viewAs(u._id)}
                />
              ))}
        </TabsContent>

        {/* SUPERVISORS */}
        <TabsContent value="supervisors" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">Click any supervisor to view their dashboard.</p>
          {data.supervisors.length === 0
            ? <p className="text-sm text-muted-foreground text-center py-6">No supervisors yet</p>
            : data.supervisors.map((u) => (
                <UserClickRow
                  key={u._id}
                  u={u}
                  testId={`sup-row-${u._id}`}
                  badges={
                    <>
                      {u.department_name && <Badge variant="outline" className="text-[10px]">{u.department_name}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{u.assigned_stations_count} stations</Badge>
                      <Badge variant="secondary" className="text-[10px]">{u.asset_count} assets</Badge>
                    </>
                  }
                  onClick={() => viewAs(u._id)}
                />
              ))}
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <AdminPerformanceMatrix />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Tile sub-component (declared after main to avoid clutter)
function SummaryTile({ icon: Icon, label, value, sub, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <p className="text-xs text-muted-foreground mt-3">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </button>
  );
}
