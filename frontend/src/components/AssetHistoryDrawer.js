import { useState, useEffect } from 'react';
import axios from 'axios';
import { assetsAPI } from '../lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Badge } from './ui/badge';
import { Skeleton } from './ui/skeleton';
import { ScrollArea } from './ui/scroll-area';
import { ClipboardCheck, Calendar, User, FileText, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useLightbox } from './PhotoLightbox';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const WINDOW_OPTIONS = [
  { id: '7', label: '7 days' },
  { id: '15', label: '15 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'fy', label: 'Financial Year' },
  { id: 'all', label: 'All time' },
];

export default function AssetHistoryDrawer({ assetId, assetNumber, open, onOpenChange }) {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [windowDays, setWindowDays] = useState('90');
  const { open: openLightbox, lightbox } = useLightbox();

  useEffect(() => {
    if (open && assetId) {
      loadHistory();
      loadStats(windowDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assetId]);

  useEffect(() => {
    if (open && assetId) loadStats(windowDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

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

  const loadStats = async (w) => {
    try {
      const r = await axios.get(`${BACKEND}/api/orange-list/${assetId}/asset-stats?window_days=${w}`);
      setStats(r.data);
    } catch (e) {
      console.error('Failed to load asset stats', e);
      setStats(null);
    }
  };

  const statusBadge = (status) => {
    const styles = { ok: 'status-working', not_ok: 'status-defective',
                     needs_repair: 'status-pending' };
    return <Badge className={styles[status] || 'bg-muted'}>{status?.replace('_', ' ')}</Badge>;
  };

  const fmt = (h) => h == null ? '—' : `${h} hrs`;
  const TrendIcon = stats?.trend?.delta_pct > 5 ? TrendingUp
                  : stats?.trend?.delta_pct < -5 ? TrendingDown : Minus;
  const trendColor = stats?.trend?.delta_pct > 5 ? 'text-red-600'
                  : stats?.trend?.delta_pct < -5 ? 'text-green-600' : 'text-slate-500';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="asset-history-drawer">
        <SheetHeader>
          <SheetTitle className="text-lg flex items-center justify-between gap-2">
            <span className="truncate">{assetNumber}</span>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              className="text-xs px-2 py-1 rounded border border-slate-300 font-normal"
              data-testid="asset-history-window">
              {WINDOW_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </SheetTitle>
          {stats && (
            <p className="text-xs text-slate-500">
              {stats.asset_type} · {stats.station} · {stats.location}
            </p>
          )}
        </SheetHeader>

        {/* Stats strip */}
        {stats && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="asset-stats-strip">
            <Stat label="Times defective" value={stats.times_defective} />
            <Stat label="Functional %" value={stats.functional_pct == null ? '—' : `${stats.functional_pct}%`}
                  color={stats.functional_pct >= 95 ? 'text-green-600' : stats.functional_pct >= 80 ? 'text-amber-600' : 'text-red-600'} />
            <Stat label="Repairs (n)" value={stats.stats?.n ?? 0} />
            <Stat label="Median repair" value={fmt(stats.stats?.median)} />
            <Stat label="Min" value={fmt(stats.stats?.min)} />
            <Stat label="Max" value={fmt(stats.stats?.max)} />
          </div>
        )}

        {/* ETA + trend */}
        {stats && (stats.eta_hrs != null || stats.trend) && (
          <div className="mt-3 flex items-center justify-between gap-2 px-3 py-2 bg-teal-50 border border-teal-200 rounded-md text-xs">
            {stats.eta_hrs != null && (
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-teal-700">ETA</span>
                <span className="text-slate-700">~{stats.eta_hrs} hrs</span>
                <span className="text-[10px] text-slate-500 italic">
                  ({stats.eta_source === 'asset' ? 'this asset' : 'asset-type @ station'})
                </span>
              </div>
            )}
            {stats.trend && (
              <div className={`flex items-center gap-1 ${trendColor}`}>
                <TrendIcon className="h-3.5 w-3.5" />
                <span className="font-semibold">{Math.abs(stats.trend.delta_pct)}%</span>
                <span className="text-[10px] text-slate-500">vs prior {windowDays}d</span>
              </div>
            )}
          </div>
        )}

        <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-700">Inspection History</h3>

        <ScrollArea className="h-[calc(100vh-360px)]">
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
                          <Badge key={idx} variant={check.status === 'pass' ? 'default' : 'destructive'}
                                 className="text-[10px] px-1.5 py-0">
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
                          <img src={`${process.env.REACT_APP_BACKEND_URL}${url}`} alt=""
                               className="h-full w-full object-cover cursor-zoom-in"
                               onClick={() => openLightbox(insp.items[0].photo_urls, idx)}
                               data-testid={`asset-history-photo-${idx}`} />
                        </div>
                      ))}
                      {insp.items[0].photo_urls.length > 3 && (
                        <div className="h-12 w-12 rounded border flex items-center justify-center bg-muted text-[10px] text-muted-foreground cursor-zoom-in"
                             onClick={() => openLightbox(insp.items[0].photo_urls, 3)}>
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
      {lightbox}
    </Sheet>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="rounded border p-2 bg-white">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${color || 'text-slate-800'}`}>{value}</div>
    </div>
  );
}
