import { useState, useEffect } from 'react';
import { dashboardAPI, orangeListAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Box, AlertTriangle, ClipboardCheck, Calendar, Users, Building2, TrendingUp, Clock } from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentInspections, setRecentInspections] = useState([]);
  const [orangeItems, setOrangeItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, inspRes, orangeRes] = await Promise.all([
        dashboardAPI.stats(),
        dashboardAPI.recentInspections(5),
        orangeListAPI.list({})
      ]);
      setStats(statsRes.data);
      setRecentInspections(inspRes.data);
      setOrangeItems(orangeRes.data.slice(0, 5));
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
    { label: 'Defective', value: stats?.defective_assets || 0, icon: AlertTriangle, color: 'text-[hsl(var(--orange-list))]' },
    { label: 'Orange List', value: stats?.orange_list_count || 0, icon: AlertTriangle, color: 'text-[hsl(var(--overdue))]' },
    { label: 'Pending Approvals', value: stats?.pending_approvals || 0, icon: Clock, color: 'text-[hsl(var(--pending))]' },
    { label: 'Total Inspections', value: stats?.total_inspections || 0, icon: ClipboardCheck, color: 'text-[hsl(var(--info))]' },
    { label: 'Overdue', value: stats?.overdue_count || 0, icon: Calendar, color: 'text-destructive' },
    { label: 'Stations', value: stats?.total_stations || 0, icon: Building2, color: 'text-muted-foreground' },
    { label: 'Users', value: stats?.total_users || 0, icon: Users, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-muted-foreground text-sm mt-1">Here's an overview of your railway asset inspection system</p>
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

      {/* Main content grid */}
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

        {/* Orange List Summary */}
        <div className="xl:col-span-5">
          <Card className="border-l-4 border-l-[hsl(var(--orange-list))]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--orange-list))]" />
                Orange List (Active)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {orangeItems.length === 0 ? (
                <div className="text-center py-8" data-testid="orange-list-empty-state">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No defective assets right now.</p>
                  <p className="text-xs text-muted-foreground">Keep inspections consistent!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orangeItems.map((item) => (
                    <div key={item._id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{item.asset_info?.asset_number || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.asset_info?.station_name} &middot; {item.asset_info?.location_name}
                        </p>
                      </div>
                      <Badge className={item.status === 'pending_approval' ? 'status-pending' : 'status-defective'}>
                        {item.status === 'pending_approval' ? 'Pending' : 'Defective'}
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
