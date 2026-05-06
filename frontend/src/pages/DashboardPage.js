import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dashboardAPI, analyticsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import {
  Box,
  ChevronDown, Wrench, AlertTriangle, BarChart3, ArrowRight, ArrowLeft, Eye,
} from 'lucide-react';
import OrangeListPanel from '../components/OrangeListPanel';
import SupervisorAnalyticsView from '../components/SupervisorAnalyticsView';
import {
  Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

import OversightDashboard from '../components/dashboards/OversightDashboard';
import AdminDashboard from '../components/dashboards/AdminDashboard';
import SuperadminDashboard from '../components/dashboards/SuperadminDashboard';

// Health palette (matches our orange/red list semantics)
const HEALTH_COLORS = {
  working: '#0e7c6b',
  orange: '#f97316',
  red: '#dc2626',
};


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

function SupervisorPerformanceTab({ userId }) {
  return <SupervisorAnalyticsView supervisorId={userId} />;
}

function SupervisorDashboard({ targetUser = null }) {
  const { user: authUser } = useAuth();
  const user = targetUser || authUser;
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
          <TabsTrigger value="defects" data-testid="tab-defects">
            <AlertTriangle className="h-4 w-4 mr-2" /> Defects
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-my-performance">
            <Wrench className="h-4 w-4 mr-2" /> My Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <SupervisorOverviewTab data={data} onSelectCategory={() => setActiveTab('defects')} />
        </TabsContent>

        <TabsContent value="defects" className="mt-4">
          <OrangeListPanel userId={user._id} mode="sup" />
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <SupervisorPerformanceTab userId={user._id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ======================================================================
// VIEW-AS BANNER (shown when superadmin/admin views another user's dashboard)
// ======================================================================
function ViewAsBanner({ targetUser, onExit }) {
  const roleLabels = {
    supervisor: 'Supervisor',
    approving_supervisor: 'Approving Supervisor',
    reporting_officer: 'Reporting Officer',
    admin: 'Admin',
  };
  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
      data-testid="view-as-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 text-primary flex-shrink-0" />
        <p className="text-sm truncate">
          <span className="text-muted-foreground">Viewing as</span>{' '}
          <span className="font-semibold">{targetUser.name}</span>{' '}
          <Badge variant="outline" className="ml-1 text-[10px]">{roleLabels[targetUser.role] || targetUser.role}</Badge>
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onExit}
        data-testid="view-as-exit-button"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to my dashboard
      </Button>
    </div>
  );
}

// ======================================================================
// PAGE ENTRY: route by role (with View-As support for superadmin/admin)
// ======================================================================
export default function DashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const asUserId = searchParams.get('as');

  const [targetUser, setTargetUser] = useState(null);
  const [resolving, setResolving] = useState(false);

  const canViewAs = user && (user.role === 'superadmin' || user.role === 'admin');

  useEffect(() => {
    if (!asUserId || !canViewAs) {
      setTargetUser(null);
      return;
    }
    setResolving(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await usersAPI.get(asUserId);
        if (!cancelled) setTargetUser(r.data);
      } catch (e) {
        console.error('Failed to load target user', e);
        if (!cancelled) {
          setTargetUser(null);
          // Strip invalid `as` param
          searchParams.delete('as');
          setSearchParams(searchParams, { replace: true });
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [asUserId, canViewAs, searchParams, setSearchParams]);

  const exitViewAs = () => {
    searchParams.delete('as');
    setSearchParams(searchParams, { replace: true });
    setTargetUser(null);
  };

  if (!user) return null;

  // Resolving target user — render skeleton
  if (asUserId && canViewAs && resolving) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  // Render target user's dashboard if "as" mode active
  if (targetUser && canViewAs) {
    const role = targetUser.role;
    let inner;
    if (role === 'supervisor') inner = <SupervisorDashboard targetUser={targetUser} />;
    else if (role === 'approving_supervisor') inner = <OversightDashboard mode="asup" targetUser={targetUser} />;
    else if (role === 'reporting_officer') inner = <OversightDashboard mode="ro" targetUser={targetUser} />;
    else if (role === 'admin') inner = <AdminDashboard targetUser={targetUser} />;
    else {
      // For superadmin (cannot view-as) or unknown — fall back to navigate away
      return (
        <div>
          <ViewAsBanner targetUser={targetUser} onExit={exitViewAs} />
          <Card>
            <CardContent className="p-10 text-center">
              <BarChart3 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm">No dashboard view available for role: {role}</p>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div>
        <ViewAsBanner targetUser={targetUser} onExit={exitViewAs} />
        {inner}
      </div>
    );
  }

  // Default — render based on logged-in user role
  if (user.role === 'supervisor') return <SupervisorDashboard />;
  if (user.role === 'approving_supervisor') return <OversightDashboard mode="asup" />;
  if (user.role === 'reporting_officer') return <OversightDashboard mode="ro" />;
  if (user.role === 'admin') return <AdminDashboard />;
  return <SuperadminDashboard />;
}
