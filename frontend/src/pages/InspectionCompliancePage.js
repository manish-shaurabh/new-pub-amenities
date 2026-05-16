import { useState, useEffect, useCallback } from 'react';
import { complianceAPI, stationsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import ZoneDivisionFilter from '../components/ZoneDivisionFilter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import {
  ClipboardCheck, Users, AlertTriangle, CheckCircle2, Clock,
  Settings, Download, RefreshCw, MapPin, Calendar, BarChart3,
  ChevronRight, Activity,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Status badge helper ──────────────────────────────────────────────────────
const STATUS_CONFIG = {
  active:   { label: 'Active',    color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle2 },
  due_soon: { label: 'Due Soon',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200',   icon: Clock },
  overdue:  { label: 'Overdue',   color: 'bg-red-100 text-red-800 border-red-200',             icon: AlertTriangle },
  never:    { label: 'Never',     color: 'bg-slate-100 text-slate-700 border-slate-200',       icon: AlertTriangle },
  unknown:  { label: 'Unknown',   color: 'bg-muted text-muted-foreground',                     icon: Clock },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}>
      <cfg.icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function formatDate(dt) {
  if (!dt) return '—';
  try { return format(new Date(dt), 'dd MMM yyyy'); } catch { return dt; }
}

function daysAgo(dt) {
  if (!dt) return null;
  try {
    const d = Math.floor((Date.now() - new Date(dt).getTime()) / 86400000);
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    return `${d}d ago`;
  } catch { return null; }
}

// ── Heat cell ────────────────────────────────────────────────────────────────
function HeatCell({ cell, threshold }) {
  if (cell === null) {
    return <td className="border border-border/30 px-2 py-2 text-center text-[10px] text-muted-foreground/30">—</td>;
  }
  const days = cell.days_since;
  let bg, text;
  if (days === null) {
    bg = 'bg-red-100'; text = 'text-red-800';
  } else if (days <= 3) {
    bg = 'bg-emerald-100'; text = 'text-emerald-800';
  } else if (days <= threshold) {
    bg = 'bg-yellow-100'; text = 'text-yellow-800';
  } else {
    bg = 'bg-red-100'; text = 'text-red-800';
  }
  return (
    <td className={`border border-border/30 px-2 py-2 text-center ${bg}`}>
      <span className={`text-[11px] font-medium ${text}`}>
        {days === null ? 'Never' : days === 0 ? 'Today' : `${days}d`}
      </span>
    </td>
  );
}

// ── SIG Inspection Card ───────────────────────────────────────────────────────
function SigCard({ insp, onExport }) {
  return (
    <Card className="hover:shadow-sm transition-shadow" data-testid={`sig-card-${insp._id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] bg-blue-50 border-blue-200 text-blue-700">SIG</Badge>
              <span className="font-medium text-sm">{insp.station_name}</span>
              <span className="text-xs text-muted-foreground">{formatDate(insp.inspection_at)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Convened by: <span className="text-foreground font-medium">{insp.inspector_name}</span>
            </p>

            {/* Participants */}
            {insp.participants && insp.participants.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                {insp.participants.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] py-0">
                    {p.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span><span className="font-medium text-foreground">{insp.total_assets}</span> assets</span>
              {insp.defect_count > 0 && (
                <span className="text-destructive">
                  <span className="font-medium">{insp.defect_count}</span> defects
                </span>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-8 text-xs gap-1"
            onClick={() => onExport(insp._id)}
            data-testid={`sig-export-pdf-${insp._id}`}
          >
            <Download className="h-3 w-3" /> PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Settings Dialog ───────────────────────────────────────────────────────────
function ThresholdDialog({ open, onClose, currentThreshold, userId, onSaved }) {
  const [days, setDays] = useState(currentThreshold);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDays(currentThreshold); }, [currentThreshold]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await complianceAPI.updateThreshold({ overdue_days: parseInt(days), current_user_id: userId });
      toast.success('Threshold updated');
      onSaved(parseInt(days));
      onClose();
    } catch (e) {
      toast.error('Failed to update threshold');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Compliance Threshold</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Supervisors who haven't conducted an inspection within this many days will be flagged as <strong>Overdue</strong>.
          </p>
          <div>
            <Label className="text-xs font-medium">Days without inspection = Overdue</Label>
            <div className="flex items-center gap-2 mt-1.5">
              <Input
                type="number" min={1} max={90}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-24 h-9"
                data-testid="threshold-input"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} data-testid="threshold-save-btn">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab 1: By Supervisor ─────────────────────────────────────────────────────
function SupervisorTab({ userId, stations, threshold, zdFilter = {} }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stationFilter, setStationFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (stationFilter) params.station_id = stationFilter;
      else if (zdFilter.stationId) params.station_id = zdFilter.stationId;
      const res = await complianceAPI.supervisorActivity(userId, params);
      setRows(res.data || []);
    } catch (e) {
      toast.error('Failed to load supervisor activity');
    } finally {
      setLoading(false);
    }
  }, [userId, stationFilter, zdFilter.stationId]);

  useEffect(() => { load(); }, [load]);

  const counts = { active: 0, due_soon: 0, overdue: 0, never: 0 };
  rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  return (
    <div className="space-y-4" data-testid="supervisor-activity-tab">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'active', label: 'Active', color: 'emerald' },
          { key: 'due_soon', label: 'Due Soon', color: 'yellow' },
          { key: 'overdue', label: 'Overdue', color: 'red' },
          { key: 'never', label: 'Never Inspected', color: 'slate' },
        ].map(({ key, label, color }) => (
          <div key={key} className={`rounded-xl border px-4 py-3 bg-${color}-50/60`} data-testid={`compliance-stat-${key}`}>
            <p className={`text-xs text-${color}-700/80 font-medium`}>{label}</p>
            <p className={`text-2xl font-semibold text-${color}-700 mt-1`}>{counts[key] || 0}</p>
          </div>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={stationFilter || 'all'} onValueChange={(v) => setStationFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="compliance-station-filter">
            <SelectValue placeholder="All stations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} supervisors</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No supervisors found</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Supervisor</th>
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground hidden sm:table-cell">Dept</th>
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground hidden md:table-cell">Stations</th>
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Last Individual</th>
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground hidden lg:table-cell">Last SIG</th>
                  <th className="text-center px-3 py-2.5 font-medium text-xs text-muted-foreground">7d</th>
                  <th className="text-center px-3 py-2.5 font-medium text-xs text-muted-foreground">30d</th>
                  <th className="text-left px-3 py-2.5 font-medium text-xs text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.user_id} className={`border-b last:border-0 hover:bg-muted/20 ${i % 2 === 1 ? 'bg-muted/10' : ''}`}
                    data-testid={`supervisor-row-${row.user_id}`}>
                    <td className="px-3 py-2.5">
                      <div>
                        <p className="font-medium text-xs">{row.name}</p>
                        <p className="text-[10px] text-muted-foreground">{row.employee_id}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px]">{row.department_name || '—'}</Badge>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{(row.station_names || []).join(', ') || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>
                        <p className="text-xs">{formatDate(row.last_individual)}</p>
                        {row.last_individual && (
                          <p className="text-[10px] text-muted-foreground">{daysAgo(row.last_individual)}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <div>
                        <p className="text-xs">{formatDate(row.last_sig)}</p>
                        {row.last_sig && (
                          <p className="text-[10px] text-muted-foreground">{daysAgo(row.last_sig)}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-semibold text-sm tabular-nums">{row.count_7d}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-semibold text-sm tabular-nums">{row.count_30d}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Missing Inspections Heatmap ───────────────────────────────────────
function HeatmapTab({ userId, threshold }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await complianceAPI.missingHeatmap(userId);
      setData(res.data);
    } catch (e) {
      toast.error('Failed to load heatmap');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>;
  if (!data) return null;

  const { asset_types = [], grid = [] } = data;

  return (
    <div className="space-y-4" data-testid="missing-heatmap-tab">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Heat-coded by days since last inspection. Threshold: <strong>{threshold} days</strong>
        </p>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-3 w-6 rounded bg-emerald-200 inline-block" /> ≤ 3d</span>
          <span className="flex items-center gap-1"><span className="h-3 w-6 rounded bg-yellow-200 inline-block" /> 4–{threshold}d</span>
          <span className="flex items-center gap-1"><span className="h-3 w-6 rounded bg-red-200 inline-block" /> Overdue/Never</span>
          <span className="flex items-center gap-1"><span className="h-3 w-6 rounded bg-muted inline-block" /> N/A</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {grid.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No data available</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-semibold text-xs border border-border/30 min-w-[120px]">Station</th>
                  {asset_types.map(t => (
                    <th key={t.id} className="px-2 py-2 font-medium text-xs border border-border/30 min-w-[70px] text-center">
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, ri) => (
                  <tr key={row.station.id} className={ri % 2 === 1 ? 'bg-muted/10' : ''}>
                    <td className="px-3 py-2 border border-border/30 font-medium">
                      <div>
                        <span className="text-xs font-semibold">{row.station.name}</span>
                        {row.station.code && <span className="text-[10px] text-muted-foreground ml-1">({row.station.code})</span>}
                      </div>
                    </td>
                    {asset_types.map(t => (
                      <HeatCell key={t.id} cell={row.cells[t.id] ?? null} threshold={threshold} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: SIG History ───────────────────────────────────────────────────────
function SigHistoryTab({ userId, stations }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stationFilter, setStationFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exportingId, setExportingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (stationFilter) params.station_id = stationFilter;
      const res = await complianceAPI.sigHistory(userId, params);
      setData(res.data);
    } catch (e) {
      toast.error('Failed to load SIG history');
    } finally {
      setLoading(false);
    }
  }, [userId, stationFilter, page]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (inspId) => {
    setExportingId(inspId);
    try {
      const res = await complianceAPI.exportSigPdf(inspId);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `SIG_Inspection_${inspId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('PDF export failed');
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="sig-history-tab">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={stationFilter || 'all'} onValueChange={(v) => { setStationFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="sig-station-filter">
            <SelectValue placeholder="All stations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
        {data && <span className="text-xs text-muted-foreground ml-auto">{data.total} total SIG inspections</span>}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No SIG inspections found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map(insp => (
              <SigCard
                key={insp._id}
                insp={insp}
                onExport={handleExport}
              />
            ))}
          </div>

          {/* Pagination */}
          {data.total_pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {data.total_pages}</span>
              <Button variant="outline" size="sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InspectionCompliancePage() {
  const { user } = useAuth();
  const [stations, setStations] = useState([]);
  const [threshold, setThreshold] = useState(7);
  const [showSettings, setShowSettings] = useState(false);
  const [zdFilter, setZdFilter] = useState({ zoneId: '', divisionId: '', stationId: '' });

  const canEditSettings = user && ['superadmin', 'admin', 'divisional_admin'].includes(user.role);

  useEffect(() => {
    stationsAPI.list().then(r => setStations(r.data || [])).catch(() => {});
    complianceAPI.getThreshold().then(r => setThreshold(r.data.overdue_days || 7)).catch(() => {});
  }, []);

  if (!user) return null;

  return (
    <div className="space-y-4" data-testid="inspection-compliance-page">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inspection Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track supervisor inspection activity, compliance gaps, and SIG history
          </p>
        </div>
        {canEditSettings && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowSettings(true)}
            data-testid="compliance-settings-btn"
          >
            <Settings className="h-4 w-4" />
            Threshold: {threshold}d
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="supervisors" className="space-y-4">
        <TabsList>
          <TabsTrigger value="supervisors" data-testid="tab-supervisors">
            <Activity className="h-4 w-4 mr-2" /> By Supervisor
          </TabsTrigger>
          <TabsTrigger value="heatmap" data-testid="tab-heatmap">
            <BarChart3 className="h-4 w-4 mr-2" /> Missing Inspections
          </TabsTrigger>
          <TabsTrigger value="sig" data-testid="tab-sig-history">
            <Users className="h-4 w-4 mr-2" /> SIG History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="supervisors">
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Scope:</span>
            <ZoneDivisionFilter
              value={zdFilter}
              onChange={v => setZdFilter(v)}
              showStation
              compact
            />
          </div>
          <SupervisorTab userId={user._id} stations={stations} threshold={threshold} zdFilter={zdFilter} />
        </TabsContent>

        <TabsContent value="heatmap">
          <HeatmapTab userId={user._id} threshold={threshold} />
        </TabsContent>

        <TabsContent value="sig">
          <SigHistoryTab userId={user._id} stations={stations} />
        </TabsContent>
      </Tabs>

      <ThresholdDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        currentThreshold={threshold}
        userId={user._id}
        onSaved={setThreshold}
      />
    </div>
  );
}
