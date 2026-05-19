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
import { Plus, X, Save, RotateCcw, Pencil, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { assetsAPI, canvasLandmarksAPI } from '../lib/api';
import { resolveIcon } from '../lib/assetIcons';


// ── Landmark editor row — inline rename + delete ──────────────────────────────
function LandmarkEditorRow({ lm, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(lm.label);

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && val.trim()) { onRename(lm.id, val.trim()); setEditing(false); }
            if (e.key === 'Escape') { setVal(lm.label); setEditing(false); }
          }}
          onBlur={() => { if (val.trim()) { onRename(lm.id, val.trim()); } setEditing(false); }}
          style={{ fontSize: 9, border: '1px solid #0891b2', borderRadius: 4, padding: '1px 4px', width: '100%', outline: 'none', background: '#f0f9ff' }}
          data-testid={`landmark-edit-input-${lm.id}`}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3, group: true }}
      data-testid={`landmark-row-${lm.id}`}
    >
      <GripVertical size={8} style={{ color: '#d1d5db', flexShrink: 0 }} />
      <span style={{
        fontSize: 9, background: lm._new ? '#e0f2fe' : '#fef3c7',
        color: lm._new ? '#0369a1' : '#92400e',
        border: `1px solid ${lm._new ? '#7dd3fc' : '#f59e0b'}`,
        padding: '1px 5px', borderRadius: 6, flex: 1, cursor: 'text',
      }}
        onClick={() => { setVal(lm.label); setEditing(true); }}
        title="Click to rename"
      >
        {lm.label}
      </span>
      <button
        onClick={() => { setVal(lm.label); setEditing(true); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 1 }}
        title="Edit label"
      >
        <Pencil size={8} />
      </button>
      <button
        onClick={() => onRemove(lm.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: 0, lineHeight: 1 }}
        title="Remove landmark"
        data-testid={`landmark-delete-${lm.id}`}
      >
        <X size={9} />
      </button>
    </div>
  );
}

// ── Small draggable asset icon on the canvas ──────────────────────────────────
function PlacedAsset({ asset, x, y, selected, onPointerDown, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const Icon = resolveIcon(asset.asset_type_icon_hint);

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
  const [draggingLandmark, setDraggingLandmark] = useState(null);
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
    if (draggingLandmark) {
      const pos = getCanvasPercent(e.clientX, e.clientY);
      if (!pos) return;
      setLocalLandmarks(prev => prev.map(l => l.id === draggingLandmark ? { ...l, x: pos.x, y: pos.y } : l));
      return;
    }
    if (!dragging) return;
    const pos = getCanvasPercent(e.clientX, e.clientY);
    if (!pos) return;
    setPositions(prev => ({ ...prev, [dragging.assetId]: pos }));
  }, [dragging, draggingLandmark]); // eslint-disable-line

  const handleCanvasPointerUp = useCallback(() => { setDragging(null); setDraggingLandmark(null); }, []);

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

  const renameLandmark = (lmId, newLabel) => {
    setLocalLandmarks(prev => prev.map(l => l.id === lmId ? { ...l, label: newLabel } : l));
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

      // 2. Sync landmarks: delete removed, create new, UPDATE moved (track failures)
      const originalMap = new Map((landmarks || []).map(l => [l.id, l]));
      const currentIds = new Set(localLandmarks.filter(l => !l._new).map(l => l.id));

      const failures = [];
      // Delete removed landmarks
      for (const [id] of originalMap) {
        if (!currentIds.has(id)) {
          try {
            await canvasLandmarksAPI.delete(id);
          } catch (err) {
            console.error('Landmark delete failed', id, err);
            failures.push({ op: 'delete', label: id, err: String(err?.response?.data?.detail || err?.message || err) });
          }
        }
      }

      // Update moved/edited existing landmarks
      let updated = 0;
      for (const lm of localLandmarks) {
        if (lm._new) continue;
        const orig = originalMap.get(lm.id);
        if (!orig) continue;
        // Check if position or label changed
        if (orig.x !== lm.x || orig.y !== lm.y || orig.label !== lm.label) {
          try {
            await canvasLandmarksAPI.update(lm.id, {
              sub_zone_id: subZone.id,
              location_id: subZone.location_id || '',
              station_id: subZone.station_id || '',
              label: lm.label,
              x: lm.x,
              y: lm.y,
              landmark_type: lm.landmark_type || 'pole',
            });
            updated += 1;
          } catch (err) {
            console.error('Landmark update failed', lm, err);
            const detail = err?.response?.data?.detail || err?.message || 'unknown error';
            failures.push({ op: 'update', label: lm.label, err: detail });
          }
        }
      }

      // Create new landmarks
      const toCreate = localLandmarks.filter(l => l._new);
      let created = 0;
      for (const lm of toCreate) {
        try {
          await canvasLandmarksAPI.create({
            sub_zone_id: subZone.id,
            location_id: subZone.location_id || '',
            station_id: subZone.station_id || '',
            label: lm.label || 'Marker',
            x: lm.x,
            y: lm.y,
            landmark_type: lm.landmark_type || 'pole',
          });
          created += 1;
        } catch (err) {
          console.error('Landmark create failed', lm, err);
          const detail = err?.response?.data?.detail || err?.message || 'unknown error';
          failures.push({ op: 'create', label: lm.label || '(unnamed)', err: detail });
        }
      }

      if (failures.length > 0) {
        const firstErr = failures[0];
        toast.error(
          `Saved positions, but ${failures.length} landmark${failures.length !== 1 ? 's' : ''} failed: ${firstErr.label} — ${firstErr.err}`,
          { duration: 7000 },
        );
      } else {
        const parts = [];
        if (created > 0) parts.push(`${created} added`);
        if (updated > 0) parts.push(`${updated} moved`);
        toast.success(`Canvas layout saved${parts.length ? ' · ' + parts.join(', ') : ''}`);
      }
      if (onSave) onSave();
    } catch (e) {
      console.error('Canvas save failed', e);
      toast.error(e?.response?.data?.detail || e?.message || 'Failed to save layout');
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

              {/* Landmarks — draggable */}
              {localLandmarks.map(lm => (
                <div
                  key={lm.id}
                  style={{ position: 'absolute', left: `${lm.x}%`, top: `${lm.y}%`, transform: 'translate(-50%, -100%)', zIndex: 15, cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDraggingLandmark(lm.id); }}
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
          {/* Landmark editor panel */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Landmarks ({localLandmarks.length})</span>
            </div>
            {localLandmarks.length === 0 && (
              <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: '6px 0' }}>
                No landmarks yet
              </div>
            )}
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {localLandmarks.map(lm => (
                <LandmarkEditorRow key={lm.id} lm={lm} onRename={renameLandmark} onRemove={removeLandmark} />
              ))}
            </div>
            {/* Add single landmark */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <Input
                value={lmLabel}
                onChange={e => setLmLabel(e.target.value)}
                placeholder="P.No 27"
                className="h-6 text-xs flex-1"
                data-testid="landmark-label-input"
                onKeyDown={e => { if (e.key === 'Enter' && lmLabel.trim()) { setLmPlaceMode(true); } }}
              />
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6 shrink-0"
                disabled={!lmLabel.trim()}
                onClick={() => { if (lmLabel.trim()) setLmPlaceMode(true); }}
                title="Place on canvas"
                data-testid="landmark-add-btn"
              >
                <Plus size={11} />
              </Button>
            </div>
            {/* Batch add landmarks */}
            <button
              type="button"
              onClick={() => {
                const input = prompt('Batch add landmarks.\nFormat: "P.No 1-10" or comma-separated "P.No 1, P.No 2, HWH END"');
                if (!input) return;
                const trimmed = input.trim();
                // Try range pattern: "P.No 1-10" or "Pillar 5-20"
                const rangeMatch = trimmed.match(/^(.+?)(\d+)\s*-\s*(\d+)$/);
                if (rangeMatch) {
                  const prefix = rangeMatch[1];
                  const start = parseInt(rangeMatch[2], 10);
                  const end = parseInt(rangeMatch[3], 10);
                  if (!isNaN(start) && !isNaN(end) && end >= start && (end - start) < 100) {
                    const newLandmarks = [];
                    for (let i = start; i <= end; i++) {
                      newLandmarks.push({
                        id: `new-batch-${Date.now()}-${i}`,
                        label: `${prefix}${i}`,
                        x: 5 + ((i - start) / Math.max(1, end - start)) * 90,
                        y: 90,
                        landmark_type: 'pole',
                        _new: true,
                      });
                    }
                    setLocalLandmarks(prev => [...prev, ...newLandmarks]);
                    toast.success(`Added ${newLandmarks.length} landmarks. Drag them to correct positions.`);
                    return;
                  }
                }
                // Fallback: comma-separated
                const labels = trimmed.split(',').map(s => s.trim()).filter(Boolean);
                if (labels.length > 0) {
                  const newLandmarks = labels.map((label, i) => ({
                    id: `new-batch-${Date.now()}-${i}`,
                    label,
                    x: 5 + (i / Math.max(1, labels.length - 1)) * 90,
                    y: 90,
                    landmark_type: 'pole',
                    _new: true,
                  }));
                  setLocalLandmarks(prev => [...prev, ...newLandmarks]);
                  toast.success(`Added ${newLandmarks.length} landmarks. Drag them to correct positions.`);
                }
              }}
              style={{
                width: '100%', marginTop: 4, padding: '3px 0',
                fontSize: 9, color: '#0891b2', background: 'none',
                border: '1px dashed #bae6fd', borderRadius: 6, cursor: 'pointer',
              }}
              data-testid="landmark-batch-add"
            >
              + Batch Add (e.g. P.No 1-10)
            </button>
          </div>

          {/* Unpositioned assets */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, flex: 1, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Unpositioned ({unpositionedAssets.length})
            </div>
            {unpositionedAssets.length === 0 ? (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>All placed</div>
            ) : unpositionedAssets.map(asset => {
              const Icon = resolveIcon(asset.asset_type_icon_hint);
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
