/**
 * Admin / Reporting Officer dashboard with multi-filters.
 * Uses the /api/dashboard/admin endpoint with optional station/department/RO multi-filters.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../lib/auth-context';
import { dashboardAPI, stationsAPI, departmentsAPI, usersAPI } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import {
  Box, BarChart3, Building2, ChevronDown, ArrowRight, ArrowLeft,
  Filter, X, Wrench, ShieldAlert, TrendingUp,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import SupervisorAnalyticsView from '../SupervisorAnalyticsView';
import AdminPerformanceMatrix from '../AdminPerformanceMatrix';

const HEALTH_COLORS = { working: '#0e7c6b', orange: '#f97316', red: '#dc2626' };

function MultiSelect({ label, options, selected, onChange, testId }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return options;
    return options.filter((o) => (o.label || '').toLowerCase().includes(search.toLowerCase()));
  }, [options, search]);
  const summary = selected.length === 0 ? 'Any' : selected.length === 1
    ? options.find((o) => o.value === selected[0])?.label || '1 selected'
    : `${selected.length} selected`;
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const clear = (e) => { e.stopPropagation(); onChange([]); };
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-9 font-normal" data-testid={testId}>
            <span className={`truncate text-sm ${selected.length === 0 ? 'text-muted-foreground' : ''}`}>{summary}</span>
            <span className="flex items-center gap-1 ml-2">
              {selected.length > 0 && (
                <span role="button" onClick={clear} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] p-0">
          <div className="p-2 border-b">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
          </div>
          <ScrollArea className="max-h-[260px]">
            <div className="p-1">
              {filtered.length === 0 && <p className="text-xs text-muted-foreground px-3 py-4 text-center">No matches</p>}
              {filtered.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                  <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                  <span className="truncate">{o.label}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function HealthRow({ row, onClick }) {
  const issues = (row.orange || 0) + (row.red || 0);
  const pct = row.asset_count ? Math.round((row.working / row.asset_count) * 100) : 100;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-lg border px-3 py-2.5 hover:border-primary/40 hover:bg-muted/30 transition text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
          {(row.name || row.station_name || row.asset_type_name || '?').charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{row.name || row.station_name || row.asset_type_name}</p>
          {row.employee_id && <p className="text-[11px] text-muted-foreground truncate">{row.employee_id}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {row.department_name && <Badge variant="outline" className="text-[10px]">{row.department_name}</Badge>}
        <Badge variant="secondary" className="text-[10px]">{row.asset_count || 0}</Badge>
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{pct}%</Badge>
        {issues > 0 && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{issues} issues</Badge>}
        {row.supervisors_count !== undefined && (
          <Badge variant="secondary" className="text-[10px]">{row.supervisors_count} sups</Badge>
        )}
        {onClick && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
      </div>
    </button>
  );
}

export default function AdminDashboard({ targetUser = null }) {
  const { user: authUser } = useAuth();
  const user = targetUser || authUser;
  const [stations, setStations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [reportingOfficers, setReportingOfficers] = useState([]);
  const [allSupervisors, setAllSupervisors] = useState([]);
  const [selStations, setSelStations] = useState([]);
  const [selDepartments, setSelDepartments] = useState([]);
  const [selROs, setSelROs] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  // Performance analytics panel
  const [showPerfPanel, setShowPerfPanel] = useState(false);

  // Load filter options
  useEffect(() => {
    (async () => {
      try {
        const [s, d, u] = await Promise.all([stationsAPI.list(), departmentsAPI.list(), usersAPI.list({})]);
        setStations(s.data || []);
        setDepartments(d.data || []);
        const users = u.data || [];
        setReportingOfficers(users.filter((x) => x.role === 'reporting_officer' && x.is_active !== false));
        setAllSupervisors(users.filter((x) => x.role === 'supervisor' && x.is_active !== false));
      } catch (e) { console.error(e); }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dashboardAPI.admin({
        station_ids: selStations,
        department_ids: selDepartments,
        reporting_officer_ids: selROs,
      });
      setData(r.data);
    } catch (e) { console.error(e); toast.error('Failed to load admin dashboard'); }
    finally { setLoading(false); }
  }, [selStations, selDepartments, selROs]);
  useEffect(() => { load(); }, [load]);

  // Filtered supervisors for performance panel
  const filterCount = selStations.length + selDepartments.length + selROs.length;
  const clearAll = () => { setSelStations([]); setSelDepartments([]); setSelROs([]); };

  const pieData = data ? [
    { name: 'Working', value: data.health.working, color: HEALTH_COLORS.working },
    { name: 'Orange', value: data.health.orange, color: HEALTH_COLORS.orange },
    { name: 'Red', value: data.health.red, color: HEALTH_COLORS.red },
  ].filter((d) => d.value > 0) : [];

  if (loading || !data) {
    return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs">Admin</Badge>
            <p className="text-sm text-muted-foreground">Filtered overview across the system</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} data-testid="admin-clear-filters">
              <X className="h-4 w-4 mr-1" /> Clear filters
            </Button>
          )}
          <Button
            variant={showPerfPanel ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowPerfPanel(v => !v)}
            data-testid="admin-performance-analytics-btn"
          >
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Performance Analytics
          </Button>
        </div>
      </div>

      {/* ── Performance Analytics Inline Panel ── */}
      {showPerfPanel && (
        <AdminPerformanceMatrix onClose={() => setShowPerfPanel(false)} />
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Filters</p>
            {filterCount > 0 && <Badge variant="secondary" className="text-[10px]">{filterCount} active</Badge>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MultiSelect
              label="Stations"
              options={stations.map((s) => ({ value: s._id, label: s.name }))}
              selected={selStations}
              onChange={setSelStations}
              testId="admin-filter-stations"
            />
            <MultiSelect
              label="Departments"
              options={departments.map((d) => ({ value: d._id, label: d.name }))}
              selected={selDepartments}
              onChange={setSelDepartments}
              testId="admin-filter-departments"
            />
            <MultiSelect
              label="Reporting Officers"
              options={reportingOfficers.map((u) => ({ value: u._id, label: `${u.name} (${u.employee_id})` }))}
              selected={selROs}
              onChange={setSelROs}
              testId="admin-filter-ros"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="stations" data-testid="tab-stations">Stations</TabsTrigger>
          <TabsTrigger value="reporting-officers" data-testid="tab-reporting-officers">Reporting Officers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Overall Health</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{data.total_assets ?? data.totals?.assets ?? 0} asset(s) in current filters</p>
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
                ) : <p className="text-sm text-muted-foreground text-center py-10">No data in current filters</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" /> Stations Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.stations.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No stations</p>}
                {data.stations.slice(0, 6).map((s) => <HealthRow key={s.station_id || s._id} row={s} />)}
                {data.stations.length > 6 && (
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setTab('stations')}>
                    View all {data.stations.length} stations →
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="mt-4 space-y-2">
          {(data.asset_categories || data.categories || []).length === 0 ? (
            <Card><CardContent className="p-12 text-center">
              <Box className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">No categories in current filters</p>
            </CardContent></Card>
          ) : (data.asset_categories || data.categories || []).map((c) => (
            <HealthRow key={c.asset_type_id} row={{ ...c, name: c.asset_type_name }} />
          ))}
        </TabsContent>

        <TabsContent value="stations" className="mt-4 space-y-3">
          {data.stations.map((s) => (
            <Card key={s.station_id || s._id} className="overflow-hidden">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{s.station_name || s.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{s.asset_count}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{s.pct_functional}%</Badge>
                      {(s.orange + s.red) > 0 && (
                        <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{s.orange + s.red} issues</Badge>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    {(s.categories || []).length === 0 && (
                      <p className="text-xs text-muted-foreground px-4 py-3">No category breakdown available</p>
                    )}
                    {(s.categories || []).map((c) => (
                      <div key={c.asset_type_id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <Box className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{c.asset_type_name}</span>
                          <Badge variant="secondary" className="text-[10px]">{c.asset_count}</Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{c.working} ok</Badge>
                          {c.orange > 0 && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">{c.orange} orange</Badge>}
                          {c.red > 0 && <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">{c.red} red</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="reporting-officers" className="mt-4 space-y-2">
          {data.reporting_officers.length === 0 ? (
            <Card><CardContent className="p-12 text-center">
              <ShieldAlert className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">No reporting officers</p>
            </CardContent></Card>
          ) : data.reporting_officers.map((ro) => <HealthRow key={ro._id} row={ro} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
