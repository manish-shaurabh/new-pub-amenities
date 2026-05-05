import { useState, useEffect } from 'react';
import { usersAPI } from '../lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { ScrollArea } from './ui/scroll-area';
import { ClipboardCheck, Calendar, MapPin, Users } from 'lucide-react';

export default function SupervisorHistoryDrawer({ supervisorId, supervisorName, open, onOpenChange }) {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && supervisorId) {
      loadHistory();
    }
  }, [open, supervisorId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await usersAPI.inspections(supervisorId, 30);
      setInspections(res.data);
    } catch (e) {
      console.error('Failed to load supervisor history', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg" data-testid="supervisor-history-drawer">
        <SheetHeader>
          <SheetTitle className="text-lg">Inspection History: {supervisorName}</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : inspections.length === 0 ? (
            <div className="py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No inspection history</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inspections.map((insp) => (
                <div key={insp._id} className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{insp.station_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(insp.inspection_at || insp.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <Badge variant={insp.inspection_type === 'sig' ? 'default' : 'secondary'} className="text-[10px]">
                      {insp.inspection_type === 'sig' ? 'SIG' : 'Individual'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{insp.items?.length || 0} assets inspected</span>
                  </div>

                  {insp.inspection_type === 'sig' && insp.participants?.length > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <div className="flex flex-wrap gap-1">
                        {insp.participants.slice(0, 2).map((p, idx) => (
                          <Badge key={idx} variant="outline" className="text-[10px] px-1">{p.name}</Badge>
                        ))}
                        {insp.participants.length > 2 && (
                          <Badge variant="outline" className="text-[10px] px-1">+{insp.participants.length - 2}</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
