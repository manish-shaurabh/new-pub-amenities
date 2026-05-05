import { useState, useEffect } from 'react';
import { assetsAPI } from '../lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { ScrollArea } from './ui/scroll-area';
import { ClipboardCheck, Calendar, User, FileText } from 'lucide-react';

export default function AssetHistoryDrawer({ assetId, assetNumber, open, onOpenChange }) {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && assetId) {
      loadHistory();
    }
  }, [open, assetId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await assetsAPI.inspections(assetId, 30);
      setInspections(res.data);
    } catch (e) {
      console.error('Failed to load asset history', e);
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = (status) => {
    const styles = {
      ok: 'status-working',
      not_ok: 'status-defective',
      needs_repair: 'status-pending'
    };
    return <Badge className={styles[status] || 'bg-muted'}>{status?.replace('_', ' ')}</Badge>;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg" data-testid="asset-history-drawer">
        <SheetHeader>
          <SheetTitle className="text-lg">Inspection History: {assetNumber}</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : inspections.length === 0 ? (
            <div className="py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No inspection history</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inspections.map((insp) => (
                <div key={insp._id} className="p-4 border rounded-lg bg-card">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(insp.inspection_at || insp.created_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>{insp.inspector_name}</span>
                        <Badge variant="outline" className="text-[10px] px-1">{insp.inspection_type === 'sig' ? 'SIG' : 'Individual'}</Badge>
                      </div>
                    </div>
                    {insp.items?.[0] && statusBadge(insp.items[0].status)}
                  </div>

                  {insp.items?.[0]?.checklist_responses?.length > 0 && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Checklist</p>
                      <div className="flex flex-wrap gap-1">
                        {insp.items[0].checklist_responses.map((check, idx) => (
                          <Badge
                            key={idx}
                            variant={check.status === 'pass' ? 'default' : 'destructive'}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {check.name}: {check.status}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {insp.items?.[0]?.remarks && (
                    <div className="mt-2 pt-2 border-t">
                      <div className="flex items-start gap-1.5">
                        <FileText className="h-3 w-3 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">{insp.items[0].remarks}</p>
                          {insp.items[0].remarks_by && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">— {insp.items[0].remarks_by}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {insp.items?.[0]?.photo_urls?.length > 0 && (
                    <div className="mt-2 flex gap-1">
                      {insp.items[0].photo_urls.slice(0, 3).map((url, idx) => (
                        <div key={idx} className="h-12 w-12 rounded border overflow-hidden">
                          <img src={`${process.env.REACT_APP_BACKEND_URL}${url}`} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                      {insp.items[0].photo_urls.length > 3 && (
                        <div className="h-12 w-12 rounded border flex items-center justify-center bg-muted text-[10px] text-muted-foreground">
                          +{insp.items[0].photo_urls.length - 3}
                        </div>
                      )}
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
