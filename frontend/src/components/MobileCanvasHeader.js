/**
 * MobileCanvasHeader — compact, collapsible header for the Platform Vision
 * canvas (used on both StationCanvasPage and InspectionPage).
 *
 * On all viewports it shows a single-row condensed bar:
 *   [📍 Station ▾] [active location ▾] [🔍 filters dot] [⋯ menu]
 *
 * Tapping the location button opens a popover with the full location list +
 * inline search. Tapping the menu opens a dropdown with department/asset-type
 * filters, refresh, PDF, and (when allowed) Edit Canvas.
 */
import { useMemo, useState } from 'react';
import { MapPin, ChevronDown, Search, MoreVertical, RefreshCw, Download, Pencil, X, Filter, CheckCircle2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

export default function MobileCanvasHeader({
  // Station
  stations = [],
  selectedStation,
  onStationChange,
  // Locations
  locations = [],
  selectedLocation,
  onLocationChange,
  onAddLocation,
  // Filters
  departments = [],
  assetTypes = [],
  filterDept = '',
  filterType = '',
  onFilterDeptChange,
  onFilterTypeChange,
  // Actions
  onRefresh,
  onDownloadPDF,
  // Edit mode
  canEdit = false,
  editMode = false,
  onToggleEditMode,
  loading = false,
  // Labelling
  title = 'Platform Vision',
}) {
  const [locOpen, setLocOpen] = useState(false);
  const [locSearch, setLocSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const activeLocationName = useMemo(() => {
    const l = locations.find(x => (x.id || x._id) === selectedLocation);
    return l?.name || 'Select location';
  }, [locations, selectedLocation]);

  const filteredLocs = useMemo(() => {
    const q = locSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(l => (l.name || '').toLowerCase().includes(q));
  }, [locations, locSearch]);

  const hasActiveFilters = !!(filterDept || filterType);

  return (
    <div
      style={{
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '8px 12px',
        position: 'sticky', top: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap',
      }}
      data-testid="mobile-canvas-header"
    >
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <MapPin size={15} color="#0891b2" />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }} className="hidden sm:inline">{title}</span>
        {editMode && <Badge style={{ fontSize: 9, background: '#fef3c7', color: '#a16207', border: '1px solid #fde68a' }}>EDIT</Badge>}
      </div>

      {/* Station select (compact) */}
      {stations.length > 1 && (
        <Select value={selectedStation || ''} onValueChange={onStationChange}>
          <SelectTrigger className="h-8 text-xs w-[110px] sm:w-[150px]" data-testid="mch-station-select">
            <SelectValue placeholder="Station" />
          </SelectTrigger>
          <SelectContent>
            {stations.map(s => (
              <SelectItem key={s.id || s._id} value={s.id || s._id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Location popover (the BIG win — replaces 13 chips) */}
      {locations.length > 0 && (
        <Popover open={locOpen} onOpenChange={setLocOpen}>
          <PopoverTrigger asChild>
            <button
              data-testid="mch-location-trigger"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', height: 32,
                borderRadius: 16, border: '1.5px solid #0891b2',
                background: '#e0f2fe', color: '#0891b2',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                maxWidth: 220, overflow: 'hidden',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeLocationName}
              </span>
              <ChevronDown size={13} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] p-0" data-testid="mch-location-popover">
            <div className="p-2 border-b">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={locSearch}
                  onChange={(e) => setLocSearch(e.target.value)}
                  placeholder="Search locations…"
                  className="pl-7 h-7 text-xs"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1">
              {filteredLocs.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center">No locations match</div>
              )}
              {filteredLocs.map(loc => {
                const lid = loc.id || loc._id;
                const active = selectedLocation === lid;
                return (
                  <button
                    key={lid}
                    onClick={() => { onLocationChange?.(lid); setLocOpen(false); setLocSearch(''); }}
                    data-testid={`mch-location-option-${lid}`}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between gap-2 ${
                      active ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <span className="truncate flex-1">{loc.name}</span>
                    {active && <CheckCircle2 size={12} />}
                  </button>
                );
              })}
              {editMode && onAddLocation && (
                <button
                  onClick={() => { setLocOpen(false); onAddLocation(); }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs text-primary border-t mt-1 pt-2 hover:bg-muted"
                >
                  + Add new location…
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <div style={{ flex: 1 }} />

      {/* Filter pill — opens filter popover */}
      {!editMode && (departments.length > 0 || assetTypes.length > 0) && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-testid="mch-filter-trigger"
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', height: 32, borderRadius: 8,
                border: '1px solid #e2e8f0', background: hasActiveFilters ? '#e0f2fe' : '#fff',
                color: hasActiveFilters ? '#0891b2' : '#64748b',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              <Filter size={12} />
              <span className="hidden sm:inline">Filter</span>
              {hasActiveFilters && (
                <span style={{
                  position: 'absolute', top: -3, right: -3,
                  width: 8, height: 8, borderRadius: '50%', background: '#0891b2',
                }} />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[240px] p-3 space-y-2.5" data-testid="mch-filter-popover">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Department</label>
              <Select value={filterDept || '__all__'} onValueChange={v => onFilterDeptChange?.(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Departments</SelectItem>
                  {departments.map(d => <SelectItem key={d.id || d._id} value={d.id || d._id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Asset Type</label>
              <Select value={filterType || '__all__'} onValueChange={v => onFilterTypeChange?.(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Types</SelectItem>
                  {assetTypes.map(t => <SelectItem key={t.id || t._id} value={t.id || t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => { onFilterDeptChange?.(''); onFilterTypeChange?.(''); }}
                className="w-full text-xs text-red-600 hover:bg-red-50 py-1 rounded flex items-center justify-center gap-1"
              >
                <X size={11} /> Clear filters
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* More menu */}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid="mch-more-trigger"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              border: '1px solid #e2e8f0', background: '#fff', color: '#64748b',
              cursor: 'pointer',
            }}
          >
            <MoreVertical size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[200px] p-1" data-testid="mch-more-menu">
          {onRefresh && (
            <button
              onClick={() => { setMenuOpen(false); onRefresh(); }}
              className="w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 hover:bg-muted"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          )}
          {onDownloadPDF && !editMode && (
            <button
              onClick={() => { setMenuOpen(false); onDownloadPDF(); }}
              data-testid="mch-pdf-btn"
              className="w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 hover:bg-muted"
            >
              <Download size={12} /> Download PDF
            </button>
          )}
          {canEdit && onToggleEditMode && (
            <button
              onClick={() => { setMenuOpen(false); onToggleEditMode(); }}
              data-testid="mch-edit-toggle"
              className={`w-full text-left px-2.5 py-2 rounded text-xs flex items-center gap-2 hover:bg-muted ${editMode ? 'text-foreground' : 'text-primary font-semibold'}`}
            >
              {editMode ? <><CheckCircle2 size={12} /> Done Editing</> : <><Pencil size={12} /> Edit Canvas</>}
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
