/**
 * HealthTree — Expandable Zone → Division → Station hierarchy with inline health bars.
 * Station rows open the InspectionHistoryDrawer on click.
 */
import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { ChevronRight, ChevronDown, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import InspectionHistoryDrawer from './InspectionHistoryDrawer';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function healthColor(pct) {
  if (pct === 100) return '#059669';
  if (pct >= 90) return '#0891b2';
  if (pct >= 70) return '#f59e0b';
  return '#dc2626';
}

function HealthBar({ pct, width = 80 }) {
  const color = healthColor(pct);
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="rounded-full bg-muted overflow-hidden" style={{ width, height: 6 }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color, minWidth: 32 }}>
        {pct}%
      </span>
    </div>
  );
}

function DefectBadge({ defects }) {
  if (!defects) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-destructive">
      <AlertTriangle className="h-2.5 w-2.5" /> {defects}
    </span>
  );
}

export default function HealthTree({ userId, scopeZoneId, scopeDivisionId }) {
  const [stationHealth, setStationHealth] = useState([]);
  const [zones, setZones] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedZones, setExpandedZones] = useState({});
  const [expandedDivs, setExpandedDivs] = useState({});
  const [historyStation, setHistoryStation] = useState(null);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [healthRes, zonesRes, divsRes] = await Promise.all([
        axios.get(`${BACKEND}/api/dashboard/health-explorer/${userId}?mode=station`),
        axios.get(`${BACKEND}/api/zones`),
        axios.get(`${BACKEND}/api/divisions`),
      ]);
      setStationHealth(healthRes.data?.rows || []);
      setZones(zonesRes.data || []);
      setDivisions(divsRes.data || []);
      // Auto-expand first zone/division
      const zs = zonesRes.data || [];
      const ds = divsRes.data || [];
      if (zs.length > 0) {
        const firstExpZones = {};
        firstExpZones[zs[0]._id] = true;
        setExpandedZones(firstExpZones);
        const firstDivs = ds.filter(d => d.zone_id === zs[0]._id);
        if (firstDivs.length > 0) {
          const firstExpDivs = {};
          firstExpDivs[firstDivs[0]._id] = true;
          setExpandedDivs(firstExpDivs);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [userId]); // eslint-disable-line

  // Build tree with scoping
  const tree = useMemo(() => {
    const stationHealthMap = {};
    stationHealth.forEach(s => { stationHealthMap[s.id] = s; });

    const visibleZones = scopeZoneId ? zones.filter(z => z._id === scopeZoneId) : zones;

    return visibleZones.map(zone => {
      const zoneDivs = divisions.filter(d => d.zone_id === zone._id);
      const visibleDivs = scopeDivisionId ? zoneDivs.filter(d => d._id === scopeDivisionId) : zoneDivs;

      const divRows = visibleDivs.map(div => {
        const divStns = (div.assigned_stations || []).map(sid => {
          const h = stationHealthMap[sid];
          return h ? { id: sid, name: h.label, pct: h.value, n: h.n, defects: 0 }
                   : { id: sid, name: sid, pct: 100, n: 0, defects: 0 };
        });
        const total = divStns.reduce((a, s) => a + s.n, 0);
        const healthy = divStns.reduce((a, s) => a + Math.round((s.pct / 100) * s.n), 0);
        const pct = total > 0 ? Math.round((healthy / total) * 100) : 100;
        const defects = divStns.reduce((a, s) => {
          const h = stationHealthMap[s.id];
          if (h?.buckets) return a + (h.buckets.orange || 0) + (h.buckets.red || 0);
          return a;
        }, 0);
        return { ...div, pct, stations: divStns, total, defects };
      });

      const zoneTot = divRows.reduce((a, d) => a + d.total, 0);
      const zoneHealthy = divRows.reduce((a, d) => a + Math.round((d.pct / 100) * d.total), 0);
      const zonePct = zoneTot > 0 ? Math.round((zoneHealthy / zoneTot) * 100) : 100;
      const zoneDefects = divRows.reduce((a, d) => a + d.defects, 0);

      return { ...zone, pct: zonePct, divisions: divRows, total: zoneTot, defects: zoneDefects };
    });
  }, [zones, divisions, stationHealth, scopeZoneId, scopeDivisionId]);

  if (loading) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No Zone/Division data configured. Add Zones and Divisions in the Admin Panel.
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="health-tree">
      <div className="flex justify-end mb-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={load}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {tree.map(zone => (
        <div key={zone._id} className="rounded-lg border overflow-hidden">
          {/* Zone row */}
          <button
            onClick={() => setExpandedZones(e => ({ ...e, [zone._id]: !e[zone._id] }))}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition text-left"
            data-testid={`zone-row-${zone._id}`}
          >
            {expandedZones[zone._id]
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <span className="font-semibold text-sm flex-1 text-left">{zone.name}</span>
            {zone.code && <Badge variant="outline" className="text-[10px]">{zone.code}</Badge>}
            <DefectBadge defects={zone.defects} />
            <span className="text-[11px] text-muted-foreground mr-2">{zone.total} assets</span>
            <HealthBar pct={Math.round(zone.pct)} width={70} />
          </button>

          {/* Divisions */}
          {expandedZones[zone._id] && (
            <div className="divide-y divide-border/50">
              {zone.divisions.length === 0 && (
                <p className="text-xs text-muted-foreground px-6 py-2 italic">No divisions in this zone</p>
              )}
              {zone.divisions.map(div => (
                <div key={div._id}>
                  {/* Division row */}
                  <button
                    onClick={() => setExpandedDivs(e => ({ ...e, [div._id]: !e[div._id] }))}
                    className="w-full flex items-center gap-2 px-5 py-2 hover:bg-muted/30 transition text-left"
                    data-testid={`div-row-${div._id}`}
                  >
                    {expandedDivs[div._id]
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="text-sm flex-1 font-medium">{div.name}</span>
                    {div.code && <Badge variant="secondary" className="text-[10px]">{div.code}</Badge>}
                    <DefectBadge defects={div.defects} />
                    <span className="text-[11px] text-muted-foreground mr-2">{div.total} assets</span>
                    <HealthBar pct={Math.round(div.pct)} width={60} />
                  </button>

                  {/* Stations */}
                  {expandedDivs[div._id] && (
                    <div className="bg-muted/10">
                      {div.stations.length === 0 && (
                        <p className="text-xs text-muted-foreground px-10 py-2 italic">No stations assigned</p>
                      )}
                      {div.stations.map(stn => {
                        const h = stationHealth.find(s => s.id === stn.id);
                        const stnDefects = h?.buckets
                          ? (h.buckets.orange || 0) + (h.buckets.red || 0)
                          : 0;
                        return (
                          <button
                            key={stn.id}
                            onClick={() => setHistoryStation({ id: stn.id, name: stn.name })}
                            className="w-full flex items-center gap-2 px-8 py-1.5 hover:bg-primary/5 transition text-left group"
                            data-testid={`stn-row-${stn.id}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: healthColor(Math.round(stn.pct)) }} />
                            <span className="text-xs flex-1 group-hover:text-primary transition">{stn.name}</span>
                            <DefectBadge defects={stnDefects} />
                            <span className="text-[10px] text-muted-foreground mr-2">{stn.n} assets</span>
                            <HealthBar pct={Math.round(stn.pct)} width={50} />
                            <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <InspectionHistoryDrawer
        stationId={historyStation?.id}
        stationName={historyStation?.name}
        open={!!historyStation}
        onOpenChange={o => !o && setHistoryStation(null)}
      />
    </div>
  );
}
