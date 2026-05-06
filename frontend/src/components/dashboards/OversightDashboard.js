/**
 * Shared oversight dashboard used by Approving Supervisor and Reporting Officer.
 * Renders: header, station/dept dropdowns (when allowed), Overview (asset-type buttons + station health pie + station drill-down),
 * and "My Supervisors" + "My Tasks" approval-queue tabs.
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../lib/auth-context';
import { dashboardAPI, analyticsAPI, approvalsAPI } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Textarea } from '../ui/textarea';
import {
  Box, BarChart3, ListChecks, Users, ChevronDown, ArrowLeft, ArrowRight,
  CheckCircle2, XCircle, Building2, Wrench, AlertCircle,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

const HEALTH_COLORS = { working: '#0e7c6b', orange: '#f97316', red: '#dc2626' };

const fmtHours = (h) => (h < 1 ? `${Math.round((h || 0) * 60)} min` : `${(h || 0).toFixed(1)} h`);

// ---------- Asset-type button ----------
function CategoryButton({ c, onClick }) {
  const issues = (c.orange || 0) + (c.red || 0);
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={`category-button-${c.asset_type_id}`}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Box className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <h3 className="mt-3 font-medium text-sm">{c.asset_type_name}</h3>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{c.asset_count}</p>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{c.working || 0} ok</Badge>
        {c.orange > 0 && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{c.orange} orange</Badge>}
        {c.red > 0 && <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">{c.red} red</Badge>}
        {issues === 0 && c.asset_count > 0 && <span className="text-[10px] text-muted-foreground">all healthy</span>}
      </div>
      {typeof c.pct_functional === 'number' && (
        <p className="text-[11px] text-muted-foreground mt-2">{c.pct_functional}% functional time</p>
      )}
    </button>
  );
}

// ---------- Overview tab ----------
function OverviewBlock({ data, userId, mode, stationFilter, deptFilter }) {
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [categoryAssets, setCategoryAssets] = useState(null);
  const [categoryLoading, setCategoryLoading] = useState(false);

  // Load assets for the selected category
  useEffect(() => {
    if (!selectedCategoryId) { setCategoryAssets(null); return; }
    let cancelled = false;
    (async () => {
      setCategoryLoading(true);
      try {
        const params = { asset_type_id: selectedCategoryId };
        if (stationFilter && stationFilter !== 'all') params.station_id = stationFilter;
        if (mode === 'asup' && deptFilter && deptFilter !== 'all') params.department_id = deptFilter;
        const r = await dashboardAPI.oversightCategoryAssets(userId, params);
        if (!cancelled) setCategoryAssets(r.data);
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setCategoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedCategoryId, userId, mode, stationFilter, deptFilter]);

  const pieData = [
    { name: 'Working', value: data.health.working, color: HEALTH_COLORS.working },
    { name: 'Orange', value: data.health.orange, color: HEALTH_COLORS.orange },
    { name: 'Red', value: data.health.red, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0);

  const selectedStation = selectedStationId ? data.stations.find((s) => s.station_id === selectedStationId) : null;
  const selectedCategory = selectedCategoryId ? data.categories.find((c) => c.asset_type_id === selectedCategoryId) : null;

  // ----- Station drill-down -----
  if (selectedStation) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedStationId(null)} data-testid="back-to-stations">
            <ArrowLeft className="h-4 w-4 mr-1" /> All stations
          </Button>
          <h2 className="text-lg font-semibold">{selectedStation.station_name}</h2>
          <Badge variant="secondary" className="text-xs">{selectedStation.asset_count} assets</Badge>
          <Badge variant="outline" className="text-xs">{selectedStation.pct_functional}% functional</Badge>
        </div>
        <div className="space-y-3">
          {selectedStation.categories.map((c) => (
            <Card key={c.asset_type_id} className="overflow-hidden">
              <Collapsible defaultOpen>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{c.asset_type_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{c.asset_count}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{c.working} ok</Badge>
                      {c.orange > 0 && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{c.orange} orange</Badge>}
                      {c.red > 0 && <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">{c.red} red</Badge>}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    {c.assets.map((a) => (
                      <div key={a._id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
                            a.health_class === 'red' ? 'bg-red-50 text-red-600' :
                            a.health_class === 'orange' ? 'bg-orange-50 text-orange-600' :
                            'bg-emerald-50 text-emerald-600'
                          }`}>
                            {a.health_class === 'working' ? <Box className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
                          </div>
                          <p className="text-sm font-medium">{a.asset_number}</p>
                        </div>
                        <Badge className={
                          a.health_class === 'red' ? 'bg-red-100 text-red-700 border-red-200 text-[10px]' :
                          a.health_class === 'orange' ? 'bg-orange-100 text-orange-700 border-orange-200 text-[10px]' :
                          'bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]'
                        }>
                          {a.health_class === 'working' ? 'OK' : a.health_class.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ----- Category drill-down -----
  if (selectedCategory) {
    const renderAssetRow = (a, isPriority) => (
      <div key={a._id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
            a.health_class === 'red' ? 'bg-red-50 text-red-600' :
            a.health_class === 'orange' ? 'bg-orange-50 text-orange-600' :
            'bg-emerald-50 text-emerald-600'
          }`}>
            {isPriority ? <Wrench className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{a.asset_number}</p>
            <p className="text-xs text-muted-foreground truncate">
              {a.station_name} &middot; {a.location_name}
              {a.supervisor_name ? <> &middot; <span>{a.supervisor_name}</span></> : null}
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
            'bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]'
          }>
            {a.status === 'needs_repair' ? 'NEEDS REPAIR' : a.status === 'not_ok' ? 'NOT OK' : a.health_class === 'working' ? 'OK' : a.health_class.toUpperCase()}
          </Badge>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setSelectedCategoryId(null)} data-testid="back-to-categories">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-lg font-semibold">{selectedCategory.asset_type_name}</h2>
          <Badge variant="secondary" className="text-xs">{selectedCategory.asset_count} total</Badge>
          {categoryAssets && (
            <Badge variant="outline" className="text-xs">
              {categoryAssets.totals.priority} priority &middot; {categoryAssets.totals.working} working
            </Badge>
          )}
        </div>

        {categoryLoading ? (
          <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-14 bg-muted/50 animate-pulse rounded-xl" />)}</div>
        ) : !categoryAssets ? null : (
          <>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-500" /> Priority — Not OK / Needs Repair
                  <Badge className="ml-auto bg-orange-50 text-orange-700 border-orange-200 text-[10px]">
                    {categoryAssets.priority.length}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">Sorted by most recent defect first</p>
              </CardHeader>
              <CardContent className="p-0">
                {categoryAssets.priority.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-6">No priority items in this category 🎉</p>
                  : categoryAssets.priority.map((a) => renderAssetRow(a, true))}
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Working
                  <Badge className="ml-auto bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                    {categoryAssets.working.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {categoryAssets.working.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-6">No working assets in this category</p>
                  : categoryAssets.working.map((a) => renderAssetRow(a, false))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  }

  // ----- Default Overview view -----
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Overall Health
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Across {data.total_assets} asset(s) in your scope</p>
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
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No assets in scope</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Stations Snapshot
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Click a station to drill into asset categories</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.stations.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No stations in scope</p>}
            {data.stations.map((s) => (
              <button
                key={s.station_id}
                onClick={() => setSelectedStationId(s.station_id)}
                className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 hover:border-primary/40 hover:bg-muted/30 transition"
                data-testid={`station-card-${s.station_id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{s.station_name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="secondary" className="text-[10px]">{s.asset_count}</Badge>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{s.pct_functional}%</Badge>
                  {(s.orange + s.red) > 0 && (
                    <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{s.orange + s.red} issues</Badge>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-base font-semibold mb-3">Asset Categories</h3>
        {data.categories.length === 0 ? (
          <Card><CardContent className="p-12 text-center">
            <Box className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">No assets in scope</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.categories.map((c) => (
              <CategoryButton key={c.asset_type_id} c={c} onClick={() => setSelectedCategoryId(c.asset_type_id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- My Supervisors ----------
function MySupervisorsBlock({ userId, restrictToIds }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const r = await analyticsAPI.approvingSupervisorList(userId);
        let list = r.data.supervisors || [];
        if (restrictToIds) {
          const set = new Set(restrictToIds);
          list = list.filter((s) => set.has(s._id));
        }
        setData(list);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [userId, restrictToIds]);
  if (loading) return <div className="h-40 bg-muted/50 animate-pulse rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <Card><CardContent className="p-12 text-center">
        <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">No supervisors in scope</p>
      </CardContent></Card>
    );
  }
  return (
    <div className="space-y-3">
      {data.map((s) => (
        <Card key={s._id} className="overflow-hidden">
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors" data-testid={`supervisor-row-${s._id}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                    {(s.name || '?').charAt(0)}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.employee_id}{s.department_name ? ` · ${s.department_name}` : ''}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px]">{s.total_assets} assets</Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t">
                {s.categories && s.categories.length > 0 ? s.categories.map((c) => (
                  <div key={c.asset_type_id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <Box className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium truncate">{c.asset_type_name}</p>
                      <Badge variant="secondary" className="text-[10px]">{c.asset_count}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <p className="text-muted-foreground">Avg Repair</p>
                        <p className="font-semibold tabular-nums">{fmtHours(c.avg_repair_hours)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">% Functional</p>
                        <p className="font-semibold tabular-nums">{c.pct_functional}%</p>
                      </div>
                    </div>
                  </div>
                )) : <p className="text-xs text-muted-foreground text-center py-6">No categories yet</p>}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}
    </div>
  );
}

// ---------- My Tasks (approval queue) ----------
function MyTasksBlock({ reviewerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState({});  // key: insp:idx -> bool
  const [remarksMap, setRemarksMap] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await approvalsAPI.pending(reviewerId);
      setData(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [reviewerId]);
  useEffect(() => { load(); }, [load]);

  const act = async (insp, idx, approve) => {
    const key = `${insp.inspection_id}:${idx}`;
    setActioning((s) => ({ ...s, [key]: true }));
    try {
      const remarks = remarksMap[key] || null;
      if (approve) await approvalsAPI.approve(insp.inspection_id, idx, reviewerId, remarks);
      else         await approvalsAPI.reject(insp.inspection_id, idx, reviewerId, remarks);
      toast.success(approve ? 'Item approved' : 'Item rejected');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Action failed');
    } finally {
      setActioning((s) => ({ ...s, [key]: false }));
    }
  };

  if (loading) return <div className="h-40 bg-muted/50 animate-pulse rounded-xl" />;
  if (!data || data.total_items === 0) {
    return (
      <Card><CardContent className="p-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500/60 mx-auto mb-3" />
        <p className="text-sm font-medium">No pending approvals</p>
        <p className="text-xs text-muted-foreground mt-1">All inspection items have been reviewed.</p>
      </CardContent></Card>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.total_items} item(s) across {data.inspections.length} inspection(s) awaiting your review.
      </p>
      {data.inspections.map((insp) => (
        <Card key={insp.inspection_id} className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>{insp.station_name} · {insp.inspection_type === 'sig' ? 'SIG' : 'Individual'} inspection</span>
              <Badge variant="secondary" className="text-[10px]">{insp.pending_items.length} pending</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Submitted by {insp.inspector_name} · {new Date(insp.submitted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            {insp.overall_remarks && (
              <p className="text-xs italic text-muted-foreground">"{insp.overall_remarks}"</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {insp.pending_items.map((it) => {
              const key = `${insp.inspection_id}:${it.item_index}`;
              const busy = actioning[key];
              const statusLabel = it.status === 'ok' ? 'Reported OK' : it.status === 'not_ok' ? 'Reported NOT OK' : 'Needs Repair';
              return (
                <div key={key} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{it.asset_number || it.asset_id}</p>
                      <p className="text-xs text-muted-foreground">{it.asset_type_name}</p>
                    </div>
                    <Badge className={
                      it.status === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]' :
                      'bg-red-50 text-red-700 border-red-200 text-[10px]'
                    }>{statusLabel}</Badge>
                  </div>
                  {it.remarks && (
                    <p className="text-xs">{it.remarks_by ? <span className="text-muted-foreground">{it.remarks_by}: </span> : null}{it.remarks}</p>
                  )}
                  {it.photo_urls && it.photo_urls.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {it.photo_urls.slice(0, 4).map((u, i) => (
                        <img key={i} src={u} alt="" className="h-12 w-12 rounded object-cover border" />
                      ))}
                    </div>
                  )}
                  <Textarea
                    placeholder="Optional review remarks…"
                    value={remarksMap[key] || ''}
                    onChange={(e) => setRemarksMap((s) => ({ ...s, [key]: e.target.value }))}
                    className="text-xs h-16"
                    data-testid={`approval-remarks-${key}`}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => act(insp, it.item_index, true)}
                      disabled={busy}
                      data-testid={`approve-button-${key}`}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Pass
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act(insp, it.item_index, false)}
                      disabled={busy}
                      data-testid={`reject-button-${key}`}
                      className="border-red-200 text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Fail
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- Main exported component ----------
/**
 * @param mode - 'asup' | 'ro'
 * @param targetUser - optional override (used by Superadmin "view as" mode)
 */
export default function OversightDashboard({ mode = 'asup', targetUser = null }) {
  const { user: authUser } = useAuth();
  const user = targetUser || authUser;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stationFilter, setStationFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (stationFilter !== 'all') params.station_id = stationFilter;
      if (mode === 'asup' && departmentFilter !== 'all') params.department_id = departmentFilter;
      const r = mode === 'asup'
        ? await dashboardAPI.approvingSupervisor(user._id, params)
        : await dashboardAPI.reportingOfficer(user._id, params);
      setData(r.data);
    } catch (e) { console.error(e); toast.error('Failed to load dashboard'); }
    finally { setLoading(false); }
  }, [user._id, stationFilter, departmentFilter, mode]);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}</div>;
  }

  const roleLabel = mode === 'asup' ? 'Approving Supervisor' : 'Reporting Officer';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className="text-xs">{roleLabel}</Badge>
            {mode === 'ro' && data.department_id && (() => {
              const dept = data.available_departments.find((d) => d._id === data.department_id);
              return dept ? <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{dept.name}</Badge> : null;
            })()}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {data.available_stations.length > 0 && (
            <div className="min-w-[180px]">
              <Select value={stationFilter} onValueChange={setStationFilter}>
                <SelectTrigger data-testid="oversight-station-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All my stations</SelectItem>
                  {data.available_stations.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === 'asup' && data.available_departments.length > 0 && (
            <div className="min-w-[180px]">
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger data-testid="oversight-department-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {data.available_departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="my-supervisors" data-testid="tab-my-supervisors"><Users className="h-4 w-4 mr-2" /> My Supervisors</TabsTrigger>
          <TabsTrigger value="my-tasks" data-testid="tab-my-tasks"><ListChecks className="h-4 w-4 mr-2" /> My Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewBlock data={data} userId={user._id} mode={mode} stationFilter={stationFilter} deptFilter={departmentFilter} />
        </TabsContent>
        <TabsContent value="my-supervisors" className="mt-4">
          {mode === 'asup'
            ? <MySupervisorsBlock userId={user._id} />
            : <MySupervisorsBlock userId={user._id} restrictToIds={data.my_supervisors_ids || []} />
          }
        </TabsContent>
        <TabsContent value="my-tasks" className="mt-4"><MyTasksBlock reviewerId={user._id} /></TabsContent>
      </Tabs>
    </div>
  );
}
