/**
 * AssetDropPopover — slim popover shown after dropping an asset type tile
 * onto the canvas. Pre-fills the server-generated asset code and lets the
 * admin override it or just press Enter to commit.
 *
 * Detail mode (default per product decision): one editable field for the code,
 * one optional description, and `total_count` if the type is "grouped".
 */
import { useEffect, useRef, useState } from 'react';
import { X, Hash, AlertCircle, MapPin } from 'lucide-react';
import { resolveIcon, getIconHint } from '../lib/assetIcons';
import { Circle } from 'lucide-react';
import { assetsAPI } from '../lib/api';
import { toast } from 'sonner';

export default function AssetDropPopover({
  assetType,
  stationId,
  locationId,
  subZoneId,
  canvasX,
  canvasY,
  onCreated,
  onClose,
}) {
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [totalCount, setTotalCount] = useState('');
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isGrouped = (assetType?.tracking_mode || 'individual') === 'grouped';
  const iconKey = assetType?.icon_key || getIconHint(assetType?.name || '');
  const Icon = resolveIcon(iconKey);

  // Fetch the preview code on mount
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    assetsAPI.previewCode({
      asset_type_id: assetType.id || assetType._id,
      station_id: stationId,
      location_id: locationId || undefined,
      sub_zone_id: subZoneId || undefined,
    }).then(res => {
      if (!alive) return;
      setCode(res.data.preview_code);
      setContext(res.data.context);
    }).catch(err => {
      if (!alive) return;
      setError(err?.response?.data?.detail || 'Could not preview code');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [assetType, stationId, locationId, subZoneId]);

  // Focus the input when the code arrives
  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [loading]);

  // Escape to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError('Asset code is required');
      return;
    }
    if (isGrouped) {
      const tc = parseInt(totalCount, 10);
      if (!tc || tc <= 0) {
        setError('Total count must be a positive number');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const res = await assetsAPI.autoCreate({
        asset_type_id: assetType.id || assetType._id,
        station_id: stationId,
        location_id: locationId || undefined,
        sub_zone_id: subZoneId || undefined,
        canvas_x: canvasX,
        canvas_y: canvasY,
        description: description.trim() || undefined,
        asset_number_override: code.trim(),
        total_count: isGrouped ? parseInt(totalCount, 10) : undefined,
      });
      toast.success(`${res.data.asset_number} created`);
      onCreated(res.data);
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Failed to create asset';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      data-testid="asset-drop-popover"
      style={{
        background: '#fff',
        border: '1.5px solid #0891b2',
        borderRadius: 12,
        padding: '14px 16px',
        width: 320,
        boxShadow: '0 12px 40px rgba(15,23,42,0.18)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '2px solid #0891b2',
          background: 'rgba(8,145,178,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#0891b2', flexShrink: 0,
        }}>
          <Icon size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            New {assetType.name}
          </div>
          {context && (
            <div style={{
              fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3,
              marginTop: 1,
            }}>
              <MapPin size={9} />
              {context.sub_zone
                ? <>{context.station} · {context.location} · <b>{context.sub_zone}</b></>
                : context.location
                  ? <>{context.station} · {context.location} · <span style={{ color: '#a16207' }}>Unassigned to Sub-Zone</span></>
                  : <>{context.station} · <span style={{ color: '#a16207' }}>Station-level</span></>
              }
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          data-testid="asset-drop-popover-close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#94a3b8', padding: 0, marginLeft: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Code field */}
      <div style={{ marginBottom: 10 }}>
        <label style={{
          fontSize: 10, fontWeight: 600, color: '#475569',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4,
        }}>
          <Hash size={9} /> Asset Code
        </label>
        <input
          ref={inputRef}
          data-testid="asset-drop-code-input"
          value={loading ? 'Generating…' : code}
          onChange={(e) => setCode(e.target.value)}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
          }}
          style={{
            width: '100%', padding: '6px 10px',
            fontFamily: 'monospace', fontSize: 12, color: '#0f172a',
            border: '1.5px solid #e2e8f0', borderRadius: 7,
            outline: 'none', background: loading ? '#f1f5f9' : '#fff',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#0891b2'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3 }}>
          Server-generated — edit if you have a custom convention
        </div>
      </div>

      {/* Total count (grouped only) */}
      {isGrouped && (
        <div style={{ marginBottom: 10 }}>
          <label style={{
            fontSize: 10, fontWeight: 600, color: '#475569',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            display: 'block', marginBottom: 4,
          }}>
            Total Count (units in this group)
          </label>
          <input
            type="number"
            data-testid="asset-drop-total-count"
            value={totalCount}
            onChange={(e) => setTotalCount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
            }}
            min="1"
            placeholder="e.g. 120"
            style={{
              width: '100%', padding: '6px 10px',
              fontSize: 12, color: '#0f172a',
              border: '1.5px solid #e2e8f0', borderRadius: 7,
              outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = '#0891b2'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
      )}

      {/* Description */}
      <div style={{ marginBottom: 12 }}>
        <label style={{
          fontSize: 10, fontWeight: 600, color: '#475569',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          display: 'block', marginBottom: 4,
        }}>
          Description <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8' }}>(optional)</span>
        </label>
        <input
          data-testid="asset-drop-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
          }}
          placeholder="Brief description"
          style={{
            width: '100%', padding: '6px 10px',
            fontSize: 12, color: '#0f172a',
            border: '1.5px solid #e2e8f0', borderRadius: 7,
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#0891b2'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          data-testid="asset-drop-error"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 6,
            fontSize: 11, color: '#dc2626',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 6, padding: '6px 10px', marginBottom: 10,
          }}
        >
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onClose}
          data-testid="asset-drop-cancel"
          disabled={saving}
          style={{
            flex: 1, padding: '7px 0', borderRadius: 7,
            border: '1px solid #e2e8f0', background: '#fff',
            fontSize: 12, color: '#64748b',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          data-testid="asset-drop-confirm"
          disabled={saving || loading}
          style={{
            flex: 1.4, padding: '7px 0', borderRadius: 7,
            border: 'none',
            background: (saving || loading) ? '#94a3b8' : '#0891b2',
            color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: (saving || loading) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Creating…' : 'Create Asset (Enter)'}
        </button>
      </div>
    </div>
  );
}
