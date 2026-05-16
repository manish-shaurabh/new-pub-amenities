/**
 * InspectionHistoryDrawer — Slide-over sheet showing a station's recent inspections.
 * Opens from the Health Explorer station bar click or Health Tree station row.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';
import { ExternalLink, Loader2, Users, ClipboardCheck } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export default function InspectionHistoryDrawer({ stationId, stationName, open, onOpenChange }) {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !stationId) return;
    setLoading(true);
    setInspections([]);
    axios.get(`${BACKEND}/api/inspections`, {
      params: { station_id: stationId, paginated: true, page: 1, page_size: 30 },
    })
      .then(r => setInspections(r.data?.items || r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, stationId]);

  const defectCount = (insp) =>
    (insp.items || []).filter(i => ['not_ok', 'needs_repair'].includes(i.status)).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
        <SheetHeader className="px-5 py-4 border-b bg-muted/30">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Inspection History
            {stationName && (
              <span className="text-muted-foreground font-normal">— {stationName}</span>
            )}
          </SheetTitle>
          <p className="text-[11px] text-muted-foreground">Last 30 inspections</p>
        </SheetHeader>

        <div className="px-4 py-3 space-y-2">
          {loading && (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!loading && inspections.length === 0 && (
            <div className="py-12 text-center">
              <ClipboardCheck className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No inspections recorded yet</p>
            </div>
          )}

          {!loading && inspections.map(insp => {
            const dc = defectCount(insp);
            return (
              <div
                key={insp._id}
                className="rounded-lg border bg-card px-3 py-2.5 text-sm hover:bg-muted/20 transition"
                data-testid={`insp-drawer-item-${insp._id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant={insp.inspection_type === 'sig' ? 'default' : 'outline'}
                      className="text-[10px] shrink-0"
                    >
                      {insp.inspection_type === 'sig' ? 'SIG' : 'Individual'}
                    </Badge>
                    <span className="font-medium text-xs truncate">{insp.inspector_name || '—'}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {insp.inspection_at
                      ? format(new Date(insp.inspection_at), 'dd MMM yyyy')
                      : '—'}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                  <span>{(insp.items || []).length} assets</span>
                  {insp.inspection_type === 'sig' && (insp.participants || []).length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {(insp.participants || []).length} participants
                    </span>
                  )}
                  {dc > 0 && (
                    <span className="text-destructive font-medium">{dc} defects</span>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3 gap-2"
              onClick={() => {
                navigate(`/inspection-history?station_id=${stationId}`);
                onOpenChange(false);
              }}
              data-testid="view-full-history-btn"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Full History
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
