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
  Box, AlertTriangle, ClipboardCheck, Calendar, Building2, Clock, ShieldAlert,
  ChevronDown, Wrench, ListChecks, BarChart3, ArrowRight,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

// Health palette (matches our orange/red list semantics)
const HEALTH_COLORS = {
  working: '#0e7c6b',
  orange: '#f97316',
  red: '#dc2626',
};

// ======================================================================
// SUPERADMIN DASHBOARD (cleaned: removed Recent Inspections + Orange/Red cards)
// ======================================================================
function SuperadminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [stationHealth, setStationHealth] = useState([]);
  const [assetTypeHealth, setAssetTypeHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statsRes, stationRes, atRes] = await Promise.all([
          dashboardAPI.stats(),
          fetch(`${API_BASE}/api/dashboard/station-health`).then((r) => r.json()),
          fetch(`${API_BASE}/api/dashboard/asset-type-health`).then((r) => r.json()),
        ]);
        setStats(statsRes.data);
        setStationHealth(stationRes);
        setAssetTypeHealth(atRes);
      } catch (e) {
        console.error('Failed to load dashboard', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  const kpiCards = [
    { label: 'Total Assets', value: stats?.total_assets || 0, icon: Box, color: 'text-primary' },
    { label: 'Working', value: stats?.working_assets || 0, icon: Box, color: 'text-[hsl(var(--ok))]' },
    { label: 'Orange List', value: stats?.orange_list_count || 0, icon: AlertTriangle, color: 'text-orange-500' },
    { label: 'Red List', value: stats?.red_list_count || 0, icon: ShieldAlert, color: 'text-red-600' },
    { label: 'Pending Approvals', value: stats?.pending_approvals || 0, icon: Clock, color: 'text-[hsl(var(--pending))]' },
    { label: 'Total Inspections', value: stats?.total_inspections || 0, icon: ClipboardCheck, color: 'text-[hsl(var(--info))]' },
    { label: 'Overdue', value: stats?.overdue_count || 0, icon: Calendar, color: 'text-destructive' },
    { label: 'Stations', value: stats?.total_stations || 0, icon: Building2, color: 'text-muted-foreground' },
  ];

  const healthPieData = [
    { name: 'Working', value: stats?.working_assets || 0, color: HEALTH_COLORS.working },
    { name: 'Orange', value: stats?.orange_list_count || 0, color: HEALTH_COLORS.orange },
    { name: 'Red', value: stats?.red_list_count || 0, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Welcome back, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">System-wide overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label} className="kpi-hover transition-shadow duration-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                <span className="font-[Space_Grotesk] text-2xl font-semibold tabular-nums">{kpi.value}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Station-wise Asset Health</CardTitle>
          </CardHeader>
          <CardContent>
            {stationHealth.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stationHealth} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="station_name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="working" stackId="a" fill={HEALTH_COLORS.working} name="Working" />
                  <Bar dataKey="defective" stackId="a" fill={HEALTH_COLORS.red} name="Defective" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center py-10">No station data yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Overall Asset Health</CardTitle>
          </CardHeader>
          <CardContent>
            {healthPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={healthPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                    {healthPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
          </CardContent>
        </Card>
      </div>

      {assetTypeHealth.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Asset Type Health</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={assetTypeHealth} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="asset_type_name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="working" stackId="a" fill={HEALTH_COLORS.working} name="Working" />
                <Bar dataKey="defective" stackId="a" fill={HEALTH_COLORS.red} name="Defective" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
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
  if (user.role === 'approving_supervisor') return <PlaceholderDashboard role="approving_supervisor" />;
  if (user.role === 'reporting_officer') return <PlaceholderDashboard role="reporting_officer" />;
  if (user.role === 'admin') return <PlaceholderDashboard role="admin" />;
  return <SuperadminDashboard />;
}
