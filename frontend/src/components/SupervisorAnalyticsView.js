/**
 * SupervisorAnalyticsView — reusable performance analytics panel.
 * Shown in:
 *   - SUP's own "My Performance" tab
 *   - ASUP/RO drill-down from comparison table
 *   - Admin "Performance Analytics" inline panel
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { analyticsAPI } from '../lib/api';
import { errString } from '../lib/err';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { toast } from 'sonner';
import { BarChart3, ChevronDown, RefreshCw, AlertTriangle, CheckCircle, Wrench, Star, Layers, Building2 } from 'lucide-react';

const fmt = (h) => {
  if (h === 0) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
};

const toDateInput = (d) => d.toISOString().slice(0, 10);

export default function SupervisorAnalyticsView({ supervisorId, compact = false }) {
  const now = new Date();
  const [fromDate, setFromDate] = useState(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toDateInput(now));
  const [stationId, setStationId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupBy, setGroupBy] = useState('type'); // 'type' | 'station'

  const load = useCallback(async (isRefresh = false) => {
    if (!supervisorId) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await analyticsAPI.supervisorPerformance(supervisorId, {
        fromDate, toDate,
        stationId: stationId || undefined,
        locationId: locationId || undefined,
      });
      setData(res.data);
    } catch (e) {
      toast.error(errString(e, 'Failed to load analytics'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supervisorId, fromDate, toDate, stationId, locationId]);

  useEffect(() => { load(); }, [load]);

  const handleApply = () => load(true);

  // Compute derived data BEFORE early returns to satisfy rules of hooks
  const rawCategories = data?.categories || [];
  const availableStations = data?.available_stations || [];
  const availableLocations = data?.available_locations || [];
  const showGroupToggle = availableStations.length > 1;

  // Optionally re-group: by station → contains the original type-categories filtered to that station
  const categories = useMemo(() => {
    if (groupBy !== 'station' || !showGroupToggle) return rawCategories;
    const byStation = {};
    for (const cat of rawCategories) {
      for (const asset of cat.assets) {
        const sName = asset.station_name || 'Unknown station';
        if (!byStation[sName]) {
          byStation[sName] = { asset_type_id: `station-${sName}`, asset_type_name: sName, assets: [], _types: {} };
        }
        byStation[sName].assets.push(asset);
        const tBucket = byStation[sName]._types[cat.asset_type_id] || (byStation[sName]._types[cat.asset_type_id] = []);
        tBucket.push(asset);
      }
    }
    return Object.values(byStation).map(grp => {
      const a = grp.assets;
      const repairs = a.map(x => x.avg_repair_seconds).filter(v => v > 0);
      const avg = repairs.length ? Math.round(repairs.reduce((s, v) => s + v, 0) / repairs.length) : 0;
      const pct = a.length ? +(a.reduce((s, x) => s + x.pct_functional, 0) / a.length).toFixed(2) : 100;
      return {
        asset_type_id: grp.asset_type_id,
        asset_type_name: grp.asset_type_name,
        asset_count: a.length,
        defect_count: a.reduce((s, x) => s + x.defect_count, 0),
        avg_repair_seconds: avg,
        avg_repair_hours: +(avg / 3600).toFixed(2),
        pct_functional: pct,
        rejection_count: a.reduce((s, x) => s + x.rejection_count, 0),
        assets: a,
      };
    }).sort((x, y) => x.asset_type_name.localeCompare(y.asset_type_name));
  }, [rawCategories, groupBy, showGroupToggle]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary;
  const overallZeroDefect = summary.total_defects === 0 && summary.total_assets > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      {!compact && (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5">
              {overallZeroDefect && <Star className="h-4 w-4 text-amber-500 fill-amber-400" />}
              <p className="text-sm font-semibold">{data.user_name}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.employee_id} &middot; {data.department_name || 'Unknown dept'}
              {overallZeroDefect && <span className="ml-2 text-emerald-600">· Zero defects in this period</span>}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            className="h-7 text-xs"
            data-testid="analytics-refresh"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-end gap-3 flex-wrap p-3 bg-muted/30 rounded-lg">
        <div>
          <Label className="text-xs mb-1">From</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="h-8 text-xs w-[140px]"
            data-testid="analytics-from-date"
          />
        </div>
        <div>
          <Label className="text-xs mb-1">To</Label>
          <Input
            type="date"
            value={toDate}
            max={toDateInput(now)}
            onChange={e => setToDate(e.target.value)}
            className="h-8 text-xs w-[140px]"
            data-testid="analytics-to-date"
          />
        </div>
        {availableStations.length > 1 && (
          <div>
            <Label className="text-xs mb-1">Station</Label>
            <Select value={stationId || 'all'} onValueChange={v => setStationId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="analytics-station-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stations</SelectItem>
                {availableStations.map(s => (
                  <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {availableLocations.length > 1 && (
          <div>
            <Label className="text-xs mb-1">Location</Label>
            <Select value={locationId || 'all'} onValueChange={v => setLocationId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="analytics-location-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {availableLocations.map(l => (
                  <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button size="sm" className="h-8 text-xs" onClick={handleApply} disabled={refreshing} data-testid="analytics-apply">
          Apply
        </Button>
        {showGroupToggle && (
          <div className="ml-auto flex items-center gap-1 bg-background rounded-md border p-0.5">
            <button
              onClick={() => setGroupBy('type')}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${groupBy === 'type' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              data-testid="analytics-group-type"
            >
              <Layers className="h-3 w-3" /> By Type
            </button>
            <button
              onClick={() => setGroupBy('station')}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${groupBy === 'station' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              data-testid="analytics-group-station"
            >
              <Building2 className="h-3 w-3" /> By Station
            </button>
          </div>
        )}
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Defects</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]" data-testid="summary-total-defects">
              {summary.total_defects}
            </p>
            <p className="text-[10px] text-muted-foreground">resolved in period</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg Repair Time</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]" data-testid="summary-avg-repair">
              {fmt(summary.avg_repair_hours)}
            </p>
            <p className="text-[10px] text-muted-foreground">per defect (Option A)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">% Functional</p>
            <p className={`text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk] ${
              summary.pct_functional >= 95 ? 'text-emerald-600' :
              summary.pct_functional >= 85 ? 'text-orange-500' : 'text-red-600'
            }`} data-testid="summary-pct-functional">
              {summary.pct_functional}%
            </p>
            <p className="text-[10px] text-muted-foreground">across {summary.total_assets} assets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ASUP Rejections</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 font-[Space_Grotesk]" data-testid="summary-rejections">
              {summary.rejection_count}
            </p>
            <p className="text-[10px] text-muted-foreground">claims rejected</p>
          </CardContent>
        </Card>
      </div>

      {/* Categories */}
      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-8 w-8 text-emerald-500/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No resolved defects in this period</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="analytics-categories">
          {categories.map(cat => (
            <Card key={cat.asset_type_id} className="overflow-hidden">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                    data-testid={`category-row-${cat.asset_type_id}`}
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{cat.asset_type_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{cat.asset_count} assets</Badge>
                      {cat.defect_count > 0 && (
                        <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px]">
                          {cat.defect_count} defects
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-xs mr-2">
                      <div className="text-right">
                        <p className="text-muted-foreground">Avg Repair</p>
                        <p className="font-semibold tabular-nums">{fmt(cat.avg_repair_hours)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">% Up</p>
                        <p className={`font-semibold tabular-nums ${
                          cat.pct_functional >= 95 ? 'text-emerald-600' :
                          cat.pct_functional >= 85 ? 'text-orange-500' : 'text-red-600'
                        }`}>{cat.pct_functional}%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">Rejections</p>
                        <p className="font-semibold tabular-nums">{cat.rejection_count}</p>
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    {cat.assets.map(a => (
                      <div
                        key={a.asset_id}
                        className="flex items-center justify-between px-4 py-2.5 border-b last:border-0 hover:bg-muted/20"
                        data-testid={`asset-row-${a.asset_id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-7 w-7 rounded-md flex items-center justify-center bg-muted flex-shrink-0">
                            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{a.asset_number}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {a.station_name}{a.location_name ? ` · ${a.location_name}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-5 text-xs flex-shrink-0">
                          <div className="text-right">
                            <p className="text-muted-foreground">Defects</p>
                            <p className="font-semibold tabular-nums">{a.defect_count}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Avg Repair</p>
                            <p className="font-semibold tabular-nums">{fmt(a.avg_repair_hours)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">% Up</p>
                            <p className={`font-semibold tabular-nums ${
                              a.pct_functional >= 95 ? 'text-emerald-600' :
                              a.pct_functional >= 85 ? 'text-orange-500' : 'text-red-600'
                            }`}>{a.pct_functional}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Rej.</p>
                            <p className="font-semibold tabular-nums">{a.rejection_count}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
