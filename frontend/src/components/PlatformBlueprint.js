/**
 * PlatformBlueprint — visual asset health / inspection map for a location.
 *
 * Renders sub-zones as bordered canvases with assets positioned at their
 * approximate physical locations (canvas_x / canvas_y, 0-100%).
 *
 * Modes:
 *   'health'      — color icons by health status (working/orange/red/yellow)
 *   'inspection'  — color icons by current inspection session state
 *
 * Used by:
 *   StationCanvasPage  — standalone health overview
 *   InspectionPage     — blueprint mode toggle during inspection
 */
import { useState, useCallback } from 'react';
import {
  Wind, Lightbulb, Droplets, Zap, Wifi, Users, Circle,
  Flame, Camera, Clock, AirVent, Pencil, CheckCircle2,
  XCircle, Wrench, Info,
} from 'lucide-react';

// ── Icon mapping (keyword-based) ─────────────────────────────────────────────
export const ICON_MAP = {
  fan: Wind,
  light: Lightbulb,
  tap: Droplets,
  cib: Zap,
  wifi: Wifi,
  seat: Users,
  fire: Flame,
  camera: Camera,
  clock: Clock,
  ac: AirVent,
  default: Circle,
};

// ── Color helpers ─────────────────────────────────────────────────────────────
function healthStyle(asset) {
  if (asset.status === 'working') return {
    border: '#22c55e', bg: 'rgba(34,197,94,0.10)', text: '#15803d',
  };
  if (asset.status === 'pending_approval') return {
    border: '#eab308', bg: 'rgba(234,179,8,0.10)', text: '#a16207',
  };
  if (asset.list_type === 'red') return {
    border: '#ef4444', bg: 'rgba(239,68,68,0.10)', text: '#dc2626',
  };
  return { border: '#f97316', bg: 'rgba(249,115,22,0.10)', text: '#c2410c' };
}

function inspectionStyle(assetId, inspectionItems) {
  const item = (inspectionItems || []).find(i => (i.asset_id || i.assetId) === assetId);
  if (!item) return { border: '#94a3b8', bg: 'rgba(148,163,184,0.07)', text: '#64748b' };
  if (item.status === 'ok') return { border: '#22c55e', bg: 'rgba(34,197,94,0.12)', text: '#15803d' };
  if (item.status === 'not_ok') return { border: '#ef4444', bg: 'rgba(239,68,68,0.12)', text: '#dc2626' };
  return { border: '#f97316', bg: 'rgba(249,115,22,0.12)', text: '#c2410c' };
}

function inspectionOverlayIcon(assetId, inspectionItems) {
  const item = (inspectionItems || []).find(i => (i.asset_id || i.assetId) === assetId);
  if (!item) return null;
  if (item.status === 'ok') return CheckCircle2;
  if (item.status === 'not_ok') return XCircle;
  return Wrench;
}

// ── Single asset icon on canvas ───────────────────────────────────────────────
function AssetNode({ asset, mode, inspectionItems, onAssetClick, dimmed, size = 44 }) {
  const [tipVisible, setTipVisible] = useState(false);
  const Icon = ICON_MAP[asset.asset_type_icon_hint] || Circle;
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
        width: nodeSize,
        height: nodeSize,
        zIndex: tipVisible ? 30 : 10,
        opacity: dimmed ? 0.2 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <button
        onClick={() => onAssetClick && onAssetClick(asset)}
        onMouseEnter={() => setTipVisible(true)}
        onMouseLeave={() => setTipVisible(false)}
        onTouchStart={() => setTipVisible(true)}
        onTouchEnd={() => setTimeout(() => setTipVisible(false), 1200)}
        data-testid={`blueprint-asset-${asset.id}`}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: `2.5px solid ${style.border}`,
          background: style.bg,
          color: style.text,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.93)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        <Icon size={Math.round(nodeSize * 0.34)} />
        {isGrouped && (
          <span style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
            {defectCount}/{asset.total_count}
          </span>
        )}
      </button>

      {/* Inspection overlay icon */}
      {OverlayIcon && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 16, height: 16,
          background: style.border,
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          <OverlayIcon size={10} color="#fff" />
        </div>
      )}

      {/* Tooltip */}
      {tipVisible && (
        <div style={{
          position: 'absolute',
          bottom: '110%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0f172a',
          color: '#f8fafc',
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 50,
        }}>
          <div style={{ fontWeight: 600 }}>{asset.asset_number}</div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>{asset.asset_type_name}</div>
          {asset.hours_defective > 0 && (
            <div style={{ color: '#fca5a5', fontSize: 10 }}>{asset.hours_defective}h defective</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Landmark pin (P.No markers) ───────────────────────────────────────────────
function LandmarkPin({ lm }) {
  return (
    <div style={{
      position: 'absolute',
      left: `${lm.x}%`,
      top: `${lm.y}%`,
      transform: 'translate(-50%, -100%)',
      pointerEvents: 'none',
      zIndex: 5,
    }}>
      <div style={{
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#92400e',
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>
        {lm.label}
      </div>
      <div style={{ width: 1, height: 10, background: '#f59e0b', margin: '0 auto' }} />
    </div>
  );
}

// ── Sub-zone canvas ───────────────────────────────────────────────────────────
export function SubZoneCanvas({
  subZone,
  mode = 'health',
  inspectionItems,
  onAssetClick,
  filters,
  onEditCanvas,
}) {
  const positionedAssets = (subZone.assets || []).filter(
    a => a.canvas_x != null && a.canvas_y != null,
  );
  const unpositionedAssets = (subZone.assets || []).filter(
    a => a.canvas_x == null || a.canvas_y == null,
  );

  const isDimmed = (asset) => {
    if (!filters) return false;
    if (filters.dept_id && asset.department_id !== filters.dept_id) return true;
    if (filters.asset_type_id && asset.asset_type_id !== filters.asset_type_id) return true;
    return false;
  };

  // Health summary chips
  const working = (subZone.assets || []).filter(a => a.status === 'working').length;
  const pending = (subZone.assets || []).filter(a => a.status === 'pending_approval').length;
  const defective = (subZone.assets || []).filter(
    a => a.status !== 'working' && a.status !== 'pending_approval',
  ).length;
  const total = subZone.assets?.length || 0;

  // In inspection mode: count inspected
  const inspected = mode === 'inspection'
    ? (subZone.assets || []).filter(a =>
        (inspectionItems || []).find(i => (i.asset_id || i.assetId) === a.id),
      ).length
    : null;

  return (
    <div style={{
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      background: '#fff',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    }}>
      {/* Sub-zone header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <span style={{ fontSize: 11, color: '#0891b2', fontWeight: 600 }}>
              {inspected}/{total} done
            </span>
          )}
          {mode === 'health' && (
            <>
              {working > 0 && <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 10 }}>{working} ok</span>}
              {pending > 0 && <span style={{ fontSize: 10, background: '#fef9c3', color: '#a16207', padding: '1px 6px', borderRadius: 10 }}>{pending} pending</span>}
              {defective > 0 && <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: 10 }}>{defective} defective</span>}
            </>
          )}
          {onEditCanvas && (
            <button
              onClick={onEditCanvas}
              data-testid={`edit-canvas-${subZone.id}`}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#94a3b8', padding: 2, borderRadius: 4,
                display: 'flex', alignItems: 'center',
              }}
              title="Edit canvas layout"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Canvas area (16:9 aspect ratio) */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%' }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
          backgroundSize: '10% 10%',
        }}>
          {/* Center divider */}
          {subZone.has_divider && (
            subZone.divider_orientation === 'horizontal' ? (
              <div style={{
                position: 'absolute', left: 16, right: 16, top: '50%',
                borderTop: '2px dashed rgba(100,116,139,0.4)',
              }} />
            ) : (
              <div style={{
                position: 'absolute', top: 16, bottom: 16, left: '50%',
                borderLeft: '2px dashed rgba(100,116,139,0.4)',
              }} />
            )
          )}

          {/* HIGH / LOW end labels */}
          <div style={{
            position: 'absolute', top: 6, left: 8,
            fontSize: 9, color: '#94a3b8', fontFamily: 'monospace',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            pointerEvents: 'none',
          }}>High End ←</div>
          <div style={{
            position: 'absolute', top: 6, right: 8,
            fontSize: 9, color: '#94a3b8', fontFamily: 'monospace',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            pointerEvents: 'none',
          }}>→ Low End</div>

          {/* Positioned assets */}
          {positionedAssets.map(asset => (
            <AssetNode
              key={asset.id}
              asset={asset}
              mode={mode}
              inspectionItems={inspectionItems}
              onAssetClick={onAssetClick}
              dimmed={isDimmed(asset)}
            />
          ))}

          {/* Landmark pins */}
          {(subZone.landmarks || []).map(lm => (
            <LandmarkPin key={lm.id} lm={lm} />
          ))}

          {/* Empty state */}
          {positionedAssets.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: '#cbd5e1', gap: 6,
            }}>
              <Info size={22} />
              <span style={{ fontSize: 11 }}>No assets positioned yet</span>
              {onEditCanvas && (
                <button
                  onClick={onEditCanvas}
                  style={{
                    fontSize: 11, color: '#0891b2', background: 'none', border: 'none',
                    cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  Open canvas editor to place assets
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Unpositioned assets strip */}
      {unpositionedAssets.length > 0 && (
        <div style={{
          padding: '6px 10px',
          borderTop: '1px solid #f1f5f9',
          background: '#fafafa',
        }}>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Not positioned ({unpositionedAssets.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {unpositionedAssets.map(asset => {
              const Icon = ICON_MAP[asset.asset_type_icon_hint] || Circle;
              const style = mode === 'inspection'
                ? inspectionStyle(asset.id, inspectionItems)
                : healthStyle(asset);
              return (
                <button
                  key={asset.id}
                  onClick={() => onAssetClick && onAssetClick(asset)}
                  data-testid={`blueprint-unpositioned-${asset.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    borderRadius: 20,
                    border: `1.5px solid ${style.border}`,
                    background: style.bg,
                    color: style.text,
                    fontSize: 10, fontWeight: 500,
                    cursor: 'pointer',
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
  locationData,
  mode = 'health',
  inspectionItems,
  onAssetClick,
  filters,
  onEditCanvas,
}) {
  if (!locationData) return null;

  const { sub_zones = [], unzoned_assets = [] } = locationData;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Named sub-zones */}
      {sub_zones.map(sz => (
        <SubZoneCanvas
          key={sz.id}
          subZone={sz}
          mode={mode}
          inspectionItems={inspectionItems}
          onAssetClick={onAssetClick}
          filters={filters}
          onEditCanvas={onEditCanvas ? () => onEditCanvas(sz) : undefined}
        />
      ))}

      {/* Unzoned assets (no sub-zone assigned) */}
      {unzoned_assets.length > 0 && (
        <SubZoneCanvas
          subZone={{
            id: '__unzoned__',
            name: 'Unassigned to Sub-Zone',
            code: '',
            has_divider: false,
            assets: unzoned_assets,
            landmarks: [],
          }}
          mode={mode}
          inspectionItems={inspectionItems}
          onAssetClick={onAssetClick}
          filters={filters}
        />
      )}

      {sub_zones.length === 0 && unzoned_assets.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '48px 16px', color: '#94a3b8',
        }}>
          <Info size={32} style={{ margin: '0 auto 8px' }} />
          <div style={{ fontWeight: 500 }}>No assets in this location</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Add sub-zones and assets in the Admin Panel</div>
        </div>
      )}
    </div>
  );
}
