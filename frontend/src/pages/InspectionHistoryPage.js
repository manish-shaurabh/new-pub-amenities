import { useState, useEffect } from 'react';
import { inspectionsAPI, stationsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ClipboardCheck, Users, Calendar } from 'lucide-react';

export default function InspectionHistoryPage() {
  const [inspections, setInspections] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStation, setFilterStation] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedInspection, setSelectedInspection] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [inspRes, stationsRes] = await Promise.all([
        inspectionsAPI.list({ limit: 100 }),
        stationsAPI.list()
      ]);
      setInspections(inspRes.data);
      setStations(stationsRes.data);
    } catch (e) {
      console.error('Failed to load', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = inspections.filter(i => {
    const matchStation = !filterStation || filterStation === 'all' || i.station_id === filterStation;
    const matchType = !filterType || filterType === 'all' || i.inspection_type === filterType;
    return matchStation && matchType;
  });

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inspection History</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} inspections</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filterStation} onValueChange={setFilterStation}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Stations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="sig">SIG</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No inspections found</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map(insp => (
            <Card key={insp._id} className="cursor-pointer table-row-hover" onClick={() => setSelectedInspection(insp)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center text-xs font-medium ${
                      insp.inspection_type === 'sig' ? 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]' : 'bg-primary/10 text-primary'
                    }`}>
                      {insp.inspection_type === 'sig' ? <Users className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{insp.station_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {insp.inspector_name} &middot; {insp.items?.length || 0} assets &middot; {new Date(insp.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={insp.inspection_type === 'sig' ? 'default' : 'secondary'}>
                      {insp.inspection_type === 'sig' ? 'SIG' : 'Individual'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedInspection} onOpenChange={(open) => !open && setSelectedInspection(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inspection Details</DialogTitle>
          </DialogHeader>
          {selectedInspection && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Station</p>
                  <p className="text-sm font-medium">{selectedInspection.station_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <Badge>{selectedInspection.inspection_type === 'sig' ? 'SIG' : 'Individual'}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Inspector</p>
                  <p className="text-sm font-medium">{selectedInspection.inspector_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-sm font-medium">{new Date(selectedInspection.created_at).toLocaleString()}</p>
                </div>
              </div>

              {selectedInspection.participants?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">SIG Participants</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedInspection.participants.map((p, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{p.name} ({p.role})</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs text-muted-foreground mb-2">Inspected Assets ({selectedInspection.items?.length || 0})</p>
                <div className="space-y-2">
                  {selectedInspection.items?.map((item, i) => (
                    <div key={i} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{item.asset_id?.substring(0, 8)}...</p>
                        <Badge className={
                          item.status === 'ok' ? 'status-working' :
                          item.status === 'not_ok' ? 'status-defective' : 'status-pending'
                        }>
                          {item.status?.replace('_', ' ')}
                        </Badge>
                      </div>
                      {item.remarks && <p className="text-xs text-muted-foreground mt-1">{item.remarks}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {selectedInspection.overall_remarks && (
                <div>
                  <p className="text-xs text-muted-foreground">Overall Remarks</p>
                  <p className="text-sm mt-1">{selectedInspection.overall_remarks}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
