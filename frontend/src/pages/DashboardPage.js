import { useState, useEffect } from 'react';
import { dashboardAPI, orangeListAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Box, AlertTriangle, ClipboardCheck, Calendar, Users, Building2, Clock, ShieldAlert } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentInspections, setRecentInspections] = useState([]);
  const [orangeItems, setOrangeItems] = useState([]);
  const [stationHealth, setStationHealth] = useState([]);
  const [assetTypeHealth, setAssetTypeHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [statsRes, inspRes, orangeRes, stationRes, atRes] = await Promise.all([
        dashboardAPI.stats(),
        dashboardAPI.recentInspections(5),
        orangeListAPI.list({}),
        fetch(`${API_BASE}/api/dashboard/station-health`).then(r => r.json()),
        fetch(`${API_BASE}/api/dashboard/asset-type-health`).then(r => r.json())
      ]);
      setStats(statsRes.data);
      setRecentInspections(inspRes.data);
      setOrangeItems(orangeRes.data.slice(0, 5));
      setStationHealth(stationRes);
      setAssetTypeHealth(atRes);
    } catch (e) {
      console.error('Failed to load dashboard', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}
    </div>;
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

  const CHART_COLORS = ['#0e7c6b', '#2185a0', '#d4973b', '#e85d3a', '#5a6b80'];

  // Pie chart data for overall health
  const healthPieData = [
    { name: 'Working', value: stats?.working_assets || 0 },
    { name: 'Orange List', value: stats?.orange_list_count || 0 },
    { name: 'Red List', value: stats?.red_list_count || 0 },
    { name: 'Pending', value: stats?.pending_approvals || 0 },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ['#0e7c6b', '#f97316', '#dc2626', '#d4973b'];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-muted-foreground text-sm mt-1">Railway Asset Inspection - Overview Dashboard</p>
      </div>

      {/* KPI Grid */}
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

      {/* Charts Row - Change 6 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Station-wise Health Bar Chart */}
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
                  <Bar dataKey="working" stackId="a" fill="#0e7c6b" name="Working" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="defective" stackId="a" fill="#e85d3a" name="Defective" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No station data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Overall Health Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Overall Asset Health</CardTitle>
          </CardHeader>
          <CardContent>
            {healthPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={healthPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {healthPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Asset Type Health */}
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
                <Bar dataKey="working" stackId="a" fill="#0e7c6b" name="Working" />
                <Bar dataKey="defective" stackId="a" fill="#e85d3a" name="Defective" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent + Orange/Red */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Recent Inspections */}
        <div className="xl:col-span-7">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Recent Inspections
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentInspections.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No inspections yet</p>
              ) : (
                <div className="space-y-3">
                  {recentInspections.map((insp) => (
                    <div key={insp._id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-medium ${
                          insp.inspection_type === 'sig' ? 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]' : 'bg-primary/10 text-primary'
                        }`}>
                          {insp.inspection_type === 'sig' ? 'SIG' : 'IND'}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{insp.station_name}</p>
                          <p className="text-xs text-muted-foreground">{insp.inspector_name} &middot; {new Date(insp.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {insp.items?.length || 0} items
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Orange/Red List Summary */}
        <div className="xl:col-span-5">
          <Card className="border-l-4 border-l-[hsl(var(--orange-list))]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--orange-list))]" />
                Orange/Red List (Active)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {orangeItems.length === 0 ? (
                <div className="text-center py-8">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No defective assets.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orangeItems.map((item) => (
                    <div key={item._id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-medium">{item.asset_info?.asset_number || 'Unknown'}</p>
                          {item.list_type === 'red' && (
                            <Badge className="bg-red-600 text-white border-0 text-[9px] px-1">RED</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {item.asset_info?.station_name} &middot; {item.asset_info?.location_name}
                        </p>
                      </div>
                      <Badge className={item.list_type === 'red' ? 'bg-red-100 text-red-700 border-red-200' : 'status-defective'}>
                        {item.hours_defective > 24 
                          ? `${Math.floor(item.hours_defective / 24)}d`
                          : `${Math.round(item.hours_defective)}h`
                        }
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
