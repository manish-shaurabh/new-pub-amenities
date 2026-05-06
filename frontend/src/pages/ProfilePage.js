import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth-context';
import axios from 'axios';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  MapPin, Building2, ChevronDown, ChevronRight, User, Users,
  Package, CheckCircle, AlertTriangle, TrendingUp
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

const ROLE_LABELS = {
  supervisor: 'Supervisor',
  approving_supervisor: 'Approving Supervisor',
  reporting_officer: 'Reporting Officer',
  admin: 'Admin',
  superadmin: 'Super Admin',
};

const HEALTH_CONFIG = {
  working: { label: 'Working', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
  orange:  { label: 'Defective', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500' },
  red:     { label: 'Critical', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', dot: 'bg-red-500' },
};

function HealthBadge({ cls }) {
  const cfg = HEALTH_CONFIG[cls] || HEALTH_CONFIG.working;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color = 'text-primary', sub }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border bg-card/60">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${color === 'text-emerald-600' ? 'bg-emerald-50 dark:bg-emerald-950/40' : color === 'text-orange-500' ? 'bg-orange-50 dark:bg-orange-950/40' : color === 'text-red-500' ? 'bg-red-50 dark:bg-red-950/40' : 'bg-primary/10'}`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function AssetRow({ asset }) {
  const cls = asset.health_class || 'working';
  const cfg = HEALTH_CONFIG[cls];
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${cls !== 'working' ? `${cfg.bg} ${cfg.border}` : 'border-transparent hover:bg-muted/30'} transition-colors`}
      data-testid={`profile-asset-row-${asset.asset_id}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="text-sm font-medium truncate">{asset.asset_number}</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">{asset.type_name}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {asset.supervisor_name && (
          <span className="text-xs text-muted-foreground hidden md:inline">{asset.supervisor_name}</span>
        )}
        <HealthBadge cls={cls} />
      </div>
    </div>
  );
}

function LocationGroup({ location, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDefects = location.assets.some(a => a.health_class !== 'working');
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        data-testid={`profile-location-toggle-${location.location_id}`}
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{location.location_name}</span>
          <span className="text-xs text-muted-foreground">({location.asset_count} assets)</span>
          {hasDefects && <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="p-3 space-y-1.5 bg-card/40">
          {location.assets.map(a => <AssetRow key={a.asset_id} asset={a} />)}
        </div>
      )}
    </div>
  );
}

function DeptGroup({ dept, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const defects = dept.locations.reduce((sum, l) => sum + l.assets.filter(a => a.health_class !== 'working').length, 0);
  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        data-testid={`profile-dept-toggle-${dept.dept_id}`}
      >
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{dept.dept_name}</span>
          <Badge variant="secondary" className="text-[10px] py-0 h-5">{dept.asset_count}</Badge>
          {dept.supervisor_name && (
            <span className="text-xs text-muted-foreground hidden sm:inline">SUP: {dept.supervisor_name}</span>
          )}
          {defects > 0 && <span className="text-xs text-orange-600 font-medium">{defects} defective</span>}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-card/20">
          {dept.locations.map(loc => (
            <LocationGroup key={loc.location_id} location={loc} />
          ))}
        </div>
      )}
    </div>
  );
}

function StationBlock({ station, role }) {
  const [open, setOpen] = useState(false);
  const pct = station.pct_functional ?? 100;
  const defects = station.orange + station.red;

  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors text-left"
        data-testid={`profile-station-toggle-${station.station_id}`}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
            {station.code || station.station_name?.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-sm">{station.station_name}</p>
            <p className="text-xs text-muted-foreground">
              {station.asset_count} assets &middot; {pct.toFixed(0)}% functional
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{station.working}</span>
            {station.orange > 0 && <span className="flex items-center gap-1 text-orange-600"><span className="h-2 w-2 rounded-full bg-orange-500" />{station.orange}</span>}
            {station.red > 0 && <span className="flex items-center gap-1 text-red-600"><span className="h-2 w-2 rounded-full bg-red-500" />{station.red}</span>}
          </div>
          {defects > 0 && (
            <span className="text-[10px] bg-orange-100 dark:bg-orange-950/40 text-orange-700 border border-orange-200 dark:border-orange-800 px-2 py-0.5 rounded-full font-medium">
              {defects} defective
            </span>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <CardContent className="pt-0 pb-4 px-4">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {role === 'approving_supervisor' ? (
            <div className="space-y-2">
              {station.departments?.map(dept => (
                <DeptGroup key={dept.dept_id} dept={dept} defaultOpen={dept.locations.some(l => l.assets.some(a => a.health_class !== 'working'))} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {station.locations?.map(loc => (
                <LocationGroup key={loc.location_id} location={loc} defaultOpen={loc.assets.some(a => a.health_class !== 'working')} />
              ))}
            </div>
          )}

          {station.asset_count === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No assets at this station matching your scope.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SupervisorCard({ sup }) {
  const allWorking = sup.defective_count === 0;
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors hover:bg-muted/20 ${!allWorking ? 'border-orange-200 dark:border-orange-800' : ''}`}
      data-testid={`profile-supervisor-card-${sup.user_id}`}>
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
          {sup.name?.charAt(0)}
        </div>
        <div>
          <p className="font-medium text-sm">{sup.name}</p>
          <p className="text-xs text-muted-foreground">{sup.employee_id} &middot; {sup.station_names?.join(', ')}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-right">
        <div>
          <p className="text-sm font-semibold">{sup.asset_count} assets</p>
          {sup.defective_count > 0
            ? <p className="text-xs text-orange-600 font-medium">{sup.defective_count} defective</p>
            : <p className="text-xs text-emerald-600">All working</p>
          }
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('scope');
  const [deptFilter, setDeptFilter] = useState('all');
  const [stationFilter, setStationFilter] = useState('all');

  const fetchProfile = useCallback(async () => {
    if (!user?._id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (deptFilter !== 'all') params.set('dept_id', deptFilter);
      if (stationFilter !== 'all') params.set('station_id', stationFilter);
      const res = await axios.get(`${API}/api/profiles/${user._id}?${params.toString()}`);
      setProfile(res.data);
    } catch (e) {
      console.error('Failed to load profile', e);
    } finally {
      setLoading(false);
    }
  }, [user, deptFilter, stationFilter]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading profile…</p>
        </div>
      </div>
    );
  }

  const { user: u, stats, stations, my_supervisors, available_departments } = profile;
  const role = u.role;
  const isASUP = role === 'approving_supervisor';
  const isRO = role === 'reporting_officer';
  const tabs = [
    { key: 'scope', label: isASUP ? 'My Jurisdiction' : 'My Stations & Assets' },
    ...(isRO ? [{ key: 'supervisors', label: 'My Supervisors' }] : []),
  ];

  return (
    <div className="space-y-6 pb-8" data-testid="profile-page">
      {/* Profile header */}
      <div className="rounded-2xl border bg-card/60 backdrop-blur-sm overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-primary via-primary/60 to-transparent" />
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            {/* Avatar */}
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary flex-shrink-0">
              {u.name?.charAt(0) || 'U'}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold">{u.name}</h1>
                <Badge variant="secondary" className="text-xs">{u.employee_id}</Badge>
                <Badge className="text-xs capitalize">{ROLE_LABELS[role] || role}</Badge>
              </div>
              {u.department_name && (
                <p className="text-sm text-muted-foreground mb-1">
                  <Building2 className="inline h-3.5 w-3.5 mr-1" />
                  {u.department_name}
                </p>
              )}
              {u.reports_to && (
                <p className="text-xs text-muted-foreground">
                  Reports to: <span className="font-medium text-foreground">{u.reports_to.name}</span>
                  <span className="ml-1 text-muted-foreground">({u.reports_to.role})</span>
                </p>
              )}
              {u.email && <p className="text-xs text-muted-foreground mt-1">{u.email}</p>}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <StatCard icon={Package} label="Total Assets" value={stats.total_assets} color="text-primary" sub={`${stats.total_stations} station${stats.total_stations !== 1 ? 's' : ''}`} />
            <StatCard icon={CheckCircle} label="Working" value={stats.working} color="text-emerald-600" />
            {stats.orange > 0
              ? <StatCard icon={AlertTriangle} label="Defective (<24h)" value={stats.orange} color="text-orange-500" />
              : <StatCard icon={CheckCircle} label="Defective (<24h)" value={0} color="text-emerald-600" />
            }
            {stats.red > 0
              ? <StatCard icon={TrendingUp} label="Critical (>24h)" value={stats.red} color="text-red-500" />
              : <StatCard icon={CheckCircle} label="Critical (>24h)" value={0} color="text-emerald-600" />
            }
          </div>
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`profile-tab-${t.key}`}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Scope tab */}
      {activeTab === 'scope' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            {isASUP && available_departments?.length > 0 && (
              <div className="min-w-[180px]">
                <Select value={deptFilter} onValueChange={setDeptFilter} data-testid="profile-dept-filter">
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {available_departments.map(d => (
                      <SelectItem key={d.dept_id} value={d.dept_id}>{d.dept_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {stations.length > 1 && (
              <div className="min-w-[180px]">
                <Select value={stationFilter} onValueChange={setStationFilter} data-testid="profile-station-filter">
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Stations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stations</SelectItem>
                    {stations.map(s => (
                      <SelectItem key={s.station_id} value={s.station_id}>{s.station_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Station blocks */}
          {stations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No stations assigned yet</p>
              <p className="text-sm mt-1">Contact your administrator to get stations allocated</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stations.map(st => (
                <StationBlock key={st.station_id} station={st} role={role} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Supervisors tab (RO only) */}
      {activeTab === 'supervisors' && (
        <div className="space-y-3">
          {my_supervisors?.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No supervisors reporting to you yet</p>
              <p className="text-sm mt-1">Supervisors assigned with you as manager will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {my_supervisors?.map(sup => (
                <SupervisorCard key={sup.user_id} sup={sup} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
