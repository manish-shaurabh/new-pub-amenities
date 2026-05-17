/**
 * AssetTypePalette — Right sidebar palette for Platform Vision edit mode.
 *
 * UI:
 *  - Search box (filters by asset type name)
 *  - Multi-select department category chips (filter the icon grid)
 *  - Icon grid — drag any tile to canvas (or click to select-then-click-canvas)
 *  - Hover tooltip shows: name + default dept + icon_key + tracking_mode
 */
import { useMemo, useState } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { ICON_MAP, getIconHint } from '../lib/assetIcons';
import { Circle } from 'lucide-react';

export default function AssetTypePalette({
  assetTypes = [],
  departments = [],
  selectedType,
  onSelectType,
}) {
  const [search, setSearch] = useState('');
  const [selectedDepts, setSelectedDepts] = useState(() => new Set()); // empty = all

  const deptIndex = useMemo(() => {
    const m = {};
    departments.forEach(d => { m[d.id || d._id] = d; });
    return m;
  }, [departments]);

  // Asset types that have a valid dept (defensive — backend guarantees this)
  const validTypes = useMemo(
    () => assetTypes.filter(t => t.department_id && deptIndex[t.department_id]),
    [assetTypes, deptIndex],
  );

  // Departments that actually have asset types — chip list source
  const deptOptionsWithCounts = useMemo(() => {
    const counts = {};
    validTypes.forEach(t => {
      counts[t.department_id] = (counts[t.department_id] || 0) + 1;
    });
    return departments
      .filter(d => counts[d.id || d._id])
      .map(d => ({ ...d, count: counts[d.id || d._id] }));
  }, [validTypes, departments]);

  const toggleDept = (deptId) => {
    setSelectedDepts(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedDepts(new Set());
    setSearch('');
  };

  // Apply filters
  const filteredTypes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return validTypes.filter(t => {
      if (selectedDepts.size > 0 && !selectedDepts.has(t.department_id)) return false;
      if (q && !((t.name || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [validTypes, selectedDepts, search]);

  const hasFilters = selectedDepts.size > 0 || search;

  return (
    <div
      data-testid="asset-type-palette"
      style={{
        width: 240, flexShrink: 0, background: '#fff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', maxHeight: '100%',
      }}
    >
      {/* Sticky header */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: '1px solid #f1f5f9',
        background: '#fff', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: '0.04em' }}>
            ASSET PALETTE
          </span>
          {hasFilters && (
            <button
              onClick={clearFilters}
              data-testid="palette-clear-filters"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#94a3b8', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2,
              }}
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
          {selectedType
            ? <><span style={{ color: '#0891b2', fontWeight: 600 }}>{selectedType.name}</span> selected — click canvas or drag any tile</>
            : 'Drag a tile to canvas to create an asset'
          }
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginTop: 8 }}>
          <Search size={12} style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            color: '#94a3b8', pointerEvents: 'none',
          }} />
          <input
            data-testid="palette-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search asset type…"
            style={{
              width: '100%', padding: '5px 8px 5px 26px',
              fontSize: 11, color: '#334155',
              border: '1px solid #e2e8f0', borderRadius: 6,
              outline: 'none', background: '#f8fafc',
            }}
            onFocus={e => e.target.style.borderColor = '#0891b2'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>

        {/* Dept chips */}
        {deptOptionsWithCounts.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 9, color: '#94a3b8', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
            }}>
              <Filter size={9} /> Categories
              {selectedDepts.size > 0 && (
                <span style={{ color: '#0891b2', marginLeft: 'auto' }}>
                  {selectedDepts.size} selected
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {deptOptionsWithCounts.map(d => {
                const id = d.id || d._id;
                const active = selectedDepts.has(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleDept(id)}
                    data-testid={`palette-dept-chip-${id}`}
                    style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 10,
                      border: `1px solid ${active ? '#0891b2' : '#e2e8f0'}`,
                      background: active ? '#e0f2fe' : '#fff',
                      color: active ? '#0891b2' : '#64748b',
                      fontWeight: active ? 600 : 400, cursor: 'pointer',
                      transition: 'all 0.12s', display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    {d.name}
                    <span style={{
                      fontSize: 8, fontWeight: 700,
                      background: active ? '#0891b2' : '#e2e8f0',
                      color: active ? '#fff' : '#64748b',
                      padding: '0 4px', borderRadius: 6,
                    }}>{d.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Icon grid (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 16px' }}>
        {filteredTypes.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            {assetTypes.length === 0
              ? 'No asset types yet. Add some in Admin → Asset Types.'
              : 'No types match the current filters.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {filteredTypes.map(type => {
              const id = type.id || type._id;
              const iconKey = type.icon_key || getIconHint(type.name);
              const Icon = ICON_MAP[iconKey] || Circle;
              const isSelected = selectedType && (selectedType.id || selectedType._id) === id;
              const deptName = deptIndex[type.department_id]?.name || '';

              return (
                <button
                  key={id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('assetTypeId', id);
                    e.dataTransfer.setData('assetTypeName', type.name);
                    onSelectType(type);
                  }}
                  onClick={() => onSelectType(isSelected ? null : type)}
                  data-testid={`palette-type-${id}`}
                  title={`${type.name}\n${deptName ? `Dept: ${deptName}` : ''}\nTracking: ${type.tracking_mode || 'individual'}`}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    padding: '8px 4px',
                    borderRadius: 8,
                    border: `1.5px solid ${isSelected ? '#0891b2' : '#e2e8f0'}`,
                    background: isSelected ? 'rgba(8,145,178,0.08)' : '#fff',
                    cursor: 'grab',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = '#0891b2';
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = '#e2e8f0';
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%',
                    border: `2px solid ${isSelected ? '#0891b2' : '#e2e8f0'}`,
                    background: isSelected ? 'rgba(8,145,178,0.12)' : '#f8fafc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isSelected ? '#0891b2' : '#64748b',
                    transition: 'all 0.15s',
                  }}>
                    <Icon size={16} />
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#0891b2' : '#64748b',
                    lineHeight: 1.2, wordBreak: 'break-word',
                    maxWidth: '100%', overflow: 'hidden',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {type.name}
                  </span>
                  {type.tracking_mode === 'grouped' && (
                    <span style={{
                      position: 'absolute', top: 3, right: 3,
                      fontSize: 7, fontWeight: 700,
                      background: '#fef3c7', color: '#a16207',
                      padding: '0 3px', borderRadius: 4, letterSpacing: '0.04em',
                    }}>GRP</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
