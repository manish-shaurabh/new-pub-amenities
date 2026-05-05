import { useState, useEffect, useCallback, useMemo } from 'react';
import { schedulesAPI, usersAPI, stationsAPI, departmentsAPI, assetTypesAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Checkbox } from '../components/ui/checkbox';
import { ScrollArea } from '../components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Calendar, ChevronDown, ClipboardCheck, User as UserIcon, ArrowLeft, Filter, X } from 'lucide-react';
import { toast } from 'sonner';

// ---------- date helpers ----------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const offsetStr = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const daysLeftLabel = (n) => {
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `In ${n}d`;
};
const daysLeftClass = (n) => {
  if (n < 0) return 'bg-red-100 text-red-700 border-red-200';
  if (n === 0) return 'bg-orange-100 text-orange-700 border-orange-200';
  if (n <= 2) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

// ---------- shared MultiSelect (popover + checkboxes) ----------
function MultiSelect({ label, options, selected, onChange, placeholder = 'Any', testId }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search) return options;
    return options.filter((o) => (o.label || '').toLowerCase().includes(search.toLowerCase()));
  }, [options, search]);
  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || '1 selected'
      : `${selected.length} selected`;

  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  const clear = (e) => { e.stopPropagation(); onChange([]); };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-9 font-normal"
            data-testid={testId}
          >
            <span className={`truncate text-sm ${selected.length === 0 ? 'text-muted-foreground' : ''}`}>
              {summary}
            </span>
            <span className="flex items-center gap-1 ml-2">
              {selected.length > 0 && (
                <span
                  role="button"
                  onClick={clear}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] p-0">
          <div className="p-2 border-b">
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <ScrollArea className="max-h-[260px]">
            <div className="p-1">
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">No matches</p>
              )}
              {filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={selected.includes(o.value)}
                    onCheckedChange={() => toggle(o.value)}
                  />
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

// ---------- Task groups display (shared between supervisor + admin views) ----------
function TaskGroups({ groups, showSupervisor = false }) {
  const [openGroups, setOpenGroups] = useState({});
  useEffect(() => {
    const init = {};
    (groups || []).forEach((g) => { init[g.asset_type_id] = true; });
    setOpenGroups(init);
  }, [groups]);

  if (!groups || groups.length === 0) return null;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card key={g.asset_type_id} className="overflow-hidden">
          <Collapsible
            open={openGroups[g.asset_type_id] !== false}
            onOpenChange={(open) => setOpenGroups((s) => ({ ...s, [g.asset_type_id]: open }))}
          >
            <CollapsibleTrigger asChild>
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                data-testid={`schedule-group-${g.asset_type_id}`}
              >
                <div className="flex items-center gap-3">
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      openGroups[g.asset_type_id] === false ? '-rotate-90' : ''
                    }`}
                  />
                  <span className="font-medium text-sm">{g.asset_type_name}</span>
                  <Badge variant="secondary" className="text-xs">{g.task_count} tasks</Badge>
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t">
                {g.tasks.map((t, idx) => (
                  <div
                    key={`${t.asset_id}-${idx}`}
                    className="flex items-center justify-between px-4 py-2.5 border-b last:border-0 hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.asset_number}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t.station_name} &middot; {t.location_name} &middot; every {t.frequency_days}d
                          {showSupervisor && t.supervisor_name && (
                            <> &middot; <span className="text-foreground">{t.supervisor_name}</span></>
                          )}
                          {showSupervisor && !t.supervisor_name && (
                            <> &middot; <span className="text-muted-foreground italic">unassigned</span></>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:block">
                        {formatDate(t.due_date)}
                      </span>
                      <Badge className={`text-[10px] border ${daysLeftClass(t.days_left)}`}>
                        {daysLeftLabel(t.days_left)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}
    </div>
  );
}

// ---------- Date range card ----------
function DateRangeCard({ fromDate, toDate, setFromDate, setToDate, onApply, summaryText }) {
  const presets = [
    { label: '7d', days: 7 },
    { label: '14d', days: 14 },
    { label: '30d', days: 30 },
  ];
  const applyPreset = (days) => {
    setFromDate(todayStr());
    setToDate(offsetStr(days));
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[160px]"
              data-testid="schedule-from-date"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[160px]"
              data-testid="schedule-to-date"
            />
          </div>
          <Button onClick={onApply} data-testid="schedule-apply-button" className="h-9">Apply</Button>
          <div className="flex items-center gap-1.5 ml-auto">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(p.days)}
                data-testid={`schedule-preset-${p.label}`}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        {summaryText && <p className="text-xs text-muted-foreground mt-3">{summaryText}</p>}
      </CardContent>
    </Card>
  );
}

// ---------- Supervisor view ----------
function SupervisorScheduleView({ userId, headerActions, hideHeader }) {
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(offsetStr(7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await schedulesAPI.forSupervisor(userId, fromDate, toDate);
      setData(r.data);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [userId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const summary = data
    ? <><span className="font-medium text-foreground">{data.total_tasks}</span> tasks scheduled between{' '}
        <span className="font-medium text-foreground">{formatDate(data.from_date)}</span> and{' '}
        <span className="font-medium text-foreground">{formatDate(data.to_date)}</span>
        {data.user_name ? ` for ${data.user_name}` : ''}</>
    : null;

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Inspection tasks based on each asset's frequency.
            </p>
          </div>
          {headerActions}
        </div>
      )}
      <DateRangeCard
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={load}
        summaryText={summary}
      />
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-xl" />)}
        </div>
      )}
      {!loading && data && data.total_tasks === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">No tasks in this date range</p>
            <p className="text-xs text-muted-foreground mt-1">
              Either no assets are assigned, or none have an inspection frequency configured.
            </p>
          </CardContent>
        </Card>
      )}
      {!loading && data && data.groups && (
        <TaskGroups groups={data.groups} />
      )}
    </div>
  );
}

// ---------- Approving Supervisor view ----------
function ApprovingSupervisorScheduleView({ userId }) {
  const [supervisors, setSupervisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSup, setSelectedSup] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await schedulesAPI.supervisorsUnderApproving(userId);
        setSupervisors(r.data.supervisors || []);
      } catch (e) {
        console.error(e);
        toast.error('Failed to load supervisors');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (selectedSup) {
    return (
      <SupervisorScheduleView
        userId={selectedSup._id}
        hideHeader={false}
        headerActions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedSup(null)}
            data-testid="schedule-back-to-supervisors"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to supervisors
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Click any supervisor to view their inspection schedule.
        </p>
      </div>
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />)}
        </div>
      )}
      {!loading && supervisors.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <UserIcon className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">No supervisors found</p>
            <p className="text-xs text-muted-foreground mt-1">
              No supervisors are assigned to your stations yet.
            </p>
          </CardContent>
        </Card>
      )}
      {!loading && supervisors.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {supervisors.map((s) => (
            <button
              key={s._id}
              onClick={() => setSelectedSup(s)}
              className="text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
              data-testid={`schedule-supervisor-card-${s._id}`}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                  {(s.name || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.employee_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {s.department_name && <Badge variant="outline" className="text-[10px]">{s.department_name}</Badge>}
                <Badge variant="secondary" className="text-[10px]">
                  {s.scheduled_assets_count}/{s.assigned_assets_count} scheduled
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Admin / Superadmin / RO multi-filter view ----------
function AdminScheduleView({ scopeStations, scopeDepartments, scopeSupervisors, scopeReportingOfficers }) {
  // scope* params can pre-restrict the option lists (used for RO scoping in future)
  const [stations, setStations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [reportingOfficers, setReportingOfficers] = useState([]);

  const [selStations, setSelStations] = useState([]);
  const [selDepartments, setSelDepartments] = useState([]);
  const [selAssetTypes, setSelAssetTypes] = useState([]);
  const [selSupervisors, setSelSupervisors] = useState([]);
  const [selROs, setSelROs] = useState([]);

  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(offsetStr(7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load filter option metadata
  useEffect(() => {
    (async () => {
      try {
        const [s, d, t, u] = await Promise.all([
          stationsAPI.list(),
          departmentsAPI.list(),
          assetTypesAPI.list(),
          usersAPI.list({}),
        ]);
        const allUsers = u.data || [];
        const sups = allUsers.filter((x) => x.role === 'supervisor' && x.is_active !== false);
        const ros = allUsers.filter((x) => x.role === 'reporting_officer' && x.is_active !== false);

        // Apply scope restrictions when present
        const scopeStationSet = scopeStations ? new Set(scopeStations) : null;
        const filteredStations = scopeStationSet
          ? (s.data || []).filter((x) => scopeStationSet.has(x._id))
          : (s.data || []);
        const filteredDepartments = scopeDepartments
          ? (d.data || []).filter((x) => scopeDepartments.includes(x._id))
          : (d.data || []);
        const filteredTypes = scopeDepartments
          ? (t.data || []).filter((x) => scopeDepartments.includes(x.department_id))
          : (t.data || []);
        const filteredSups = scopeSupervisors
          ? sups.filter((x) => scopeSupervisors.includes(x._id))
          : sups;
        const filteredROs = scopeReportingOfficers
          ? ros.filter((x) => scopeReportingOfficers.includes(x._id))
          : ros;

        setStations(filteredStations);
        setDepartments(filteredDepartments);
        setAssetTypes(filteredTypes);
        setSupervisors(filteredSups);
        setReportingOfficers(filteredROs);
      } catch (e) {
        console.error(e);
        toast.error('Failed to load filter options');
      }
    })();
  }, [scopeStations, scopeDepartments, scopeSupervisors, scopeReportingOfficers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await schedulesAPI.admin({
        station_ids: selStations,
        department_ids: selDepartments,
        asset_type_ids: selAssetTypes,
        supervisor_ids: selSupervisors,
        reporting_officer_ids: selROs,
        from_date: fromDate,
        to_date: toDate,
      });
      setData(r.data);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [selStations, selDepartments, selAssetTypes, selSupervisors, selROs, fromDate, toDate]);

  // Initial load on mount
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const clearAllFilters = () => {
    setSelStations([]);
    setSelDepartments([]);
    setSelAssetTypes([]);
    setSelSupervisors([]);
    setSelROs([]);
  };

  const filterCount = selStations.length + selDepartments.length + selAssetTypes.length + selSupervisors.length + selROs.length;
  const summary = data
    ? <><span className="font-medium text-foreground">{data.total_tasks}</span> tasks scheduled between{' '}
        <span className="font-medium text-foreground">{formatDate(data.from_date)}</span> and{' '}
        <span className="font-medium text-foreground">{formatDate(data.to_date)}</span>
        {filterCount > 0 ? ` (${filterCount} filter${filterCount > 1 ? 's' : ''} applied)` : ''}</>
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filter inspection tasks across stations, departments, asset categories, supervisors and reporting officers. All filters are optional.
          </p>
        </div>
        {filterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="schedule-clear-filters">
            <X className="h-4 w-4 mr-1" /> Clear filters
          </Button>
        )}
      </div>

      {/* Filter card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Filters</p>
            {filterCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">{filterCount} active</Badge>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <MultiSelect
              label="Stations"
              options={stations.map((s) => ({ value: s._id, label: s.name }))}
              selected={selStations}
              onChange={setSelStations}
              testId="schedule-filter-stations"
            />
            <MultiSelect
              label="Departments"
              options={departments.map((d) => ({ value: d._id, label: d.name }))}
              selected={selDepartments}
              onChange={setSelDepartments}
              testId="schedule-filter-departments"
            />
            <MultiSelect
              label="Asset Categories"
              options={assetTypes.map((a) => ({ value: a._id, label: a.name }))}
              selected={selAssetTypes}
              onChange={setSelAssetTypes}
              testId="schedule-filter-asset-types"
            />
            <MultiSelect
              label="Reporting Officers"
              options={reportingOfficers.map((u) => ({ value: u._id, label: `${u.name} (${u.employee_id})` }))}
              selected={selROs}
              onChange={setSelROs}
              testId="schedule-filter-reporting-officers"
            />
            <MultiSelect
              label="Supervisors"
              options={supervisors.map((u) => ({ value: u._id, label: `${u.name} (${u.employee_id})` }))}
              selected={selSupervisors}
              onChange={setSelSupervisors}
              testId="schedule-filter-supervisors"
            />
          </div>
        </CardContent>
      </Card>

      {/* Date range + Apply */}
      <DateRangeCard
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
        onApply={load}
        summaryText={summary}
      />

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-xl" />)}
        </div>
      )}
      {!loading && data && data.total_tasks === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">No tasks match these filters</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try widening the date range or clearing some filters.
            </p>
          </CardContent>
        </Card>
      )}
      {!loading && data && data.groups && (
        <TaskGroups groups={data.groups} showSupervisor={true} />
      )}
    </div>
  );
}

// ---------- Page entry ----------
export default function SchedulesPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'supervisor') {
    return <SupervisorScheduleView userId={user._id} />;
  }
  if (user.role === 'approving_supervisor') {
    return <ApprovingSupervisorScheduleView userId={user._id} />;
  }
  if (user.role === 'reporting_officer') {
    // RO is scoped to: their assigned stations, their department, their linked supervisors
    return (
      <AdminScheduleView
        scopeStations={user.assigned_stations || []}
        scopeDepartments={user.department_id ? [user.department_id] : []}
      />
    );
  }
  // superadmin, admin -> full multi-filter view
  return <AdminScheduleView />;
}
