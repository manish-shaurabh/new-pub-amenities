/**
 * StationCanvasPage — "Platform Vision" — full-page asset health blueprint.
 *
 * Route: /station-canvas
 *
 * Shows the Platform Blueprint for any station/location.
 * Admins can open the CanvasEditor per sub-zone to position assets.
 * All users can browse the live health status sketch.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Filter, ChevronDown, RefreshCw, Pencil, X, Info,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { toast } from 'sonner';

import PlatformBlueprint from '../components/PlatformBlueprint';
import CanvasEditor from '../components/CanvasEditor';
import {
  stationCanvasAPI, stationsAPI, locationsAPI,
  departmentsAPI, assetTypesAPI, assetsAPI, canvasLandmarksAPI,
  subZonesAPI,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

export default function StationCanvasPage() {
  const { user, isAdmin: isAdminFn } = useAuth();

  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [departments, setDepartments] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);

  const [canvasData, setCanvasData] = useState(null);  // { locations: [...] }
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterDept, setFilterDept] = useState('');
  const [filterType, setFilterType] = useState('');

  // Canvas editor modal
  const [editingSubZone, setEditingSubZone] = useState(null);  // sub-zone doc
  const [editorAssets, setEditorAssets] = useState([]);
  const [editorLandmarks, setEditorLandmarks] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);

  const isAdmin = isAdminFn();

  // Load static data
  useEffect(() => {
    Promise.all([stationsAPI.list(), departmentsAPI.list()]).then(([sRes, dRes]) => {
      setStations(sRes.data || []);
      setDepartments(dRes.data || []);
    });
  }, []);

  useEffect(() => {
    if (!selectedStation) { setLocations([]); setSelectedLocation(''); return; }
    locationsAPI.list({ station_id: selectedStation }).then(res => {
      const locs = res.data || [];
      setLocations(locs);
      if (locs.length > 0) setSelectedLocation(locs[0].id || locs[0]._id);
    });
  }, [selectedStation]);

  useEffect(() => {
    if (!selectedStation) return;
    assetTypesAPI.list().then(res => setAssetTypes(res.data || []));
  }, [selectedStation]);

  // Load canvas data
  const loadCanvas = useCallback(async () => {
    if (!selectedLocation && !selectedStation) return;
    setLoading(true);
    try {
      const params = selectedLocation
        ? { location_id: selectedLocation }
        : { station_id: selectedStation };
      const res = await stationCanvasAPI.get(params);
      setCanvasData(res.data);
    } catch (e) {
      toast.error('Failed to load canvas data');
    } finally {
      setLoading(false);
    }
  }, [selectedLocation, selectedStation]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  // Derive selected location data from canvas response
  const displayLocations = canvasData?.locations || [];
  const activeLocationData = selectedLocation
    ? displayLocations.find(l => l.id === selectedLocation)
    : displayLocations[0];

  // Open canvas editor for a sub-zone
  const openEditor = async (sz) => {
    try {
      // Fetch assets for this sub-zone
      const [assetsRes, lmRes] = await Promise.all([
        assetsAPI.list({ sub_zone_id: sz.id }),
        canvasLandmarksAPI.list({ sub_zone_id: sz.id }),
      ]);
      // Fetch sub-zone doc to get station/location ids
      const szDoc = await subZonesAPI.list({ location_id: sz.location_id || activeLocationData?.id })
        .then(r => (r.data || []).find(s => s.id === sz.id) || sz);

      setEditingSubZone({ ...sz, ...szDoc });
      setEditorAssets(
        (assetsRes.data || []).map(a => ({
          id: a.id || a._id,
          asset_number: a.asset_number,
          asset_type_id: a.asset_type_id,
          asset_type_name: a.asset_type_name || '',
          asset_type_icon_hint: a.asset_type_icon_hint || 'default',
          status: a.status || 'working',
          canvas_x: a.canvas_x,
          canvas_y: a.canvas_y,
        }))
      );
      setEditorLandmarks(lmRes.data || []);
      setEditorOpen(true);
    } catch (e) {
      toast.error('Failed to load sub-zone data');
    }
  };

  const handleEditorSave = () => {
    setEditorOpen(false);
    setEditingSubZone(null);
    loadCanvas();
    toast.success('Canvas layout updated');
  };

  const filters = {
    dept_id: filterDept || undefined,
    asset_type_id: filterType || undefined,
  };
  const hasFilters = !!(filterDept || filterType);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '12px 20px', display: 'flex', alignItems: 'center',
        flexWrap: 'wrap', gap: 10,
        position: 'sticky', top: 0, zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <MapPin size={18} style={{ color: '#0891b2' }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Platform Vision</span>
          <Badge variant="outline" style={{ fontSize: 10 }}>BETA</Badge>
        </div>

        {/* Station selector */}
        <Select value={selectedStation} onValueChange={setSelectedStation}>
          <SelectTrigger className="w-44 h-8 text-sm" data-testid="canvas-station-select">
            <SelectValue placeholder="Select station" />
          </SelectTrigger>
          <SelectContent>
            {stations.map(s => (
              <SelectItem key={s.id || s._id} value={s.id || s._id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Location tabs */}
        {locations.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {locations.map(loc => {
              const locId = loc.id || loc._id;
              return (
                <button
                  key={locId}
                  onClick={() => setSelectedLocation(locId)}
                  data-testid={`canvas-loc-tab-${locId}`}
                  style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    border: `1.5px solid ${selectedLocation === locId ? '#0891b2' : '#e2e8f0'}`,
                    background: selectedLocation === locId ? '#e0f2fe' : '#fff',
                    color: selectedLocation === locId ? '#0891b2' : '#64748b',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {loc.name}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Filter size={13} style={{ color: '#94a3b8' }} />

          <Select value={filterDept || '__all__'} onValueChange={v => setFilterDept(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-36 h-7 text-xs">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Departments</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id || d._id} value={d.id || d._id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterType || '__all__'} onValueChange={v => setFilterType(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-36 h-7 text-xs">
              <SelectValue placeholder="All Asset Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Asset Types</SelectItem>
              {assetTypes.map(t => (
                <SelectItem key={t.id || t._id} value={t.id || t._id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <button
              onClick={() => { setFilterDept(''); setFilterType(''); }}
              style={{ fontSize: 11, color: '#ef4444', cursor: 'pointer', background: 'none', border: 'none' }}
            >
              <X size={14} />
            </button>
          )}

          <button
            onClick={loadCanvas}
            disabled={loading}
            style={{ background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', color: '#94a3b8' }}
            title="Refresh"
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
        {!selectedStation && (
          <div style={{
            textAlign: 'center', padding: '80px 20px', color: '#94a3b8',
          }}>
            <MapPin size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <div style={{ fontSize: 16, fontWeight: 500 }}>Select a station to view the Platform Blueprint</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              The blueprint shows all assets at their approximate physical positions with live health status.
            </div>
          </div>
        )}

        {selectedStation && loading && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <RefreshCw size={24} style={{ margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
            <div>Loading canvas data…</div>
          </div>
        )}

        {selectedStation && !loading && activeLocationData && (
          <>
            {/* Location name */}
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                {activeLocationData.name}
              </h2>
              {isAdmin && (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Click <Pencil size={10} style={{ display: 'inline' }} /> on any sub-zone to edit asset positions
                </span>
              )}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { color: '#22c55e', label: 'Working' },
                { color: '#eab308', label: 'Pending Approval' },
                { color: '#f97316', label: 'Orange List' },
                { color: '#ef4444', label: 'Red List (>24h)' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
                  <span style={{ color: '#64748b' }}>{label}</span>
                </div>
              ))}
            </div>

            <PlatformBlueprint
              locationData={activeLocationData}
              mode="health"
              filters={filters}
              onAssetClick={(asset) => {
                // Clicking in health view — could open AssetHistoryDrawer in future
                toast.info(`${asset.asset_number}: ${asset.asset_type_name} — ${asset.status}`);
              }}
              onEditCanvas={isAdmin ? (sz) => openEditor({ ...sz, location_id: activeLocationData.id }) : undefined}
            />
          </>
        )}

        {selectedStation && !loading && !activeLocationData && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <Info size={32} style={{ margin: '0 auto 10px' }} />
            <div>No location data found for this station.</div>
          </div>
        )}
      </div>

      {/* Canvas Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={(o) => !o && setEditorOpen(false)}>
        <DialogContent
          className="max-w-5xl w-full"
          style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        >
          <DialogHeader>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pencil size={16} />
              Edit Canvas Layout: {editingSubZone?.name}
            </DialogTitle>
          </DialogHeader>
          <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
            {editingSubZone && (
              <CanvasEditor
                subZone={editingSubZone}
                assets={editorAssets}
                landmarks={editorLandmarks}
                onSave={handleEditorSave}
                onClose={() => setEditorOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
