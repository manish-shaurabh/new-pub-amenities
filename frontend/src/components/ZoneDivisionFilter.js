/**
 * ZoneDivisionFilter — Reusable cascading Zone → Division → Station filter.
 * 
 * Props:
 *   value:        { zoneId, divisionId, stationId }
 *   onChange:     (newValue) => void
 *   showStation:  bool (default false)
 *   compact:      bool — h-7 size variant
 */
import { useState, useEffect } from 'react';
import { zonesAPI, divisionsAPI, stationsAPI } from '../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export default function ZoneDivisionFilter({
  value = {},
  onChange,
  showStation = false,
  compact = false,
}) {
  const [zones, setZones] = useState([]);
  const [allDivisions, setAllDivisions] = useState([]);
  const [allStations, setAllStations] = useState([]);

  useEffect(() => {
    zonesAPI.list().then(r => setZones(r.data || [])).catch(() => {});
    divisionsAPI.list().then(r => setAllDivisions(r.data || [])).catch(() => {});
    if (showStation) {
      stationsAPI.list().then(r => setAllStations(r.data || [])).catch(() => {});
    }
  }, [showStation]);

  const filteredDivisions = value.zoneId
    ? allDivisions.filter(d => d.zone_id === value.zoneId)
    : allDivisions;

  const filteredStations = value.divisionId
    ? allStations.filter(s => {
        const div = allDivisions.find(d => d._id === value.divisionId);
        return div?.assigned_stations?.includes(s._id);
      })
    : value.zoneId
    ? allStations.filter(s =>
        filteredDivisions.some(d => d.assigned_stations?.includes(s._id))
      )
    : allStations;

  const h = compact ? 'h-7 text-[11px]' : 'h-8 text-xs';

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="zone-division-filter">
      <Select
        value={value.zoneId || 'all'}
        onValueChange={v => onChange({ zoneId: v === 'all' ? '' : v, divisionId: '', stationId: '' })}
      >
        <SelectTrigger className={`w-[140px] ${h}`} data-testid="zone-select">
          <SelectValue placeholder="All Zones" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Zones</SelectItem>
          {zones.map(z => (
            <SelectItem key={z._id} value={z._id}>{z.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.divisionId || 'all'}
        onValueChange={v => onChange({ ...value, divisionId: v === 'all' ? '' : v, stationId: '' })}
      >
        <SelectTrigger className={`w-[150px] ${h}`} data-testid="division-select">
          <SelectValue placeholder="All Divisions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Divisions</SelectItem>
          {filteredDivisions.map(d => (
            <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showStation && (
        <Select
          value={value.stationId || 'all'}
          onValueChange={v => onChange({ ...value, stationId: v === 'all' ? '' : v })}
        >
          <SelectTrigger className={`w-[160px] ${h}`} data-testid="station-select">
            <SelectValue placeholder="All Stations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {filteredStations.map(s => (
              <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
