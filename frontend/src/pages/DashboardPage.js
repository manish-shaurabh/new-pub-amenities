import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI, analyticsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import {
  Box, ClipboardCheck, Building2, ShieldAlert,
  ChevronDown, Wrench, ListChecks, BarChart3, ArrowRight,
} from 'lucide-react';
import {
  Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

import OversightDashboard from '../components/dashboards/OversightDashboard';
import AdminDashboard from '../components/dashboards/AdminDashboard';

// Health palette (matches our orange/red list semantics)
const HEALTH_COLORS = {
  working: '#0e7c6b',
  orange: '#f97316',
  red: '#dc2626',
};

// ======================================================================
// SUPERADMIN DASHBOARD (redesigned — category buttons / ROs / ASUPs / stations / divisions)
// ======================================================================
function SummaryButton({ icon: Icon, label, count, sublabel, onClick, testId }) {
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
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{count}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground mt-1">{sublabel}</p>}
    </button>
  );
}

function HealthListRow({ row, onClick, healthMode = true }) {
  const issues = (row.orange || 0) + (row.red || 0);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 hover:border-primary/40 hover:bg-muted/30 transition text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
          {(row.name || '?').charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{row.name}</p>
          {row.employee_id && <p className="text-[11px] text-muted-foreground truncate">{row.employee_id}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {healthMode ? (
          <>
            <Badge variant="secondary" className="text-[10px]">{row.asset_count || 0}</Badge>
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{row.working || 0} ok</Badge>
            {issues > 0 && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{issues} issues</Badge>}
          </>
        ) : (
          <>
            {row.department_name && <Badge variant="outline" className="text-[10px]">{row.department_name}</Badge>}
            {row.assigned_stations_count !== undefined && (
              <Badge variant="secondary" className="text-[10px]">{row.assigned_stations_count} stations</Badge>
            )}
            {row.supervisors_count !== undefined && (
              <Badge variant="secondary" className="text-[10px]">{row.supervisors_count} sups</Badge>
            )}
          </>
        )}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    </button>
  );
}

function SuperadminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    (async () => {
      try {
        const r = await dashboardAPI.superadminFull();
        setData(r.data);
      } catch (e) { console.error('Failed to load superadmin dashboard', e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading || !data) {
    return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}</div>;
  }

  const pieData = [
    { name: 'Working', value: data.health.working, color: HEALTH_COLORS.working },
    { name: 'Orange', value: data.health.orange, color: HEALTH_COLORS.orange },
    { name: 'Red', value: data.health.red, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="secondary" className="text-xs">Superadmin</Badge>
          <p className="text-sm text-muted-foreground">System-wide overview</p>
        </div>
      </div>

      {/* 5 summary buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryButton
          icon={Box}
          label="Asset Categories"
          count={data.totals.asset_categories}
          sublabel={`${data.totals.assets} assets`}
          onClick={() => setActiveTab('asset-categories')}
          testId="summary-asset-categories"
        />
        <SummaryButton
          icon={Building2}
          label="Stations"
          count={data.totals.stations}
          onClick={() => setActiveTab('stations')}
          testId="summary-stations"
        />
        <SummaryButton
          icon={ListChecks}
          label="Divisions"
          count={data.totals.departments}
          onClick={() => setActiveTab('divisions')}
          testId="summary-divisions"
        />
        <SummaryButton
          icon={Wrench}
          label="Reporting Officers"
          count={data.totals.reporting_officers}
          onClick={() => setActiveTab('reporting-officers')}
          testId="summary-reporting-officers"
        />
        <SummaryButton
          icon={ShieldAlert}
          label="Approving Supervisors"
          count={data.totals.approving_supervisors}
          onClick={() => setActiveTab('approving-supervisors')}
          testId="summary-approving-supervisors"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="asset-categories" data-testid="tab-asset-categories">Categories</TabsTrigger>
          <TabsTrigger value="stations" data-testid="tab-stations">Stations</TabsTrigger>
          <TabsTrigger value="divisions" data-testid="tab-divisions">Divisions</TabsTrigger>
          <TabsTrigger value="reporting-officers" data-testid="tab-reporting-officers">ROs</TabsTrigger>
          <TabsTrigger value="approving-supervisors" data-testid="tab-approving-supervisors">ASUPs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Overall Asset Health</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Across all {data.totals.assets} assets in the system</p>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={2} dataKey="value">
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="asset-categories" className="mt-4 space-y-2">
          {data.asset_categories.length === 0
            ? <p className="text-xs text-muted-foreground text-center py-10">No asset categories yet</p>
            : data.asset_categories.map((c) => <HealthListRow key={c._id} row={c} healthMode={true} />)}
        </TabsContent>

        <TabsContent value="stations" className="mt-4 space-y-2">
          {data.stations.map((s) => <HealthListRow key={s._id} row={s} healthMode={true} />)}
        </TabsContent>

        <TabsContent value="divisions" className="mt-4 space-y-2">
          {data.divisions.map((d) => <HealthListRow key={d._id} row={d} healthMode={true} />)}
        </TabsContent>

        <TabsContent value="reporting-officers" className="mt-4 space-y-2">
          {data.reporting_officers.length === 0
            ? <p className="text-xs text-muted-foreground text-center py-10">No reporting officers yet</p>
            : data.reporting_officers.map((u) => <HealthListRow key={u._id} row={u} healthMode={false} />)}
        </TabsContent>

        <TabsContent value="approving-supervisors" className="mt-4 space-y-2">
          {data.approving_supervisors.length === 0
            ? <p className="text-xs text-muted-foreground text-center py-10">No approving supervisors yet</p>
            : data.approving_supervisors.map((u) => <HealthListRow key={u._id} row={u} healthMode={false} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ======================================================================
// SUPERVISOR DASHBOARD
// ======================================================================
function CategoryButton({ category, onClick }) {
  const total = category.asset_count;
  const issues = (category.orange || 0) + (category.red || 0);
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
      data-testid={`category-button-${category.asset_type_id}`}
    >
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Box className="h-5 w-5 text-primary" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
      </div>
      <h3 className="mt-3 font-medium text-sm">{category.asset_type_name}</h3>
      <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]">{total}</p>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
          {category.working || 0} ok
        </Badge>
        {category.orange > 0 && (
          <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">
            {category.orange} orange
          </Badge>
        )}
        {category.red > 0 && (
          <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">
            {category.red} red
          </Badge>
        )}
        {issues === 0 && total > 0 && (
          <span className="text-[10px] text-muted-foreground">all healthy</span>
        )}
      </div>
      {typeof category.pct_functional === 'number' && (
        <p className="text-[11px] text-muted-foreground mt-2">{category.pct_functional}% functional time</p>
      )}
    </button>
  );
}

function SupervisorOverviewTab({ data, onSelectCategory }) {
  const pieData = [
    { name: 'Working', value: data.health.working, color: HEALTH_COLORS.working },
    { name: 'Orange', value: data.health.orange, color: HEALTH_COLORS.orange },
    { name: 'Red', value: data.health.red, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Asset Health
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Across {data.total_assets} asset(s) allocated to you
          </p>
        </CardHeader>
        <CardContent>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                  {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">No assets allocated yet</p>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="text-base font-semibold mb-3">Allocated Asset Categories</h3>
        {data.categories.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Box className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">No assets allocated to you yet</p>
              <p className="text-xs text-muted-foreground mt-1">Contact your administrator to get assets assigned.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.categories.map((c) => (
              <CategoryButton key={c.asset_type_id} category={c} onClick={() => onSelectCategory(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SupervisorMyTasksTab({ userId, stationId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState('my-assets');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dashboardAPI.supervisorMyTasks(userId, stationId);
      setData(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [userId, stationId]);
  useEffect(() => { load(); }, [load]);

  const inspectAsset = (assetId) => {
    navigate(`/inspection?asset_id=${assetId}`);
  };

  if (loading) {
    return <div className="space-y-3">
      {[1,2,3].map((i) => <div key={i} className="h-20 bg-muted/50 animate-pulse rounded-xl" />)}
    </div>;
  }
  if (!data) return null;

  const renderCategoryGroup = (c, isPending) => (
    <Card key={c.asset_type_id} className="overflow-hidden">
      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-3">
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
              <span className="font-medium text-sm">{c.asset_type_name}</span>
              <Badge variant="secondary" className="text-xs">{c.asset_count}</Badge>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t">
            {c.assets.map((a) => (
              <button
                key={a._id}
                onClick={() => inspectAsset(a._id)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-b last:border-0 hover:bg-muted/30 text-left"
                data-testid={`asset-inspect-${a._id}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                    a.health_class === 'red' ? 'bg-red-50 text-red-600' :
                    a.health_class === 'orange' ? 'bg-orange-50 text-orange-600' :
                    'bg-emerald-50 text-emerald-600'
                  }`}>
                    {a.health_class === 'working' ? <Box className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.asset_number}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {a.station_name} &middot; {a.location_name}
                    </p>
                  </div>
                </div>
                <Badge className={
                  a.health_class === 'red' ? 'bg-red-100 text-red-700 border-red-200 text-[10px]' :
                  a.health_class === 'orange' ? 'bg-orange-100 text-orange-700 border-orange-200 text-[10px]' :
                  'bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]'
                }>
                  {a.health_class === 'working' ? 'OK' : a.health_class.toUpperCase()}
                </Badge>
              </button>
            ))}
            {isPending && c.assets.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No pending tasks here</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );

  return (
    <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
      <TabsList>
        <TabsTrigger value="my-assets" data-testid="tab-my-assets">
          My Assets <Badge variant="secondary" className="ml-2 text-[10px]">{data.totals.total}</Badge>
        </TabsTrigger>
        <TabsTrigger value="pending" data-testid="tab-pending-tasks">
          Pending Tasks <Badge variant="secondary" className="ml-2 text-[10px]">{data.totals.pending}</Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="my-assets" className="space-y-3 mt-4">
        <p className="text-xs text-muted-foreground">
          Click any asset to start a single-asset inspection. Use the "New Inspection" page for multi-asset inspections.
        </p>
        {data.my_assets.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Box className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">No assets allocated</p>
            </CardContent>
          </Card>
        ) : data.my_assets.map((c) => renderCategoryGroup(c, false))}
      </TabsContent>

      <TabsContent value="pending" className="space-y-3 mt-4">
        <p className="text-xs text-muted-foreground">
          Assets currently in Orange or Red list. Click to inspect and mark working.
        </p>
        {data.pending_tasks.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-emerald-500/60 mx-auto mb-3" />
              <p className="text-sm font-medium">All caught up — nothing pending!</p>
            </CardContent>
          </Card>
        ) : data.pending_tasks.map((c) => renderCategoryGroup(c, true))}
      </TabsContent>
    </Tabs>
  );
}

function SupervisorPerformanceTab({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await analyticsAPI.supervisor(userId);
        setData(r.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [userId]);

  if (loading) return <div className="h-40 bg-muted/50 animate-pulse rounded-xl" />;
  if (!data) return null;

  const fmt = (h) => h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Assets</p>
          <p className="text-2xl font-semibold mt-1 font-[Space_Grotesk] tabular-nums">{data.total_assets}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Overall Functional Time</p>
          <p className="text-2xl font-semibold mt-1 font-[Space_Grotesk] tabular-nums">{data.overall_pct_functional}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Categories</p>
          <p className="text-2xl font-semibold mt-1 font-[Space_Grotesk] tabular-nums">{data.categories.length}</p>
        </CardContent></Card>
      </div>

      {data.categories.length === 0 ? (
        <Card><CardContent className="p-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium">No performance data yet</p>
          <p className="text-xs text-muted-foreground mt-1">Performance metrics will appear once assets are allocated and inspected.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {data.categories.map((c) => (
            <Card key={c.asset_type_id} className="overflow-hidden">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{c.asset_type_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{c.asset_count} assets</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <p className="text-muted-foreground">Avg Repair</p>
                        <p className="font-semibold tabular-nums">{fmt(c.avg_repair_hours)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">% Functional</p>
                        <p className="font-semibold tabular-nums">{c.pct_functional}%</p>
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    {c.assets.map((a) => (
                      <div key={a.asset_id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center ${
                            a.current_status === 'defective' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'
                          }`}>
                            <Box className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{a.asset_number}</p>
                            <p className="text-xs text-muted-foreground">{a.defect_count} defect(s) recorded</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <div className="text-right">
                            <p className="text-muted-foreground">Avg Repair</p>
                            <p className="font-semibold tabular-nums">{fmt(a.avg_repair_hours)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">% Functional</p>
                            <p className="font-semibold tabular-nums">{a.pct_functional}%</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SupervisorDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stationFilter, setStationFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dashboardAPI.supervisor(user._id, stationFilter !== 'all' ? stationFilter : null);
      setData(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user._id, stationFilter]);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {data.department_name && (
              <Badge className="bg-primary/10 text-primary border-primary/20 text-xs" data-testid="supervisor-dept-badge">
                {data.department_name}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">Supervisor</Badge>
          </div>
        </div>
        <div className="min-w-[200px]">
          <Select value={stationFilter} onValueChange={setStationFilter}>
            <SelectTrigger data-testid="supervisor-station-filter">
              <SelectValue placeholder="All stations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my stations</SelectItem>
              {data.available_stations.map((s) => (
                <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="h-4 w-4 mr-2" /> Overview
          </TabsTrigger>
          <TabsTrigger value="my-tasks" data-testid="tab-my-tasks">
            <ListChecks className="h-4 w-4 mr-2" /> My Tasks
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-my-performance">
            <Wrench className="h-4 w-4 mr-2" /> My Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <SupervisorOverviewTab data={data} onSelectCategory={() => setActiveTab('my-tasks')} />
        </TabsContent>

        <TabsContent value="my-tasks" className="mt-4">
          <SupervisorMyTasksTab userId={user._id} stationId={stationFilter !== 'all' ? stationFilter : null} />
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <SupervisorPerformanceTab userId={user._id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ======================================================================
// PLACEHOLDER for ASUP / RO / Admin until later phases
// ======================================================================
function PlaceholderDashboard({ role }) {
  const { user } = useAuth();
  const labels = {
    approving_supervisor: 'Approving Supervisor Dashboard',
    reporting_officer: 'Reporting Officer Dashboard',
    admin: 'Admin Dashboard',
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{labels[role] || 'Dashboard'}</p>
      </div>
      <Card>
        <CardContent className="p-10 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium">Dashboard coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">
            This dashboard is being built in the next phase. Other pages (Schedules, New Inspection) are fully functional.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ======================================================================
// PAGE ENTRY: route by role
// ======================================================================
export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'supervisor') return <SupervisorDashboard />;
  if (user.role === 'approving_supervisor') return <OversightDashboard mode="asup" />;
  if (user.role === 'reporting_officer') return <OversightDashboard mode="ro" />;
  if (user.role === 'admin') return <AdminDashboard />;
  return <SuperadminDashboard />;
}
