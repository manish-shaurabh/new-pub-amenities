import { useState, useEffect, useCallback } from 'react';
import { schedulesAPI, usersAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Calendar, ChevronDown, ClipboardCheck, User as UserIcon, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

// Default range: today -> today+7
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
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

// ---------------------------------------------------------------------------
// Supervisor view: date range + tasks grouped by asset category
// ---------------------------------------------------------------------------
function SupervisorScheduleView({ userId, headerActions, hideHeader }) {
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(offsetStr(7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState({});

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await schedulesAPI.forSupervisor(userId, fromDate, toDate);
      setData(r.data);
      // Open all groups by default on first load
      const init = {};
      (r.data.groups || []).forEach((g) => { init[g.asset_type_id] = true; });
      setOpenGroups(init);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [userId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

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

      {/* Date range controls */}
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
            <Button onClick={load} data-testid="schedule-apply-button" className="h-9">Apply</Button>
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
          {data && (
            <p className="text-xs text-muted-foreground mt-3">
              <span className="font-medium text-foreground">{data.total_tasks}</span> tasks scheduled between{' '}
              <span className="font-medium text-foreground">{formatDate(data.from_date)}</span> and{' '}
              <span className="font-medium text-foreground">{formatDate(data.to_date)}</span>
              {data.user_name ? ` for ${data.user_name}` : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
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

      {/* Grouped tasks */}
      {!loading && data && data.groups && data.groups.length > 0 && (
        <div className="space-y-3">
          {data.groups.map((g) => (
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approving Supervisor view: list of supervisors -> click -> view their schedule
// ---------------------------------------------------------------------------
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
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted/50 animate-pulse rounded-xl" />
          ))}
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
                {s.department_name && (
                  <Badge variant="outline" className="text-[10px]">{s.department_name}</Badge>
                )}
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

// ---------------------------------------------------------------------------
// Admin / Superadmin / Reporting Officer view: pick a supervisor, see schedule
// ---------------------------------------------------------------------------
function AdminScheduleView() {
  const [supervisors, setSupervisors] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await usersAPI.list({ role: 'supervisor' });
        const sups = (r.data || []).filter((u) => u.role === 'supervisor' && u.is_active !== false);
        setSupervisors(sups);
      } catch (e) {
        console.error(e);
        toast.error('Failed to load supervisors');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a supervisor to view their inspection schedule.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1 flex-1 min-w-[260px]">
              <Label className="text-xs">Supervisor</Label>
              <Select value={selectedId} onValueChange={setSelectedId} disabled={loading}>
                <SelectTrigger data-testid="schedule-pick-supervisor">
                  <SelectValue placeholder={loading ? 'Loading...' : 'Choose a supervisor'} />
                </SelectTrigger>
                <SelectContent>
                  {supervisors.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name} ({s.employee_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedId ? (
        <SupervisorScheduleView userId={selectedId} hideHeader={true} />
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium">Pick a supervisor to view their schedule</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page entry: routes by role
// ---------------------------------------------------------------------------
export default function SchedulesPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'supervisor') {
    return <SupervisorScheduleView userId={user._id} />;
  }
  if (user.role === 'approving_supervisor') {
    return <ApprovingSupervisorScheduleView userId={user._id} />;
  }
  // superadmin, admin, reporting_officer
  return <AdminScheduleView />;
}
