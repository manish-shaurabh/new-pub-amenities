/**
 * PlatformBlueprint — visual asset health / inspection / edit map.
 *
 * Modes:
 *   'health'      — color icons by health status (read-only)
 *   'inspection'  — session state overlay, tap-to-inspect
 *   'edit'        — click assets for action menu, drop zones active
 */
import { useState, useRef } from 'react';
import {
  CheckCircle2, XCircle, Wrench, Info, Pencil,
  ArrowUp, ArrowDown, Plus, Trash2, Move, X,
} from 'lucide-react';
import { resolveIcon, getIconHint } from '../lib/assetIcons';

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
  dimmed, size = 44, editMode, onActionMenu,
}) {
  const [tipVisible, setTipVisible] = useState(false);
  const iconKey = asset.asset_type_icon_hint || getIconHint(asset.asset_type_name);
  const Icon = resolveIcon(iconKey);
  const OverlayIcon = mode === 'inspection' ? inspectionOverlayIcon(asset.id, inspectionItems) : null;
  const style = mode === 'inspection'
    ? inspectionStyle(asset.id, inspectionItems)
    : healthStyle(asset);

  const isGrouped = asset.tracking_mode === 'grouped';
  const defectCount = (asset.needs_repair_count || 0) + (asset.not_working_count || 0);
  const nodeSize = isGrouped ? size + 10 : size;

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
        transition: 'opacity 0.2s',
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
          borderRadius: '50%',
          border: `2.5px solid ${style.border}`,
          background: style.isMissing ? '#fff' : style.bg,
          color: style.text,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          cursor: editMode ? 'pointer' : 'pointer',
          boxShadow: editMode ? '0 2px 6px rgba(0,0,0,0.15)' : '0 1px 4px rgba(0,0,0,0.12)',
          transition: 'transform 0.1s, box-shadow 0.1s',
          position: 'relative',
        }}
        title={editMode ? 'Click to manage asset' : undefined}
      >
        {style.isMissing ? (
          <X size={Math.round(nodeSize * 0.4)} color="#94a3b8" />
        ) : (
          <>
            <Icon size={Math.round(nodeSize * 0.34)} />
            {isGrouped && (
              <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
                {defectCount}/{asset.total_count}
              </span>
            )}
          </>
        )}
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

      {/* Tooltip (health/inspection mode) */}
      {tipVisible && (
        <div style={{
          position: 'absolute', bottom: '115%', left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#f8fafc',
          fontSize: 11, padding: '4px 8px', borderRadius: 6,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 50,
        }}>
          <div style={{ fontWeight: 600 }}>{asset.asset_number}</div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>{asset.asset_type_name}</div>
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
}) {
  const canvasRef = useRef(null);
  const [actionMenuAsset, setActionMenuAsset] = useState(null);

  const positioned = (subZone.assets || []).filter(a => a.canvas_x != null && a.canvas_y != null);
  const unpositioned = (subZone.assets || []).filter(a => a.canvas_x == null || a.canvas_y == null);

  const isDimmed = (asset) => {
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
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{subZone.name}</span>
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
          {/* Corner labels */}
          <div style={{ position: 'absolute', top: 5, left: 7, fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.06em', pointerEvents: 'none' }}>High End ←</div>
          <div style={{ position: 'absolute', top: 5, right: 7, fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.06em', pointerEvents: 'none' }}>→ Low End</div>

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
              inspectionItems={inspectionItems}
              onAssetClick={onAssetClick}
              dimmed={isDimmed(asset)}
              editMode={editMode}
              onActionMenu={(a) => setActionMenuAsset(actionMenuAsset?.id === a.id ? null : a)}
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
              return (
                <button
                  key={asset.id}
                  onClick={(e) => { e.stopPropagation(); editMode ? onAssetAction?.(asset, subZone.id, 'edit') : onAssetClick?.(asset); }}
                  data-testid={`blueprint-unpositioned-${asset.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px',
                    borderRadius: 20, border: `1.5px solid ${style.border}`,
                    background: style.isMissing ? '#fff' : style.bg, color: style.text,
                    fontSize: 10, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  <Icon size={10} />
                  {asset.asset_number?.split('-').slice(-1)[0] || asset.asset_number}
                </button>
              );
            })}
          </div>
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
    </div>
  );
}
