/**
 * AssetTypePalette — Right sidebar palette showing all asset types grouped by dept.
 * Used in Platform Vision edit mode to drag/click types onto the canvas.
 */
import { ICON_MAP, getIconHint } from '../lib/assetIcons';
import { Circle } from 'lucide-react';

export default function AssetTypePalette({
  assetTypes = [],
  departments = [],
  selectedType,
  onSelectType,
}) {
  // Group types by department
  const deptMap = {};
  departments.forEach(d => {
    const id = d.id || d._id;
    deptMap[id] = { dept: d, types: [] };
  });
  assetTypes.forEach(t => {
    const key = t.department_id || '__none__';
    if (!deptMap[key]) deptMap[key] = { dept: { name: 'Other', id: key }, types: [] };
    deptMap[key].types.push(t);
  });

  const groups = Object.values(deptMap).filter(g => g.types.length > 0);

  return (
    <div style={{
      width: 204, flexShrink: 0, background: '#fff',
      borderLeft: '1px solid #e2e8f0',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto', maxHeight: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: '1px solid #f1f5f9',
        position: 'sticky', top: 0, background: '#fff', zIndex: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: '0.04em' }}>
          ASSET TYPE PALETTE
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
          {selectedType
            ? <><span style={{ color: '#0891b2', fontWeight: 600 }}>{selectedType.name}</span> selected — click canvas to place</>
            : 'Click to select · Drag to place'
          }
        </div>
      </div>

      {/* Groups */}
      {groups.map(({ dept, types }) => (
        <div key={dept.id || dept._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
          <div style={{
            padding: '5px 12px',
            fontSize: 9, fontWeight: 700, color: '#94a3b8',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            background: '#f8fafc',
          }}>
            {dept.name}
          </div>
          <div style={{ padding: '6px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {types.map(type => {
              const id = type.id || type._id;
              const iconKey = type.icon_key || getIconHint(type.name);
              const Icon = ICON_MAP[iconKey] || Circle;
              const isSelected = selectedType && (selectedType.id || selectedType._id) === id;

              return (
                <button
                  key={id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('assetTypeId', id);
                    e.dataTransfer.setData('assetTypeName', type.name);
                    // Select this type too
                    onSelectType(type);
                  }}
                  onClick={() => onSelectType(isSelected ? null : type)}
                  data-testid={`palette-type-${id}`}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    padding: '7px 4px',
                    borderRadius: 8,
                    border: `1.5px solid ${isSelected ? '#0891b2' : '#e2e8f0'}`,
                    background: isSelected ? 'rgba(8,145,178,0.08)' : '#fff',
                    cursor: 'grab',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = '#0891b2';
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = '#e2e8f0';
                  }}
                  title={`${type.name} — click to select, drag to place`}
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
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length === 0 && (
        <div style={{ padding: 16, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          No asset types found. Add asset types in Admin Panel first.
        </div>
      )}
    </div>
  );
}
