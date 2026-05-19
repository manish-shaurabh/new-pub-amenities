/**
 * PlatformBlueprint — visual asset health / inspection / edit map.
 *
 * Modes:
 *   'health'      — color icons by health status (read-only)
 *   'inspection'  — session state overlay, tap-to-inspect
 *   'edit'        — click assets for action menu, drop zones active
 */
import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2, XCircle, Wrench, Info, Pencil,
  ArrowUp, ArrowDown, Plus, Trash2, Move, X,
} from 'lucide-react';
import { resolveIcon, getIconHint } from '../lib/assetIcons';
import { getDeptTheme, shapeRadius, shapeTransform, shapeInnerTransform } from '../lib/departmentTheme';

// ── Color helpers ─────────────────────────────────────────────────────────────
export function healthStyle(asset) {
  if (asset.status === 'missing') return { border: '#94a3b8', bg: '#fff', text: '#94a3b8', isMissing: true };
  if (asset.status === 'working') return { border: '#22c55e', bg: 'rgba(34,197,94,0.10)', text: '#15803d' };
  if (asset.status === 'pending_approval') return { border: '#eab308', bg: 'rgba(234,179,8,0.10)', text: '#a16207' };
  if (asset.list_type === 'red') return { border: '#ef4444', bg: 'rgba(239,68,68,0.10)', text: '#dc2626' };
  return { border: '#f97316', bg: 'rgba(249,115,22,0.10)', text: '#c2410c' };
}

function inspectionStyle(assetId, inspectionItems) {
  const item = (inspectionItems || []).find(i => (i.asset_id || i.assetId) === assetId);
  if (!item) return { border: '#94a3b8', bg: 'rgba(148,163,184,0.07)', text: '#64748b' };
  if (item.status === 'ok') return { border: '#22c55e', bg: 'rgba(34,197,94,0.12)', text: '#15803d' };
  if (item.status === 'not_ok') return { border: '#ef4444', bg: 'rgba(239,68,68,0.12)', text: '#dc2626' };
  return { border: '#f97316', bg: 'rgba(249,115,22,0.12)', text: '#c2410c' };
}

function inspectionOverlayIcon(assetId, items) {
  const item = (items || []).find(i => (i.asset_id || i.assetId) === assetId);
  if (!item) return null;
  if (item.status === 'ok') return CheckCircle2;
  if (item.status === 'not_ok') return XCircle;
  return Wrench;
}

// ── Inline action menu (edit mode) ───────────────────────────────────────────
function AssetActionMenu({ asset, anchorX, anchorY, onEdit, onDelete, onToggleMissing, onMove, onClose }) {
  return (
    <div
      data-testid="asset-action-menu"
      style={{
        position: 'absolute',
        left: `calc(${anchorX}% + 26px)`,
        top: `calc(${anchorY}% - 12px)`,
        zIndex: 120,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        padding: '6px 4px',
        minWidth: 170,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ padding: '4px 10px 6px', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{asset.asset_number}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{asset.asset_type_name}</div>
      </div>
      {[
        { icon: Pencil, label: 'Edit Details', action: onEdit, color: '#334155', testKey: 'edit' },
        { icon: Move, label: 'Reposition', action: onMove, color: '#334155', testKey: 'reposition' },
        { icon: X, label: asset.status === 'missing' ? 'Mark Working' : 'Mark as Missing', action: onToggleMissing, color: '#f59e0b', testKey: 'mark-missing' },
        { icon: Trash2, label: 'Delete Asset', action: onDelete, color: '#ef4444', testKey: 'delete' },
      ].map(({ icon: Icon, label, action, color, testKey }) => (
        <button
          key={label}
          data-testid={`asset-action-${testKey}`}
          onClick={() => { action?.(); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', textAlign: 'left',
            padding: '5px 10px', borderRadius: 6,
            border: 'none', background: 'transparent',
            fontSize: 11, color, cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <Icon size={12} color={color} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Single asset node on canvas ───────────────────────────────────────────────
function AssetNode({
  asset, mode, inspectionItems, onAssetClick,
  dimmed, size = 44, editMode, onActionMenu, deptMap,
}) {
  const [tipVisible, setTipVisible] = useState(false);
  const iconKey = asset.asset_type_icon_hint || getIconHint(asset.asset_type_name);
  const Icon = resolveIcon(iconKey);
  const OverlayIcon = mode === 'inspection' ? inspectionOverlayIcon(asset.id, inspectionItems) : null;
  const style = mode === 'inspection'
    ? inspectionStyle(asset.id, inspectionItems)
    : healthStyle(asset);

  // Department theming
  const deptName = deptMap?.[asset.department_id] || '';
  const theme = getDeptTheme(deptName);
  const customIcon = asset.custom_icon_url;

  const isGrouped = asset.tracking_mode === 'grouped';
  const defectCount = (asset.needs_repair_count || 0) + (asset.not_working_count || 0);
  const nodeSize = isGrouped ? size + 10 : size;

  // Use department shape unless health status demands attention
  const isHealthy = asset.status === 'working';
  const borderRadius = shapeRadius(theme.shape);
  const outerTransform = shapeTransform(theme.shape);
  const innerTransform = shapeInnerTransform(theme.shape);

  // Blend department theme with health status
  const nodeBorder = style.border;
  const nodeBg = isHealthy ? theme.bg : style.bg;
  const nodeGlow = isHealthy ? theme.glow : `${style.border}33`;
  const iconColor = isHealthy ? theme.iconTint : style.text;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${asset.canvas_x}%`,
        top: `${asset.canvas_y}%`,
        transform: 'translate(-50%, -50%)',
        width: nodeSize, height: nodeSize,
        zIndex: tipVisible ? 30 : 10,
        opacity: dimmed ? 0.2 : 1,
        transition: 'opacity 0.2s, transform 0.15s',
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (editMode) {
            onActionMenu?.(asset);
          } else {
            onAssetClick?.(asset);
          }
        }}
        onMouseEnter={() => !editMode && setTipVisible(true)}
        onMouseLeave={() => setTipVisible(false)}
        data-testid={`blueprint-asset-${asset.id}`}
        style={{
          width: '100%', height: '100%',
          borderRadius,
          transform: outerTransform,
          border: `2.5px solid ${nodeBorder}`,
          background: style.isMissing ? '#fff' : nodeBg,
          color: iconColor,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: editMode
            ? `0 2px 6px rgba(0,0,0,0.15)`
            : `0 2px 8px ${nodeGlow}, 0 1px 3px rgba(0,0,0,0.08)`,
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.2s',
          position: 'relative',
          overflow: 'hidden',
        }}
        title={editMode ? 'Click to manage asset' : undefined}
      >
        <div style={{ transform: innerTransform, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {style.isMissing ? (
            <X size={Math.round(nodeSize * 0.4)} color="#94a3b8" />
          ) : customIcon ? (
            <>
              <img
                src={customIcon}
                alt=""
                style={{
                  width: Math.round(nodeSize * 0.65),
                  height: Math.round(nodeSize * 0.65),
                  objectFit: 'contain',
                  filter: isHealthy ? 'none' : 'grayscale(0.3) brightness(0.8)',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              {isGrouped && (
                <span style={{ fontSize: 7, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
                  {defectCount}/{asset.total_count}
                </span>
              )}
            </>
          ) : (
            <>
              <Icon size={Math.round(nodeSize * 0.36)} />
              {isGrouped && (
                <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
                  {defectCount}/{asset.total_count}
                </span>
              )}
            </>
          )}
        </div>
      </button>

      {/* Inspection overlay */}
      {OverlayIcon && !editMode && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 16, height: 16,
          background: style.border, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          <OverlayIcon size={10} color="#fff" />
        </div>
      )}

      {/* Department accent dot */}
      {isHealthy && !editMode && !style.isMissing && (
        <div style={{
          position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
          width: 6, height: 6, borderRadius: '50%',
          background: theme.accent,
          border: '1px solid #fff',
          boxShadow: `0 0 4px ${theme.glow}`,
        }} />
      )}

      {/* Tooltip (health/inspection mode) */}
      {tipVisible && (
        <div style={{
          position: 'absolute', bottom: '115%', left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#f8fafc',
          fontSize: 11, padding: '5px 10px', borderRadius: 8,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)', zIndex: 50,
          borderLeft: `3px solid ${theme.accent}`,
        }}>
          <div style={{ fontWeight: 600 }}>{asset.asset_number}</div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>{asset.asset_type_name}</div>
          {deptName && <div style={{ color: theme.accent, fontSize: 9, marginTop: 1 }}>{deptName}</div>}
          {asset.status === 'missing' && <div style={{ color: '#fbbf24', fontSize: 10 }}>MISSING</div>}
          {asset.hours_defective > 0 && (
            <div style={{ color: '#fca5a5', fontSize: 10 }}>{asset.hours_defective}h defective</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Landmark pin ──────────────────────────────────────────────────────────────
function LandmarkPin({ lm }) {
  return (
    <div style={{
      position: 'absolute',
      left: `${lm.x}%`, top: `${lm.y}%`,
      transform: 'translate(-50%, -100%)',
      pointerEvents: 'none', zIndex: 5,
    }}>
      <div style={{
        background: '#fef3c7', border: '1px solid #f59e0b',
        color: '#92400e', fontSize: 9, fontWeight: 700,
        padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>{lm.label}</div>
      <div style={{ width: 1, height: 10, background: '#f59e0b', margin: '0 auto' }} />
    </div>
  );
}

// ── Sub-zone canvas ───────────────────────────────────────────────────────────
export function SubZoneCanvas({
  subZone, mode = 'health', inspectionItems,
  onAssetClick, filters, onEditCanvas,
  editMode = false,
  onAssetAction,      // (asset, subZoneId) called in edit mode on asset click
  onCanvasAreaClick,  // (subZoneId, x, y) called when clicking empty canvas in edit/place mode
  onDragOver,         // drag-over handler for palette drops
  onDrop,             // drop handler for palette drops
  isFirst, isLast,    // for reorder controls
  onMoveUp, onMoveDown, onDeleteSubZone,
  onAddSubZone,       // shows "Add Sub-Zone" button below this card (when isLast)
  healthSlot,         // optional ReactNode rendered below the canvas (e.g. Shed Health card)
  deptMap,            // { dept_id: dept_name } for department theming
  onRenameSubZone,    // (subZoneId, newName) called to rename a sub-zone
}) {
  const canvasRef = useRef(null);
  const [actionMenuAsset, setActionMenuAsset] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // Track canvas pixel width to scale icon size responsively. Mobile canvases
  // (~ 360px wide) get smaller icons so 10+ assets don't overlap.
  const [canvasWidth, setCanvasWidth] = useState(900);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setCanvasWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const positioned = (subZone.assets || []).filter(a => a.canvas_x != null && a.canvas_y != null);
  const unpositioned = (subZone.assets || []).filter(a => a.canvas_x == null || a.canvas_y == null);

  // Per-sub-zone asset-type chip filter (only dims, never hides).
  const [localTypeFilter, setLocalTypeFilter] = useState(null);
  const localTypeCounts = (() => {
    const m = new Map();
    (subZone.assets || []).forEach(a => {
      const id = a.asset_type_id;
      const name = a.asset_type_name || 'Other';
      if (!id) return;
      const cur = m.get(id) || { id, name, total: 0 };
      cur.total += 1;
      m.set(id, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  })();

  // Responsive icon size: 28–46px based on container width AND density.
  // Higher asset counts also shrink the nodes so they don't overlap.
  const density = positioned.length;
  const baseSize = canvasWidth < 380 ? 30 : canvasWidth < 560 ? 36 : canvasWidth < 780 ? 40 : 46;
  const densityPenalty = density > 20 ? 8 : density > 12 ? 4 : 0;
  const nodeSize = Math.max(24, baseSize - densityPenalty);

  const isDimmed = (asset) => {
    if (localTypeFilter && asset.asset_type_id !== localTypeFilter) return true;
    if (!filters) return false;
    if (filters.dept_id && asset.department_id !== filters.dept_id) return true;
    if (filters.asset_type_id && asset.asset_type_id !== filters.asset_type_id) return true;
    return false;
  };

  const working = (subZone.assets || []).filter(a => a.status === 'working').length;
  const pending = (subZone.assets || []).filter(a => a.status === 'pending_approval').length;
  const missing = (subZone.assets || []).filter(a => a.status === 'missing').length;
  const defective = (subZone.assets || []).filter(
    a => a.status !== 'working' && a.status !== 'pending_approval' && a.status !== 'missing',
  ).length;
  const total = subZone.assets?.length || 0;

  const inspected = mode === 'inspection'
    ? (subZone.assets || []).filter(a => (inspectionItems || []).find(i => (i.asset_id || i.assetId) === a.id)).length
    : null;

  const handleCanvasClick = (e) => {
    if (actionMenuAsset) { setActionMenuAsset(null); return; }
    if (!editMode || !onCanvasAreaClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(3, Math.min(97, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(3, Math.min(97, ((e.clientY - rect.top) / rect.height) * 100));
    onCanvasAreaClick(subZone.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  };

  const handleDragOver = (e) => {
    if (!editMode) return;
    e.preventDefault();
    onDragOver?.(e, subZone.id);
  };

  const handleDrop = (e) => {
    if (!editMode) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(3, Math.min(97, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(3, Math.min(97, ((e.clientY - rect.top) / rect.height) * 100));
    onDrop?.(e, subZone.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  };

  return (
    <div style={{
      borderRadius: 12, border: `1.5px solid ${editMode ? '#bae6fd' : '#e2e8f0'}`,
      background: '#fff', overflow: 'hidden',
      boxShadow: editMode ? '0 2px 8px rgba(8,145,178,0.1)' : '0 1px 3px rgba(0,0,0,0.07)',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px', background: editMode ? '#f0f9ff' : '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {editMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 2 }}>
              <button
                onClick={onMoveUp} disabled={isFirst}
                style={{
                  background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer',
                  padding: 1, color: isFirst ? '#e2e8f0' : '#94a3b8', lineHeight: 1,
                }}
                title="Move sub-zone up"
              ><ArrowUp size={12} /></button>
              <button
                onClick={onMoveDown} disabled={isLast}
                style={{
                  background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer',
                  padding: 1, color: isLast ? '#e2e8f0' : '#94a3b8', lineHeight: 1,
                }}
                title="Move sub-zone down"
              ><ArrowDown size={12} /></button>
            </div>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
            {editMode && onRenameSubZone && !editingName ? (
              <button
                onClick={() => { setNameInput(subZone.name); setEditingName(true); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155', padding: 0, borderBottom: '1px dashed #94a3b8' }}
                title="Click to rename"
              >
                {subZone.name}
              </button>
            ) : editMode && editingName ? (
              <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameInput.trim()) {
                      onRenameSubZone(subZone.id, nameInput.trim());
                      setEditingName(false);
                    } else if (e.key === 'Escape') {
                      setEditingName(false);
                    }
                  }}
                  onBlur={() => {
                    if (nameInput.trim() && nameInput.trim() !== subZone.name) {
                      onRenameSubZone(subZone.id, nameInput.trim());
                    }
                    setEditingName(false);
                  }}
                  style={{ fontSize: 13, fontWeight: 600, color: '#334155', border: '1px solid #0891b2', borderRadius: 4, padding: '0 4px', width: Math.max(80, nameInput.length * 8 + 16), outline: 'none' }}
                  data-testid={`rename-subzone-input-${subZone.id}`}
                />
              </span>
            ) : (
              subZone.name
            )}
          </span>
          {subZone.code && (
            <span style={{
              fontSize: 10, background: '#e2e8f0', color: '#64748b',
              padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace',
            }}>{subZone.code}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {mode === 'inspection' && inspected !== null && (
            <span style={{ fontSize: 11, color: '#0891b2', fontWeight: 600 }}>{inspected}/{total}</span>
          )}
          {mode === 'health' && (
            <>
              {working > 0 && <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 10 }}>{working} ok</span>}
              {defective > 0 && <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: 10 }}>{defective} defect</span>}
              {missing > 0 && <span style={{ fontSize: 10, background: '#f1f5f9', color: '#94a3b8', padding: '1px 6px', borderRadius: 10 }}>{missing} missing</span>}
              {pending > 0 && <span style={{ fontSize: 10, background: '#fef9c3', color: '#a16207', padding: '1px 6px', borderRadius: 10 }}>{pending} pending</span>}
            </>
          )}
          {editMode && onEditCanvas && (
            <button onClick={onEditCanvas} title="Reposition assets (editor)"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}>
              <Pencil size={12} />
            </button>
          )}
          {editMode && onDeleteSubZone && (
            <button onClick={() => onDeleteSubZone(subZone.id)} title="Delete sub-zone"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: 2 }}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Per-sub-zone asset-type chip strip — quick focus filter */}
      {!editMode && localTypeCounts.length > 1 && (
        <div
          data-testid={`subzone-type-chips-${subZone.id}`}
          style={{
            display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'nowrap',
            padding: '5px 10px', background: '#fafafa',
            borderBottom: '1px solid #f1f5f9',
            overflowX: 'auto',
          }}
        >
          <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0, marginRight: 2 }}>
            Type
          </span>
          <button
            onClick={() => setLocalTypeFilter(null)}
            data-testid={`subzone-type-chip-all-${subZone.id}`}
            style={{
              padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: localTypeFilter == null ? 600 : 400,
              border: `1.5px solid ${localTypeFilter == null ? '#0891b2' : '#e2e8f0'}`,
              background: localTypeFilter == null ? '#e0f2fe' : '#fff',
              color: localTypeFilter == null ? '#0891b2' : '#64748b',
              cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            All · {subZone.assets?.length || 0}
          </button>
          {localTypeCounts.map(t => {
            const active = localTypeFilter === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setLocalTypeFilter(active ? null : t.id)}
                data-testid={`subzone-type-chip-${t.id}-${subZone.id}`}
                style={{
                  padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: active ? 600 : 400,
                  border: `1.5px solid ${active ? '#0891b2' : '#e2e8f0'}`,
                  background: active ? '#e0f2fe' : '#fff',
                  color: active ? '#0891b2' : '#64748b',
                  cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                }}
                title={t.name}
              >
                {t.name} · {t.total}
              </button>
            );
          })}
        </div>
      )}

      {/* Canvas (16:9) */}
      <div
        ref={canvasRef}
        onClick={handleCanvasClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          position: 'relative', width: '100%', paddingTop: '56.25%',
          cursor: editMode ? 'crosshair' : 'default',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px),linear-gradient(90deg,rgba(148,163,184,0.08) 1px,transparent 1px)',
          backgroundSize: '10% 10%',
        }}>
          {/* Center divider */}
          {subZone.has_divider && (
            subZone.divider_orientation === 'horizontal' ? (
              <div style={{ position: 'absolute', left: 16, right: 16, top: '50%', borderTop: '2px dashed rgba(100,116,139,0.4)' }} />
            ) : (
              <div style={{ position: 'absolute', top: 16, bottom: 16, left: '50%', borderLeft: '2px dashed rgba(100,116,139,0.4)' }} />
            )
          )}
          {/* Corner labels — use sub-zone pillar markers when defined */}
          <div style={{ position: 'absolute', top: 5, left: 7, fontSize: 9, color: subZone.start_pillar ? '#0891b2' : '#94a3b8', fontFamily: 'monospace', fontWeight: subZone.start_pillar ? 700 : 400, letterSpacing: '0.06em', pointerEvents: 'none' }}>
            {subZone.start_pillar ? `📍 ${subZone.start_pillar} ←` : 'High End ←'}
          </div>
          <div style={{ position: 'absolute', top: 5, right: 7, fontSize: 9, color: subZone.end_pillar ? '#0891b2' : '#94a3b8', fontFamily: 'monospace', fontWeight: subZone.end_pillar ? 700 : 400, letterSpacing: '0.06em', pointerEvents: 'none' }}>
            {subZone.end_pillar ? `→ ${subZone.end_pillar} 📍` : '→ Low End'}
          </div>

          {/* Edit mode hint */}
          {editMode && positioned.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 11, color: '#bae6fd', background: 'rgba(8,145,178,0.06)', padding: '4px 12px', borderRadius: 20, border: '1px dashed #bae6fd' }}>
                Select a type from palette, then click here to place
              </span>
            </div>
          )}

          {/* Assets */}
          {positioned.map(asset => (
            <AssetNode
              key={asset.id}
              asset={asset}
              mode={mode}
              size={nodeSize}
              inspectionItems={inspectionItems}
              onAssetClick={onAssetClick}
              dimmed={isDimmed(asset)}
              editMode={editMode}
              onActionMenu={(a) => setActionMenuAsset(actionMenuAsset?.id === a.id ? null : a)}
              deptMap={deptMap}
            />
          ))}

          {/* Action menu */}
          {actionMenuAsset && editMode && (
            <AssetActionMenu
              asset={actionMenuAsset}
              anchorX={actionMenuAsset.canvas_x || 50}
              anchorY={actionMenuAsset.canvas_y || 50}
              onEdit={() => onAssetAction?.(actionMenuAsset, subZone.id, 'edit')}
              onDelete={() => onAssetAction?.(actionMenuAsset, subZone.id, 'delete')}
              onToggleMissing={() => onAssetAction?.(actionMenuAsset, subZone.id, 'toggle_missing')}
              onMove={() => onAssetAction?.(actionMenuAsset, subZone.id, 'move')}
              onClose={() => setActionMenuAsset(null)}
            />
          )}

          {/* Landmarks */}
          {(subZone.landmarks || []).map(lm => <LandmarkPin key={lm.id} lm={lm} />)}
        </div>
      </div>

      {/* Unpositioned strip */}
      {unpositioned.length > 0 && (
        <div style={{ padding: '5px 10px', borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Not positioned ({unpositioned.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {unpositioned.map(asset => {
              const iconKey = asset.asset_type_icon_hint || getIconHint(asset.asset_type_name);
              const Icon = resolveIcon(iconKey);
              const style = mode === 'inspection' ? inspectionStyle(asset.id, inspectionItems) : healthStyle(asset);
              const deptName = deptMap?.[asset.department_id] || '';
              const theme = getDeptTheme(deptName);
              const customIcon = asset.custom_icon_url;
              return (
                <button
                  key={asset.id}
                  onClick={(e) => { e.stopPropagation(); editMode ? onAssetAction?.(asset, subZone.id, 'edit') : onAssetClick?.(asset); }}
                  data-testid={`blueprint-unpositioned-${asset.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px',
                    borderRadius: 20, border: `1.5px solid ${style.border}`,
                    background: style.isMissing ? '#fff' : (asset.status === 'working' ? theme.bg : style.bg),
                    color: asset.status === 'working' ? theme.iconTint : style.text,
                    fontSize: 10, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {customIcon ? (
                    <img src={customIcon} alt="" style={{ width: 12, height: 12, objectFit: 'contain' }} />
                  ) : (
                    <Icon size={10} />
                  )}
                  {asset.asset_number?.split('-').slice(-1)[0] || asset.asset_number}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Optional inline slot rendered below the canvas (e.g. Shed Health card) */}
      {healthSlot && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid #f1f5f9', background: '#fff' }}>
          {healthSlot}
        </div>
      )}
    </div>
  );
}

// ── Full location blueprint ───────────────────────────────────────────────────
export default function PlatformBlueprint({
  locationData, mode = 'health',
  inspectionItems, onAssetClick, filters,
  editMode = false, onEditCanvas,
  onAssetAction, onCanvasAreaClick,
  onDragOver, onDrop,
  onMoveSubZone, onDeleteSubZone, onAddSubZone,
  renderHealthSlot,  // (subZone) => ReactNode rendered below each sub-zone canvas
  deptMap,           // { dept_id: dept_name } for department theming
  onRenameSubZone,   // (subZoneId, newName) rename sub-zone
}) {
  if (!locationData) return null;
  const { sub_zones = [], unzoned_assets = [] } = locationData;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} id="platform-blueprint-root">
      {sub_zones.map((sz, idx) => (
        <SubZoneCanvas
          key={sz.id}
          subZone={sz}
          mode={mode}
          inspectionItems={inspectionItems}
          onAssetClick={onAssetClick}
          filters={filters}
          editMode={editMode}
          onEditCanvas={onEditCanvas ? () => onEditCanvas(sz) : undefined}
          onAssetAction={onAssetAction}
          onCanvasAreaClick={onCanvasAreaClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          isFirst={idx === 0}
          isLast={idx === sub_zones.length - 1}
          onMoveUp={() => onMoveSubZone?.(sz, 'up', idx)}
          onMoveDown={() => onMoveSubZone?.(sz, 'down', idx)}
          onDeleteSubZone={onDeleteSubZone}
          onAddSubZone={onAddSubZone}
          healthSlot={renderHealthSlot ? renderHealthSlot(sz) : null}
          deptMap={deptMap}
          onRenameSubZone={onRenameSubZone}
        />
      ))}

      {unzoned_assets.length > 0 && (
        <SubZoneCanvas
          subZone={{ id: '__unzoned__', name: 'Unassigned to Sub-Zone', code: '', has_divider: false, assets: unzoned_assets, landmarks: [] }}
          mode={mode}
          inspectionItems={inspectionItems}
          onAssetClick={onAssetClick}
          filters={filters}
          editMode={false}
          deptMap={deptMap}
        />
      )}

      {sub_zones.length === 0 && unzoned_assets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#94a3b8' }}>
          <Info size={32} style={{ margin: '0 auto 8px' }} />
          <div style={{ fontWeight: 500 }}>No sub-zones yet for this location</div>
          {editMode && onAddSubZone && (
            <button
              onClick={() => onAddSubZone(locationData?.id)}
              style={{ marginTop: 10, fontSize: 12, color: '#0891b2', background: 'none', border: '1px dashed #0891b2', borderRadius: 8, padding: '6px 16px', cursor: 'pointer' }}
            >
              + Add First Sub-Zone
            </button>
          )}
        </div>
      )}

      {/* Add Sub-Zone button (edit mode) */}
      {editMode && sub_zones.length > 0 && onAddSubZone && (
        <button
          onClick={() => onAddSubZone(locationData?.id)}
          data-testid="add-subzone-btn"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 10,
            border: '1.5px dashed #0891b2', background: 'rgba(8,145,178,0.04)',
            color: '#0891b2', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(8,145,178,0.09)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(8,145,178,0.04)'}
        >
          <Plus size={14} /> Add Sub-Zone
        </button>
      )}

      {/* Department color legend */}
      {deptMap && Object.keys(deptMap).length > 0 && !editMode && (
        <DeptLegend deptMap={deptMap} />
      )}
    </div>
  );
}

// ── Department color legend ───────────────────────────────────────────────────
function DeptLegend({ deptMap }) {
  const seen = new Set();
  const entries = Object.entries(deptMap)
    .map(([id, name]) => {
      const theme = getDeptTheme(name);
      if (seen.has(theme.key)) return null;
      seen.add(theme.key);
      return { name, theme };
    })
    .filter(Boolean);

  if (entries.length <= 1) return null;

  return (
    <div
      data-testid="dept-legend"
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        padding: '6px 12px', background: '#fafafa', borderRadius: 8,
        border: '1px solid #f1f5f9',
      }}
    >
      <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        Department Colors
      </span>
      {entries.map(({ name, theme }) => (
        <span
          key={theme.key}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: theme.text,
          }}
        >
          <span style={{
            width: 10, height: 10, borderRadius: shapeRadius(theme.shape),
            transform: shapeTransform(theme.shape),
            background: theme.bgSolid, border: `1.5px solid ${theme.border}`,
            display: 'inline-block', flexShrink: 0,
          }} />
          {name}
        </span>
      ))}
    </div>
  );
}
