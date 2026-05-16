/**
 * StationDashboardHeader
 *
 * Compact "station card" banner shown above the CylinderBar when the user
 * has drilled into a specific station inside Health Explorer.
 *
 * Conveys:
 *   • Station name, code, division, zone
 *   • Big % healthy + total asset count
 *   • Bucket chips (Working / Yellow / Orange / Red)
 *   • Optional shortcut to view Full Inspection History for this station
 */
import { MapPin, Building2, History as HistoryIcon } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function chip(label, n, color, key) {
  return (
    <span key={key} className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: color }} />
      {label} <strong>{n}</strong>
    </span>
  );
}

export default function StationDashboardHeader({ stationCard, summary, zoneName, onOpenHistory }) {
  if (!stationCard) return null;
  const buckets = summary?.buckets || { working: 0, yellow: 0, orange: 0, red: 0 };
  const pct = summary?.pct_healthy ?? 0;
  const color = summary?.color || '#0891b2';
  const total = summary?.total ?? 0;

  return (
    <Card
      className="border-l-4 shadow-sm"
      style={{ borderLeftColor: color, background: `linear-gradient(90deg, ${color}10, transparent 60%)` }}
      data-testid="station-dashboard-header"
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-11 w-11 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: color + '22', color }}
            >
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-slate-800 truncate" data-testid="sdh-name">
                  {stationCard.name}
                </h3>
                {stationCard.code && (
                  <Badge variant="outline" className="text-[10px]" data-testid="sdh-code">
                    {stationCard.code}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                {stationCard.division_name && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {stationCard.division_name}
                  </span>
                )}
                {zoneName && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{zoneName}</span>
                  </>
                )}
                <span className="text-slate-300">·</span>
                <span>{total} asset{total === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              {chip('Working', buckets.working, '#0e7c6b', 'w')}
              {chip('Yellow', buckets.yellow, '#eab308', 'y')}
              {chip('Orange', buckets.orange, '#f97316', 'o')}
              {chip('Red', buckets.red, '#dc2626', 'r')}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold leading-none" style={{ color }} data-testid="sdh-pct">
                {pct}%
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Healthy</div>
            </div>
            {onOpenHistory && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={onOpenHistory}
                data-testid="sdh-full-history"
              >
                <HistoryIcon className="h-3.5 w-3.5" />
                <span className="text-xs">Full History</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
