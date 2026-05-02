import { useState, useEffect } from 'react';
import { schedulesAPI, stationsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Calendar, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

export default function SchedulesPage() {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [dueToday, setDueToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('due');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [schedRes, dueRes] = await Promise.all([
        schedulesAPI.list(false),
        schedulesAPI.dueToday(user?._id)
      ]);
      setSchedules(schedRes.data);
      setDueToday(dueRes.data);
    } catch (e) {
      console.error('Failed to load schedules', e);
    } finally {
      setLoading(false);
    }
  };

  const overdueSchedules = schedules.filter(s => s.is_overdue);
  const upcomingSchedules = schedules.filter(s => !s.is_overdue);

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  const ScheduleCard = ({ schedule, isOverdue }) => (
    <Card className={isOverdue ? 'orange-stripe' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">{schedule.asset_info?.asset_number || 'Unknown'}</p>
            <p className="text-xs text-muted-foreground">
              {schedule.asset_info?.asset_type_name} &middot; {schedule.asset_info?.station_name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{schedule.frequency}</Badge>
            {isOverdue ? (
              <Badge className="status-defective">Overdue</Badge>
            ) : (
              <Badge className="status-working">On Track</Badge>
            )}
          </div>
        </div>
        {schedule.next_due && (
          <p className="text-xs text-muted-foreground mt-1">
            Due: {new Date(schedule.next_due).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
        <p className="text-sm text-muted-foreground">Inspection schedules and overdue tracking</p>
      </div>

      {/* Due Today Summary */}
      {dueToday.length > 0 && (
        <Card className="border-l-4 border-l-[hsl(var(--pending))]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-[hsl(var(--pending))]" />
              Due Today ({dueToday.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dueToday.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-sm">{item.asset_info?.asset_number} - {item.asset_info?.station_name}</span>
                  <Badge variant="outline" className="text-xs">{item.frequency}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="due">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Overdue ({overdueSchedules.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            <Calendar className="h-4 w-4 mr-1" />
            Upcoming ({upcomingSchedules.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="space-y-2 mt-4">
          {overdueSchedules.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 text-[hsl(var(--ok))]/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No overdue inspections!</p>
              </CardContent>
            </Card>
          ) : (
            overdueSchedules.map((s, i) => <ScheduleCard key={i} schedule={s} isOverdue={true} />)
          )}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-2 mt-4">
          {upcomingSchedules.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No scheduled inspections</p>
              </CardContent>
            </Card>
          ) : (
            upcomingSchedules.map((s, i) => <ScheduleCard key={i} schedule={s} isOverdue={false} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
