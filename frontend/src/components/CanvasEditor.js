/**
 * CanvasEditor — Admin tool for placing assets at approximate positions
 * on a sub-zone canvas (Platform Blueprint layout editor).
 *
 * Interaction model (works on mouse & touch):
 *   - Click an unpositioned asset in the right panel → it becomes "selected"
 *   - Click on the canvas → places the selected asset at that position
 *   - Drag an already-placed asset icon → moves it to the new position
 *   - Type a landmark label (e.g. "P.No 27") + click [+] → enter placement mode → click canvas
 *   - Hover a placed asset → X button appears to remove its position
 */
import { useState, useRef, useCallback } from 'react';
import {
  Wind, Lightbulb, Droplets, Zap, Wifi, Users, Circle,
  Flame, Camera, Clock, AirVent, Plus, X, Save, RotateCcw,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { assetsAPI, canvasLandmarksAPI } from '../lib/api';
import { ICON_MAP } from '../lib/assetIcons';

// ── Small draggable asset icon on the canvas ──────────────────────────────────
function PlacedAsset({ asset, x, y, selected, onPointerDown, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const Icon = ICON_MAP[asset.asset_type_icon_hint] || Circle;

  const statusBorder = {
    working: '#22c55e', defective: '#f97316',
    pending_approval: '#eab308', not_ok: '#ef4444',
  }[asset.status] || '#94a3b8';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        width: 44, height: 44,
        touchAction: 'none',
        zIndex: hovered || selected ? 20 : 10,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onPointerDown={onPointerDown}
        style={{
          width: '100%', height: '100%',
          borderRadius: '50%',
          border: `2.5px solid ${statusBorder}`,
          background: selected ? 'rgba(8,145,178,0.15)' : 'rgba(255,255,255,0.9)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          cursor: 'grab',
          boxShadow: selected ? `0 0 0 3px rgba(8,145,178,0.4)` : '0 1px 4px rgba(0,0,0,0.15)',
          color: statusBorder,
          userSelect: 'none',
        }}
      >
        <Icon size={16} />
        <span style={{ fontSize: 7, fontWeight: 600, marginTop: 1, maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.asset_number?.split('-').slice(-1)[0] || '?'}
        </span>
      </div>

      {/* Remove button */}
      {(hovered || selected) && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(asset.id); }}
          style={{
            position: 'absolute', top: -5, right: -5,
            width: 16, height: 16,
            background: '#ef4444', border: 'none', borderRadius: '50%',
            color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          title="Remove position"
        >
          <X size={9} />
        </button>
      )}

      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#f8fafc',
          fontSize: 10, padding: '3px 7px', borderRadius: 5,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 50,
        }}>
          {asset.asset_number}
        </div>
      )}
    </div>
  );
}

// ── Main CanvasEditor ─────────────────────────────────────────────────────────
export default function CanvasEditor({ subZone, assets, landmarks, onSave, onClose }) {
  const canvasRef = useRef(null);

  // Local position state: { asset_id: { x, y } }
  const [positions, setPositions] = useState(() => {
    const init = {};
    (assets || []).forEach(a => {
      if (a.canvas_x != null && a.canvas_y != null) {
        init[a.id] = { x: a.canvas_x, y: a.canvas_y };
      }
    });
    return init;
  });

  const [localLandmarks, setLocalLandmarks] = useState(
    (landmarks || []).map(lm => ({ ...lm, _new: false })),
  );

  // Currently dragging { assetId }
  const [dragging, setDragging] = useState(null);
  // Asset selected for click-to-place
  const [selectedForPlace, setSelectedForPlace] = useState(null);
  // Landmark placement mode
  const [lmLabel, setLmLabel] = useState('');
  const [lmPlaceMode, setLmPlaceMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const positionedAssets = (assets || []).filter(a => positions[a.id] != null);
  const unpositionedAssets = (assets || []).filter(a => positions[a.id] == null);

  const getCanvasPercent = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(98, ((clientY - rect.top) / rect.height) * 100));
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  };

  const handleCanvasPointerMove = useCallback((e) => {
    if (!dragging) return;
    const pos = getCanvasPercent(e.clientX, e.clientY);
    if (!pos) return;
    setPositions(prev => ({ ...prev, [dragging.assetId]: pos }));
  }, [dragging]); // eslint-disable-line

  const handleCanvasPointerUp = useCallback(() => setDragging(null), []);

  const handleCanvasClick = (e) => {
    if (dragging) return;
    const pos = getCanvasPercent(e.clientX, e.clientY);
    if (!pos) return;

    if (lmPlaceMode && lmLabel.trim()) {
      setLocalLandmarks(prev => [...prev, {
        id: `new-${Date.now()}`,
        label: lmLabel.trim(),
        x: pos.x, y: pos.y,
        landmark_type: 'pole',
        _new: true,
      }]);
      setLmPlaceMode(false);
      return;
    }

    if (selectedForPlace) {
      setPositions(prev => ({ ...prev, [selectedForPlace]: pos }));
      setSelectedForPlace(null);
    }
  };

  const handleAssetDragStart = (assetId, e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedForPlace(null);
    setDragging({ assetId });
  };

  const removePosition = (assetId) => {
    setPositions(prev => { const n = { ...prev }; delete n[assetId]; return n; });
  };

  const removeLandmark = (lmId) => {
    setLocalLandmarks(prev => prev.filter(l => l.id !== lmId));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Bulk update canvas positions
      const posPayload = (assets || []).map(a => ({
        asset_id: a.id,
        canvas_x: positions[a.id]?.x ?? null,
        canvas_y: positions[a.id]?.y ?? null,
      }));
      await assetsAPI.bulkUpdateCanvasPositions(posPayload);

      // 2. Sync landmarks: delete removed, create new
      const originalIds = new Set((landmarks || []).map(l => l.id));
      const currentIds = new Set(localLandmarks.filter(l => !l._new).map(l => l.id));

      // Delete removed landmarks
      for (const id of originalIds) {
        if (!currentIds.has(id)) {
          try { await canvasLandmarksAPI.delete(id); } catch (_) {}
        }
      }
      // Create new landmarks
      for (const lm of localLandmarks.filter(l => l._new)) {
        try {
          await canvasLandmarksAPI.create({
            sub_zone_id: subZone.id,
            location_id: subZone.location_id,
            station_id: subZone.station_id,
            label: lm.label,
            x: lm.x,
            y: lm.y,
            landmark_type: lm.landmark_type || 'pole',
          });
        } catch (_) {}
      }

      toast.success('Canvas layout saved');
      if (onSave) onSave();
    } catch (e) {
      toast.error('Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  const cursor = selectedForPlace || lmPlaceMode ? 'crosshair' : (dragging ? 'grabbing' : 'default');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Instructions */}
      <div style={{
        fontSize: 11, color: '#64748b',
        background: '#f0f9ff', border: '1px solid #bae6fd',
        borderRadius: 6, padding: '6px 10px',
      }}>
        {selectedForPlace
          ? <><b>Click on the canvas</b> to place the selected asset. Press Escape to cancel.</>
          : lmPlaceMode
          ? <><b>Click on the canvas</b> to place landmark "{lmLabel}".</>
          : <>Click an unpositioned asset below to select it, then click on the canvas to place it. Drag placed assets to reposition.</>
        }
      </div>

      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            ref={canvasRef}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onClick={handleCanvasClick}
            onKeyDown={e => e.key === 'Escape' && setSelectedForPlace(null) && setLmPlaceMode(false)}
            tabIndex={0}
            style={{
              position: 'relative',
              width: '100%',
              paddingTop: '56.25%', // 16:9
              border: `2px dashed ${selectedForPlace || lmPlaceMode ? '#0891b2' : '#cbd5e1'}`,
              borderRadius: 10,
              background: '#f8fafc',
              cursor,
              userSelect: 'none',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }}>
              {/* Grid */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.3 }}>
                <defs>
                  <pattern id="ceditor-grid" width="10%" height="10%" patternUnits="objectBoundingBox">
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#94a3b8" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#ceditor-grid)" />
              </svg>

              {/* Divider */}
              {subZone?.has_divider && (
                subZone.divider_orientation === 'horizontal' ? (
                  <div style={{ position: 'absolute', left: 16, right: 16, top: '50%', borderTop: '2px dashed rgba(59,130,246,0.5)' }} />
                ) : (
                  <div style={{ position: 'absolute', top: 16, bottom: 16, left: '50%', borderLeft: '2px dashed rgba(59,130,246,0.5)' }} />
                )
              )}

              {/* Corner labels */}
              <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.06em' }}>HIGH END</div>
              <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.06em' }}>LOW END</div>

              {/* Placed assets */}
              {positionedAssets.map(asset => {
                const pos = positions[asset.id];
                return (
                  <PlacedAsset
                    key={asset.id}
                    asset={asset}
                    x={pos.x}
                    y={pos.y}
                    selected={selectedForPlace === asset.id}
                    onPointerDown={(e) => { e.stopPropagation(); handleAssetDragStart(asset.id, e); }}
                    onRemove={removePosition}
                  />
                );
              })}

              {/* Landmarks */}
              {localLandmarks.map(lm => (
                <div
                  key={lm.id}
                  style={{ position: 'absolute', left: `${lm.x}%`, top: `${lm.y}%`, transform: 'translate(-50%, -100%)', zIndex: 15 }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    background: '#fef3c7', border: '1px solid #f59e0b',
                    color: '#92400e', fontSize: 9, fontWeight: 700,
                    padding: '2px 5px', borderRadius: 8,
                  }}>
                    {lm.label}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeLandmark(lm.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', padding: 0, lineHeight: 1 }}
                    >
                      <X size={9} />
                    </button>
                  </div>
                  <div style={{ width: 1, height: 8, background: '#f59e0b', margin: '0 auto' }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
          {/* Landmark adder */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Landmarks
            </div>
            {localLandmarks.map(lm => (
              <div key={lm.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 9, background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', padding: '1px 5px', borderRadius: 6 }}>
                  {lm.label}
                </span>
                <button onClick={() => removeLandmark(lm.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <X size={9} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <Input
                value={lmLabel}
                onChange={e => setLmLabel(e.target.value)}
                placeholder="P.No 27"
                className="h-6 text-xs flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && lmLabel.trim()) { setLmPlaceMode(true); } }}
              />
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6 shrink-0"
                disabled={!lmLabel.trim()}
                onClick={() => { if (lmLabel.trim()) setLmPlaceMode(true); }}
                title="Place on canvas"
              >
                <Plus size={11} />
              </Button>
            </div>
          </div>

          {/* Unpositioned assets */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, flex: 1, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Unpositioned ({unpositionedAssets.length})
            </div>
            {unpositionedAssets.length === 0 ? (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>All placed</div>
            ) : unpositionedAssets.map(asset => {
              const Icon = ICON_MAP[asset.asset_type_icon_hint] || Circle;
              const isSelected = selectedForPlace === asset.id;
              return (
                <div
                  key={asset.id}
                  onClick={() => setSelectedForPlace(prev => prev === asset.id ? null : asset.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px', borderRadius: 6, marginBottom: 3,
                    border: `1px solid ${isSelected ? '#0891b2' : 'transparent'}`,
                    background: isSelected ? 'rgba(8,145,178,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    border: '1.5px solid #94a3b8', background: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#64748b', flexShrink: 0,
                  }}>
                    <Icon size={11} />
                  </div>
                  <span style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {asset.asset_number}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Placed count */}
          <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
            <Badge variant="outline" style={{ fontSize: 10 }}>{positionedAssets.length} placed</Badge>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
          <X size={14} className="mr-1.5" /> Cancel
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPositions({})} disabled={saving}>
          <RotateCcw size={14} className="mr-1.5" /> Reset All
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save size={14} className="mr-1.5" /> {saving ? 'Saving…' : 'Save Layout'}
        </Button>
      </div>
    </div>
  );
}
