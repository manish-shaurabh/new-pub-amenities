/**
 * StationCanvasPage — "Platform Vision"
 *
 * View mode:  Live health overview of all assets on a platform.
 * Edit mode:  Create/edit/delete assets, manage sub-zones & locations,
 *             drag asset types from palette to place on canvas.
 *
 * Route: /station-canvas
 * Access: All roles (view). SA / Admin / Divisional Admin (edit).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MapPin, Filter, RefreshCw, Pencil, X, Plus, Download,
  LayoutGrid, Eye, Info, Trash2, ChevronDown, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';

import PlatformBlueprint from '../components/PlatformBlueprint';
import AssetTypePalette from '../components/AssetTypePalette';
import AssetDropPopover from '../components/AssetDropPopover';
import CanvasEditor from '../components/CanvasEditor';
import MobileCanvasHeader from '../components/MobileCanvasHeader';
import {
  stationCanvasAPI, stationsAPI, locationsAPI,
  departmentsAPI, assetTypesAPI, assetsAPI,
  canvasLandmarksAPI, subZonesAPI,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getIconHint } from '../lib/assetIcons';

// ── Sub-Zone mini form ────────────────────────────────────────────────────────
function SubZoneForm({ locationId, stationId, existingSubZone, onSave, onClose }) {
  const [name, setName] = useState(existingSubZone?.name || '');
  const [code, setCode] = useState(existingSubZone?.code || '');
  const [hasDivider, setHasDivider] = useState(existingSubZone?.has_divider || false);
  const [dividerDir, setDividerDir] = useState(existingSubZone?.divider_orientation || 'vertical');
  const [startPillar, setStartPillar] = useState(existingSubZone?.start_pillar || '');
  const [endPillar, setEndPillar] = useState(existingSubZone?.end_pillar || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Sub-zone name required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), code: code.trim(),
        station_id: stationId, location_id: locationId,
        has_divider: hasDivider, divider_orientation: dividerDir,
        start_pillar: startPillar.trim() || null,
        end_pillar: endPillar.trim() || null,
        order: existingSubZone?.order,  // omit on create → backend assigns next slot
      };
      if (existingSubZone?.id) {
        await subZonesAPI.update(existingSubZone.id, payload);
        toast.success('Sub-zone updated');
      } else {
        await subZonesAPI.create(payload);
        toast.success('Sub-zone created');
      }
      onSave();
    } catch (e) {
      toast.error('Failed to save sub-zone');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Label className="text-xs">Sub-Zone Name *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Waiting Area" className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Code (optional)</Label>
        <Input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. SZ-A" className="mt-1 h-8 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Start Pillar (left edge)</Label>
          <Input
            value={startPillar}
            onChange={e => setStartPillar(e.target.value)}
            placeholder="e.g. P12"
            className="mt-1 h-8 text-sm"
            data-testid="subzone-start-pillar"
          />
        </div>
        <div>
          <Label className="text-xs">End Pillar (right edge)</Label>
          <Input
            value={endPillar}
            onChange={e => setEndPillar(e.target.value)}
            placeholder="e.g. P18"
            className="mt-1 h-8 text-sm"
            data-testid="subzone-end-pillar"
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="divider-check" checked={hasDivider} onCheckedChange={setHasDivider} />
        <Label htmlFor="divider-check" className="cursor-pointer text-sm">Show center dividing line</Label>
        {hasDivider && (
          <Select value={dividerDir} onValueChange={setDividerDir}>
            <SelectTrigger className="h-7 text-xs w-28 ml-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vertical">Vertical</SelectItem>
              <SelectItem value="horizontal">Horizontal</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : existingSubZone ? 'Update' : 'Create Sub-Zone'}
        </Button>
      </div>
    </div>
  );
}

// ── Location mini form ────────────────────────────────────────────────────────
function LocationForm({ stationId, onSave, onClose }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Location name required'); return; }
    setSaving(true);
    try {
      await locationsAPI.create({ name: name.trim(), code: code.trim(), station_id: stationId });
      toast.success(`Location "${name}" created`);
      onSave();
    } catch (e) {
      toast.error('Failed to create location');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Label className="text-xs">Location Name *</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Platform 9" className="mt-1" autoFocus />
      </div>
      <div>
        <Label className="text-xs">Code (optional)</Label>
        <Input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. PF-9" className="mt-1 h-8 text-sm" />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '…' : 'Create Location'}</Button>
      </div>
    </div>
  );
}

// ── Force delete sub-zone confirmation ────────────────────────────────────────
function ForceDeleteSubZoneDialog({ assetCount, onConfirm, onCancel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        This sub-zone has <strong style={{ color: '#0f172a' }}>{assetCount} asset(s)</strong> assigned.
        Deleting will <strong>unassign them</strong> (remove sub-zone + canvas position) but will <strong>NOT delete</strong> the assets.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>Delete & Unassign</Button>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function StationCanvasPage() {
  const { user, isAdmin: isAdminFn } = useAuth();
  const canEdit = isAdminFn?.() || user?.role === 'SA' || user?.role === 'superadmin' || ['superadmin', 'admin', 'divisional_admin'].includes(user?.role);

  // -- Station / Location state --
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [selectedStationDoc, setSelectedStationDoc] = useState(null);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [departments, setDepartments] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [canvasData, setCanvasData] = useState(null);
  const [loading, setLoading] = useState(false);

  // -- Filters --
  const [filterDept, setFilterDept] = useState('');
  const [filterType, setFilterType] = useState('');

  // -- Edit mode --
  const [editMode, setEditMode] = useState(false);
  const [selectedPaletteType, setSelectedPaletteType] = useState(null);

  // -- Placement (new drop popover) --
  const [pendingPlacement, setPendingPlacement] = useState(null); // { assetType, subZoneId, locationId, x, y }

  // -- Delete confirmation --
  const [deleteAsset, setDeleteAssetTarget] = useState(null);  // asset to confirm deletion

  // -- Edit asset dialog --
  const [editAsset, setEditAsset] = useState(null);
  const [editAssetForm, setEditAssetForm] = useState({ asset_number: '', description: '' });

  // -- Sub-zone management --
  const [subZoneFormFor, setSubZoneFormFor] = useState(null);  // locationId or subZone obj
  const [forceDeleteSZ, setForceDeleteSZ] = useState(null);    // { id, count }

  // -- Location management --
  const [showLocationForm, setShowLocationForm] = useState(false);

  // -- Canvas editor (repositioning) --
  const [canvasEditorSZ, setCanvasEditorSZ] = useState(null);
  const [editorAssets, setEditorAssets] = useState([]);
  const [editorLandmarks, setEditorLandmarks] = useState([]);

  const isAdmin = canEdit;

  // Load statics
  useEffect(() => {
    Promise.all([stationsAPI.list(), departmentsAPI.list()])
      .then(([s, d]) => {
        setStations(s.data || []);
        setDepartments(d.data || []);
      });
  }, []);

  useEffect(() => {
    if (!selectedStation) { setLocations([]); setSelectedLocation(''); return; }
    const doc = stations.find(s => (s.id || s._id) === selectedStation);
    setSelectedStationDoc(doc || null);
    Promise.all([
      locationsAPI.list({ station_id: selectedStation }),
      assetTypesAPI.list(),
    ]).then(([l, t]) => {
      const locs = l.data || [];
      setLocations(locs);
      if (locs.length && !selectedLocation) setSelectedLocation(locs[0].id || locs[0]._id);
      setAssetTypes(t.data || []);
    });
  }, [selectedStation]); // eslint-disable-line

  const loadCanvas = useCallback(async () => {
    if (!selectedLocation && !selectedStation) return;
    setLoading(true);
    try {
      const params = selectedLocation ? { location_id: selectedLocation } : { station_id: selectedStation };
      const res = await stationCanvasAPI.get(params);
      setCanvasData(res.data);
    } catch { toast.error('Failed to load canvas'); }
    finally { setLoading(false); }
  }, [selectedLocation, selectedStation]);

  useEffect(() => { loadCanvas(); }, [loadCanvas]);

  const activeLocationData = (canvasData?.locations || []).find(l => l.id === selectedLocation)
    || canvasData?.locations?.[0];

  // ── PDF Export ──────────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (!activeLocationData) return;
    const el = document.getElementById('platform-blueprint-root');
    if (!el) return;
    toast.info('Generating PDF…');
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fff' });
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pdfW) / canvas.width;
      const stName = selectedStationDoc?.name || 'Station';
      const locName = activeLocationData?.name || '';
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${stName} — ${locName}`, 10, 10);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 10, 16);
      const imgData = canvas.toDataURL('image/png');
      const yOffset = 20;
      if (imgH + yOffset > pdfH) {
        let posY = yOffset;
        let remaining = imgH;
        let sliceFrom = 0;
        while (remaining > 0) {
          const sliceH = Math.min(pdfH - yOffset, remaining);
          pdf.addImage(imgData, 'PNG', 0, posY, pdfW, imgH, '', 'FAST', 0);
          remaining -= sliceH;
          if (remaining > 0) { pdf.addPage(); posY = yOffset; sliceFrom += sliceH; }
        }
      } else {
        pdf.addImage(imgData, 'PNG', 0, yOffset, pdfW, imgH);
      }
      const safeFileName = `${stName}-${locName}-blueprint.pdf`.replace(/[^a-z0-9._-]/gi, '_');
      pdf.save(safeFileName);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error('PDF generation failed');
      console.error(err);
    }
  };

  // ── Asset placement ─────────────────────────────────────────────────────────
  const handleCanvasAreaClick = (subZoneId, x, y) => {
    if (!editMode || !selectedPaletteType) return;
    const locationId = activeLocationData?.id || selectedLocation;
    const realSubZoneId = subZoneId && subZoneId !== '__unzoned__' ? subZoneId : null;
    setPendingPlacement({ assetType: selectedPaletteType, subZoneId: realSubZoneId, locationId, x, y });
  };

  const handleCanvasDrop = (e, subZoneId, x, y) => {
    if (!editMode) return;
    const atId = e.dataTransfer.getData('assetTypeId');
    const type = assetTypes.find(t => (t.id || t._id) === atId);
    if (!type) return;
    setSelectedPaletteType(type);
    const locationId = activeLocationData?.id || selectedLocation;
    const realSubZoneId = subZoneId && subZoneId !== '__unzoned__' ? subZoneId : null;
    setPendingPlacement({ assetType: type, subZoneId: realSubZoneId, locationId, x, y });
  };

  // ── Asset actions ───────────────────────────────────────────────────────────
  const handleAssetAction = (asset, subZoneId, action) => {
    if (action === 'edit') {
      setEditAsset(asset);
      setEditAssetForm({ asset_number: asset.asset_number, description: asset.description || '' });
    } else if (action === 'delete') {
      setDeleteAssetTarget(asset);
    } else if (action === 'toggle_missing') {
      const newStatus = asset.status === 'missing' ? 'working' : 'missing';
      assetsAPI.patchStatus(asset.id, newStatus)
        .then(() => {
          toast.success(newStatus === 'missing' ? 'Marked as missing' : 'Marked as working');
          loadCanvas();
        })
        .catch(() => toast.error('Failed to update status'));
    } else if (action === 'move') {
      toast.info('Use the canvas editor (pencil icon) to reposition assets precisely');
    }
  };

  const handleConfirmDeleteAsset = async () => {
    if (!deleteAsset) return;
    try {
      await assetsAPI.delete(deleteAsset.id);
      toast.success(`${deleteAsset.asset_number} deleted`);
      setDeleteAssetTarget(null);
      loadCanvas();
    } catch {
      toast.error('Failed to delete asset');
    }
  };

  const handleEditAssetSave = async () => {
    if (!editAsset) return;
    try {
      await assetsAPI.update(editAsset.id, {
        asset_type_id: editAsset.asset_type_id,
        station_id: selectedStation,
        location_id: editAsset.location_id || activeLocationData?.id,
        sub_zone_id: editAsset.sub_zone_id || null,
        asset_number: editAssetForm.asset_number,
        description: editAssetForm.description,
        canvas_x: editAsset.canvas_x ?? null,
        canvas_y: editAsset.canvas_y ?? null,
      });
      toast.success('Asset updated');
      setEditAsset(null);
      loadCanvas();
    } catch { toast.error('Failed to update asset'); }
  };

  // ── Sub-zone management ─────────────────────────────────────────────────────
  const handleMoveSubZone = async (sz, direction, idx) => {
    const subZones = activeLocationData?.sub_zones || [];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= subZones.length) return;
    // Build the new full order (rotate the target by one slot) and let the
    // server assign deterministic 0..N-1 values so duplicate `order` ties can
    // never deadlock the up/down controls again.
    const orderedIds = subZones.map(s => s.id);
    [orderedIds[idx], orderedIds[swapIdx]] = [orderedIds[swapIdx], orderedIds[idx]];
    try {
      await subZonesAPI.reorder(activeLocationData.id, orderedIds);
      loadCanvas();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to reorder');
    }
  };

  const handleDeleteSubZone = async (szId) => {
    try {
      await subZonesAPI.delete(szId, false);
      toast.success('Sub-zone deleted');
      loadCanvas();
    } catch (e) {
      const msg = e?.response?.data?.detail || '';
      if (msg.startsWith('ASSETS_ASSIGNED:')) {
        setForceDeleteSZ({ id: szId, count: parseInt(msg.split(':')[1], 10) });
      } else {
        toast.error('Failed to delete sub-zone');
      }
    }
  };

  const handleForceDeleteSubZone = async () => {
    if (!forceDeleteSZ) return;
    try {
      await subZonesAPI.delete(forceDeleteSZ.id, true);
      toast.success('Sub-zone deleted and assets unassigned');
      setForceDeleteSZ(null);
      loadCanvas();
    } catch { toast.error('Failed to force-delete sub-zone'); }
  };

  // ── Canvas editor (repositioning) ───────────────────────────────────────────
  const openCanvasEditor = async (sz) => {
    try {
      const [ar, lr] = await Promise.all([
        assetsAPI.list({ sub_zone_id: sz.id }),
        canvasLandmarksAPI.list({ sub_zone_id: sz.id }),
      ]);
      setCanvasEditorSZ({ id: sz.id, name: sz.name, location_id: activeLocationData?.id, station_id: selectedStation, has_divider: sz.has_divider, divider_orientation: sz.divider_orientation });
      setEditorAssets((ar.data || []).map(a => ({
        id: a.id || a._id, asset_number: a.asset_number,
        asset_type_id: a.asset_type_id, asset_type_name: a.asset_type_name || '',
        asset_type_icon_hint: a.asset_type_icon_hint || getIconHint(a.asset_type_name || ''),
        status: a.status || 'working', canvas_x: a.canvas_x, canvas_y: a.canvas_y,
      })));
      setEditorLandmarks(lr.data || []);
    } catch { toast.error('Failed to load editor data'); }
  };

  const hasFilters = !!(filterDept || filterType);
  const filters = { dept_id: filterDept || undefined, asset_type_id: filterType || undefined };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f8fafc' }}>
      {/* ── Compact, collapsible header ─────────────────────────────────────── */}
      <MobileCanvasHeader
        stations={stations}
        selectedStation={selectedStation}
        onStationChange={(v) => { setSelectedStation(v); setSelectedLocation(''); setCanvasData(null); }}
        locations={locations}
        selectedLocation={selectedLocation}
        onLocationChange={setSelectedLocation}
        onAddLocation={isAdmin ? () => setShowLocationForm(true) : undefined}
        departments={departments}
        assetTypes={assetTypes}
        filterDept={filterDept}
        filterType={filterType}
        onFilterDeptChange={setFilterDept}
        onFilterTypeChange={setFilterType}
        onRefresh={loadCanvas}
        onDownloadPDF={activeLocationData ? handleDownloadPDF : undefined}
        canEdit={isAdmin && !!selectedStation}
        editMode={editMode}
        onToggleEditMode={() => {
          if (editMode) { setEditMode(false); setSelectedPaletteType(null); setPendingPlacement(null); loadCanvas(); }
          else { setEditMode(true); }
        }}
        loading={loading}
        title="Platform Vision"
      />

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main canvas area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {!selectedStation && (
            <div style={{ textAlign: 'center', padding: '80px 20px', color: '#94a3b8' }}>
              <MapPin size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>Select a station to view the Platform Blueprint</div>
              <div style={{ fontSize: 12, marginTop: 5 }}>Visual health sketch of all assets at their approximate positions</div>
            </div>
          )}

          {selectedStation && loading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <RefreshCw size={22} style={{ margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
              <div>Loading canvas…</div>
            </div>
          )}

          {selectedStation && !loading && activeLocationData && (
            <>
              {/* Location header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  {activeLocationData.name}
                </h2>
                {!editMode && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[
                      { color: '#22c55e', label: 'Working' },
                      { color: '#eab308', label: 'Pending' },
                      { color: '#f97316', label: 'Orange List' },
                      { color: '#ef4444', label: 'Red List' },
                      { color: '#94a3b8', label: 'Missing' },
                    ].map(({ color, label }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                        {label}
                      </div>
                    ))}
                  </div>
                )}
                {editMode && (
                  <div style={{ fontSize: 11, color: '#0891b2', background: '#e0f2fe', padding: '3px 10px', borderRadius: 10 }}>
                    {selectedPaletteType
                      ? `Placing: ${selectedPaletteType.name} — click on canvas or drag from palette`
                      : 'Select an asset type from the palette →'}
                  </div>
                )}
              </div>

              {/* Blueprint */}
              <div style={{ position: 'relative' }}>
                <PlatformBlueprint
                  locationData={activeLocationData}
                  mode="health"
                  filters={!editMode ? filters : undefined}
                  editMode={editMode}
                  onAssetClick={!editMode ? (asset) => toast.info(`${asset.asset_number}: ${asset.asset_type_name}`) : undefined}
                  onAssetAction={editMode ? handleAssetAction : undefined}
                  onCanvasAreaClick={editMode ? handleCanvasAreaClick : undefined}
                  onDragOver={editMode ? (e) => e.preventDefault() : undefined}
                  onDrop={editMode ? handleCanvasDrop : undefined}
                  onMoveSubZone={editMode ? handleMoveSubZone : undefined}
                  onDeleteSubZone={editMode ? handleDeleteSubZone : undefined}
                  onAddSubZone={editMode ? (locationId) => setSubZoneFormFor({ locationId, stationId: selectedStation }) : undefined}
                  onEditCanvas={editMode ? openCanvasEditor : undefined}
                />

                {/* Pending placement drop popover */}
                {pendingPlacement && (
                  <div
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 150, background: 'rgba(15,23,42,0.30)' }}
                    onClick={() => setPendingPlacement(null)}
                  >
                    <div
                      style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AssetDropPopover
                        assetType={pendingPlacement.assetType}
                        stationId={selectedStation}
                        locationId={pendingPlacement.locationId}
                        subZoneId={pendingPlacement.subZoneId}
                        canvasX={pendingPlacement.x}
                        canvasY={pendingPlacement.y}
                        onCreated={() => { setPendingPlacement(null); loadCanvas(); }}
                        onClose={() => setPendingPlacement(null)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {selectedStation && !loading && !activeLocationData && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <Info size={30} style={{ margin: '0 auto 8px' }} />
              <div>No location data found.</div>
              {isAdmin && editMode && (
                <button onClick={() => setShowLocationForm(true)}
                  style={{ marginTop: 10, color: '#0891b2', background: 'none', border: '1px dashed #0891b2', borderRadius: 8, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>
                  + Create First Location
                </button>
              )}
            </div>
          )}
        </div>

        {/* Asset palette (edit mode only) */}
        {editMode && (
          <AssetTypePalette
            assetTypes={assetTypes}
            departments={departments}
            selectedType={selectedPaletteType}
            onSelectType={setSelectedPaletteType}
          />
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Edit asset dialog */}
      <Dialog open={!!editAsset} onOpenChange={o => !o && setEditAsset(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <Label className="text-xs">Asset Number</Label>
              <Input value={editAssetForm.asset_number} onChange={e => setEditAssetForm(f => ({ ...f, asset_number: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={editAssetForm.description} onChange={e => setEditAssetForm(f => ({ ...f, description: e.target.value }))} className="mt-1 h-8 text-sm" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              <Button variant="outline" size="sm" onClick={() => setEditAsset(null)}>Cancel</Button>
              <Button size="sm" onClick={handleEditAssetSave}>Save Changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sub-zone form */}
      <Dialog open={!!subZoneFormFor} onOpenChange={o => !o && setSubZoneFormFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{subZoneFormFor?.id ? 'Edit Sub-Zone' : 'Add Sub-Zone'}</DialogTitle>
          </DialogHeader>
          {subZoneFormFor && (
            <SubZoneForm
              locationId={subZoneFormFor.locationId || activeLocationData?.id}
              stationId={subZoneFormFor.stationId || selectedStation}
              existingSubZone={subZoneFormFor.id ? subZoneFormFor : null}
              onSave={() => { setSubZoneFormFor(null); loadCanvas(); }}
              onClose={() => setSubZoneFormFor(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Location form */}
      <Dialog open={showLocationForm} onOpenChange={o => !o && setShowLocationForm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create New Location</DialogTitle></DialogHeader>
          <LocationForm
            stationId={selectedStation}
            onSave={() => {
              setShowLocationForm(false);
              // Reload locations
              locationsAPI.list({ station_id: selectedStation }).then(r => {
                const locs = r.data || [];
                setLocations(locs);
                loadCanvas();
              });
            }}
            onClose={() => setShowLocationForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Force delete sub-zone */}
      <Dialog open={!!forceDeleteSZ} onOpenChange={o => !o && setForceDeleteSZ(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Sub-Zone?</DialogTitle></DialogHeader>
          {forceDeleteSZ && (
            <ForceDeleteSubZoneDialog
              assetCount={forceDeleteSZ.count}
              onConfirm={handleForceDeleteSubZone}
              onCancel={() => setForceDeleteSZ(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Asset delete confirmation */}
      <AlertDialog open={!!deleteAsset} onOpenChange={o => !o && setDeleteAssetTarget(null)}>
        <AlertDialogContent data-testid="delete-asset-alert">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteAsset && (
                <>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{deleteAsset.asset_number}</span>
                  {' '}({deleteAsset.asset_type_name}) will be permanently deleted along with its
                  inspection history, orange-list entries, and schedules. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="delete-asset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="delete-asset-confirm"
              onClick={handleConfirmDeleteAsset}
              style={{ background: '#dc2626', color: '#fff' }}
            >
              Delete Asset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Canvas Editor (repositioning) */}
      <Dialog open={!!canvasEditorSZ} onOpenChange={o => { if (!o) { setCanvasEditorSZ(null); loadCanvas(); } }}>
        <DialogContent className="max-w-5xl w-full" style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
          <DialogHeader>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pencil size={15} /> Reposition Assets: {canvasEditorSZ?.name}
            </DialogTitle>
          </DialogHeader>
          <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
            {canvasEditorSZ && (
              <CanvasEditor
                subZone={canvasEditorSZ}
                assets={editorAssets}
                landmarks={editorLandmarks}
                onSave={() => { setCanvasEditorSZ(null); loadCanvas(); }}
                onClose={() => { setCanvasEditorSZ(null); loadCanvas(); }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
