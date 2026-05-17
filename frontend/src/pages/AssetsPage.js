import { useState, useEffect, useRef } from 'react';
import { assetsAPI, stationsAPI, locationsAPI, assetTypesAPI, subZonesAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '../components/ui/dropdown-menu';
import { Label } from '../components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Search, Box, Trash2, Pencil, ChevronDown, MoreVertical, AlertTriangle, History, Camera, MapPin, X, CheckSquare } from 'lucide-react';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import MarkDefectiveDialog from '../components/dialogs/MarkDefectiveDialog';
import Pagination from '../components/Pagination';
import exifr from 'exifr';

const PAGE_SIZE = 50;

export default function AssetsPage() {
  const { isAdmin } = useAuth();
  const [assets, setAssets] = useState([]);
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStation, setFilterStation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSubZone, setFilterSubZone] = useState('');
  // Sub-zone filter requires a parent location (so the chip is meaningful)
  const [filterLocation, setFilterLocation] = useState('');
  const [filterLocationOptions, setFilterLocationOptions] = useState([]);
  const [filterSubZoneOptions, setFilterSubZoneOptions] = useState([]);
  // Bulk-assign state
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkTargetSubZone, setBulkTargetSubZone] = useState('');
  const [bulkSubZoneOptions, setBulkSubZoneOptions] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assetHistory, setAssetHistory] = useState(null);
  const [markingAsset, setMarkingAsset] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const searchDebounce = useRef(null);
  const [formData, setFormData] = useState({
    asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: '',
    identification_photo: null, geo_lat: '', geo_lng: '',
    sub_zone_id: '', total_count: '',
  });
  const [subZones, setSubZones] = useState([]);
  const [photoLoading, setPhotoLoading] = useState(false);

  // Currently-selected asset type — drives grouped vs individual form layout
  const selectedAssetType = assetTypes.find(t => t._id === formData.asset_type_id);
  const isGroupedType = (selectedAssetType?.tracking_mode || 'individual') === 'grouped';

  useEffect(() => { loadStaticData(); }, []);

  // Reload assets when search/filters/page change (debounced search)
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      loadAssets();
    }, search ? 300 : 0);
    return () => searchDebounce.current && clearTimeout(searchDebounce.current);
    // eslint-disable-next-line
  }, [search, filterStation, filterStatus, filterLocation, filterSubZone, page]);

  // Reset to page 1 when filters/search change
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [search, filterStation, filterStatus, filterLocation, filterSubZone]);

  // Cascade: station → locations for the filter
  useEffect(() => {
    if (!filterStation || filterStation === 'all') {
      setFilterLocationOptions([]); setFilterLocation(''); setFilterSubZone(''); return;
    }
    locationsAPI.list(filterStation).then(r => setFilterLocationOptions(r.data || [])).catch(() => setFilterLocationOptions([]));
  }, [filterStation]);

  // Cascade: location → sub-zones for the filter
  useEffect(() => {
    if (!filterLocation || filterLocation === 'all') {
      setFilterSubZoneOptions([]); setFilterSubZone(''); return;
    }
    subZonesAPI.list({ location_id: filterLocation }).then(r => setFilterSubZoneOptions(r.data || [])).catch(() => setFilterSubZoneOptions([]));
  }, [filterLocation]);

  const loadStaticData = async () => {
    try {
      const [stationsRes, typesRes] = await Promise.all([
        stationsAPI.list(),
        assetTypesAPI.list()
      ]);
      setStations(stationsRes.data);
      setAssetTypes(typesRes.data);
      // Initial assets load happens via the other effect
    } catch (e) {
      console.error('Failed to load reference data', e);
    }
  };

  const loadAssets = async () => {
    setLoading(true);
    try {
      const opts = { page, pageSize: PAGE_SIZE };
      if (search) opts.search = search;
      if (filterStation && filterStation !== 'all') opts.station_id = filterStation;
      if (filterLocation && filterLocation !== 'all') opts.location_id = filterLocation;
      if (filterSubZone && filterSubZone !== 'all') opts.sub_zone_id = filterSubZone;
      if (filterStatus && filterStatus !== 'all') opts.status = filterStatus;
      const res = await assetsAPI.listPaginated(opts);
      setAssets(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch (e) {
      console.error('Failed to load assets', e);
    } finally {
      setLoading(false);
    }
  };

  // Convenience for child components that mutate (create/edit/delete/mark-defective)
  const loadAll = () => loadAssets();

  const loadLocations = async (stationId) => {
    if (stationId) {
      const res = await locationsAPI.list(stationId);
      setLocations(res.data);
    }
  };

  // Load sub-zones for a given location (used by grouped asset form)
  const loadSubZonesFor = async (locationId) => {
    if (!locationId) { setSubZones([]); return; }
    try {
      const r = await subZonesAPI.list({ location_id: locationId });
      setSubZones(r.data || []);
    } catch { setSubZones([]); }
  };

  const handleCreate = async () => {
    // Asset-type, station, location are always required
    if (!formData.asset_type_id || !formData.station_id || !formData.location_id) {
      toast.error('Please fill all required fields');
      return;
    }
    // Mode-specific validation
    if (isGroupedType) {
      if (!formData.sub_zone_id) { toast.error('Sub-zone is required for grouped assets'); return; }
      if (!formData.total_count || Number(formData.total_count) <= 0) {
        toast.error('Total count must be > 0'); return;
      }
    } else if (!formData.asset_number) {
      toast.error('Asset number is required'); return;
    }
    try {
      await assetsAPI.create({
        ...formData,
        // Auto-clear asset_number for grouped (backend generates); server validates total_count.
        asset_number: isGroupedType ? null : formData.asset_number,
        sub_zone_id: formData.sub_zone_id || null,
        total_count: isGroupedType ? Number(formData.total_count) : null,
        schedule_frequency: formData.schedule_frequency ? parseInt(formData.schedule_frequency, 10) : null,
        geo_lat: formData.geo_lat ? parseFloat(formData.geo_lat) : null,
        geo_lng: formData.geo_lng ? parseFloat(formData.geo_lng) : null,
      });
      toast.success('Asset created successfully');
      setShowCreate(false);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create asset'));
    }
  };

  const handleEdit = (asset) => {
    setEditingAsset(asset);
    setFormData({
      asset_type_id: asset.asset_type_id || '',
      station_id: asset.station_id || '',
      location_id: asset.location_id || '',
      asset_number: asset.asset_number || '',
      description: asset.description || '',
      schedule_frequency: asset.schedule_frequency || '',
      identification_photo: asset.identification_photo || null,
      geo_lat: asset.geo_lat != null ? String(asset.geo_lat) : '',
      geo_lng: asset.geo_lng != null ? String(asset.geo_lng) : '',
      sub_zone_id: asset.sub_zone_id || '',
      total_count: asset.total_count != null ? String(asset.total_count) : '',
    });
    loadLocations(asset.station_id);
    if (asset.location_id) loadSubZonesFor(asset.location_id);
    setShowEdit(true);
  };

  const handleUpdate = async () => {
    if (!formData.asset_type_id || !formData.station_id || !formData.location_id) {
      toast.error('Please fill all required fields');
      return;
    }
    if (!isGroupedType && !formData.asset_number) {
      toast.error('Asset number is required'); return;
    }
    try {
      await assetsAPI.update(editingAsset._id, {
        ...formData,
        asset_number: isGroupedType ? null : formData.asset_number,
        sub_zone_id: formData.sub_zone_id || null,
        total_count: isGroupedType && formData.total_count ? Number(formData.total_count) : null,
        schedule_frequency: formData.schedule_frequency ? parseInt(formData.schedule_frequency, 10) : null,
        geo_lat: formData.geo_lat ? parseFloat(formData.geo_lat) : null,
        geo_lng: formData.geo_lng ? parseFloat(formData.geo_lng) : null,
      });
      toast.success('Asset updated successfully');
      setShowEdit(false);
      setEditingAsset(null);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to update asset'));
    }
  };

  // ── Bulk Sub-Zone Assignment ─────────────────────────────────────────────
  // The toolbar appears when bulk mode is on and ≥1 asset is selected. It
  // enforces "single location" for the selection by reading the location_id
  // of the first picked asset; selecting one from a different location is
  // blocked client-side so the user never hits a 400.
  const bulkSelectionLocationId = (() => {
    if (bulkSelected.size === 0) return null;
    const first = assets.find(a => bulkSelected.has(a._id));
    return first?.location_id || null;
  })();

  const toggleBulkSelect = (asset) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(asset._id)) { next.delete(asset._id); return next; }
      // Enforce same-location constraint at selection time
      if (next.size > 0) {
        const firstLoc = assets.find(a => next.has(a._id))?.location_id;
        if (firstLoc && asset.location_id !== firstLoc) {
          toast.error('All bulk-selected assets must be in the same location'); return next;
        }
      }
      // Skip grouped assets — their sub_zone is structural
      if ((asset.tracking_mode || 'individual') === 'grouped') {
        toast.error('Grouped assets cannot be bulk-reassigned'); return next;
      }
      next.add(asset._id); return next;
    });
  };

  // Reload sub-zones for the toolbar whenever the selection's location changes
  useEffect(() => {
    if (!bulkSelectionLocationId) { setBulkSubZoneOptions([]); setBulkTargetSubZone(''); return; }
    subZonesAPI.list({ location_id: bulkSelectionLocationId })
      .then(r => setBulkSubZoneOptions(r.data || []))
      .catch(() => setBulkSubZoneOptions([]));
    setBulkTargetSubZone('');
  }, [bulkSelectionLocationId]);

  const handleBulkAssign = async (clearOnly = false) => {
    if (bulkSelected.size === 0) { toast.error('Select at least one asset'); return; }
    if (!clearOnly && !bulkTargetSubZone) { toast.error('Choose a sub-zone first'); return; }
    setBulkBusy(true);
    try {
      const r = await assetsAPI.bulkAssignSubZone(
        Array.from(bulkSelected),
        clearOnly ? null : bulkTargetSubZone,
      );
      toast.success(`${r.data.modified} asset(s) ${clearOnly ? 'cleared' : 'assigned'}`);
      setBulkSelected(new Set());
      setBulkMode(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Bulk assignment failed'));
    } finally { setBulkBusy(false); }
  };

  const cancelBulkMode = () => { setBulkMode(false); setBulkSelected(new Set()); };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this asset?')) return;
    try {
      await assetsAPI.delete(id);
      toast.success('Asset deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete asset');
    }
  };

  const resetForm = () => {
    setFormData({ asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: '', identification_photo: null, geo_lat: '', geo_lng: '', sub_zone_id: '', total_count: '' });
    setLocations([]);
    setSubZones([]);
  };

  // Resize image to ≤1024px and convert to base64 JPEG (≈50-150 KB)
  const resizeAndEncode = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleAssetPhotoUpload = async (file) => {
    if (!file) return;
    setPhotoLoading(true);
    try {
      // Extract GPS from EXIF
      try {
        const gps = await exifr.gps(file);
        if (gps && gps.latitude != null && gps.longitude != null) {
          setFormData(prev => ({ ...prev, geo_lat: String(gps.latitude.toFixed(6)), geo_lng: String(gps.longitude.toFixed(6)) }));
          toast.success('GPS extracted from photo EXIF');
        }
      } catch (_) { /* no EXIF GPS — that's fine */ }
      const base64 = await resizeAndEncode(file);
      setFormData(prev => ({ ...prev, identification_photo: base64 }));
    } finally {
      setPhotoLoading(false);
    }
  };

  const filteredAssets = assets.filter(a => {
    const matchSearch = !search || 
      a.asset_number?.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_type_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.station_name?.toLowerCase().includes(search.toLowerCase());
    const matchStation = !filterStation || filterStation === 'all' || a.station_id === filterStation;
    const matchStatus = !filterStatus || filterStatus === 'all' || a.status === filterStatus;
    return matchSearch && matchStation && matchStatus;
  });

  // Group by asset type
  const groupedByType = assetTypes.reduce((acc, type) => {
    acc[type._id] = {
      ...type,
      assets: filteredAssets.filter(a => a.asset_type_id === type._id)
    };
    return acc;
  }, {});

  const statusBadge = (status) => {
    const styles = {
      working: 'status-working',
      defective: 'status-defective',
      pending_approval: 'status-pending'
    };
    return <Badge className={styles[status] || ''}>{status?.replace('_', ' ')}</Badge>;
  };

  // ─── FIX: defined as a function CALL (not a React component) so it doesn't
  // get a new component identity on every parent re-render, which was causing
  // <Input> elements to lose focus after each keystroke.
  const renderAssetForm = (isEdit) => (
    <div className="space-y-4">
      <div>
        <Label>Asset Type *</Label>
        <Select value={formData.asset_type_id} onValueChange={(v) => setFormData({...formData, asset_type_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {assetTypes.map(t => <SelectItem key={t._id} value={t._id}>{t.name} ({t.department_name})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Station *</Label>
        <Select value={formData.station_id} onValueChange={(v) => {
          setFormData({...formData, station_id: v, location_id: '', sub_zone_id: ''});
          loadLocations(v);
          setSubZones([]);
        }}>
          <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
          <SelectContent>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Location *</Label>
        <Select value={formData.location_id} onValueChange={(v) => {
          setFormData({...formData, location_id: v, sub_zone_id: ''});
          loadSubZonesFor(v);
        }}>
          <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
          <SelectContent>
            {locations.map(l => <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* GROUPED MODE: Sub-Zone + Total Count + auto asset number preview */}
      {isGroupedType ? (
        <>
          <div>
            <Label>Sub-Zone *</Label>
            <Select value={formData.sub_zone_id} onValueChange={(v) => setFormData({...formData, sub_zone_id: v})}>
              <SelectTrigger data-testid="asset-subzone-select"><SelectValue placeholder={subZones.length ? 'Select sub-zone' : 'No sub-zones in this location'} /></SelectTrigger>
              <SelectContent>
                {subZones.map(z => <SelectItem key={z._id} value={z._id}>{z.name}{z.code ? ` (${z.code})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            {subZones.length === 0 && formData.location_id && (
              <p className="text-[11px] text-amber-700 mt-1">No sub-zones in this location. Create one in Admin → Locations.</p>
            )}
          </div>
          <div>
            <Label>Total Count *</Label>
            <Input
              data-testid="asset-total-count"
              type="number" min="1"
              value={formData.total_count}
              onChange={(e) => setFormData({...formData, total_count: e.target.value})}
              placeholder="e.g., 120 (total units in this sub-zone)"
            />
          </div>
          <div className="rounded-md bg-slate-50 border border-dashed p-2.5 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Asset ID:</span> Auto-generated on save · e.g.{' '}
            <code className="text-teal-700">FAN-DHN-PLATFORM-1-SUB-A</code>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Asset Number *</Label>
            <Input value={formData.asset_number} onChange={(e) => setFormData({...formData, asset_number: e.target.value})} placeholder="e.g., FAN-P1-001" />
          </div>
          {/* Optional sub-zone for individual assets — helps inspectors filter
              by sub-zone during rounds without converting to grouped mode. */}
          {subZones.length > 0 && (
            <div>
              <Label>Sub-Zone <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={formData.sub_zone_id || 'none'} onValueChange={(v) => setFormData({...formData, sub_zone_id: v === 'none' ? '' : v})}>
                <SelectTrigger data-testid="asset-individual-subzone-select">
                  <SelectValue placeholder="No sub-zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sub-zone</SelectItem>
                  {subZones.map(z => <SelectItem key={z._id} value={z._id}>{z.name}{z.code ? ` (${z.code})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
      <div>
        <Label>Description</Label>
        <Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Optional description" />
      </div>
      <div>
        <Label>Inspection Frequency (days)</Label>
        <Input
          type="number"
          min="1"
          value={formData.schedule_frequency}
          onChange={(e) => setFormData({...formData, schedule_frequency: e.target.value})}
          placeholder="e.g., 7 (inspect every 7 days)"
        />
      </div>

      {/* Identification Photo + GPS */}
      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identification Photo &amp; GPS</Label>

        {/* Photo upload */}
        <div>
          {formData.identification_photo ? (
            <div className="relative inline-block">
              <img
                src={formData.identification_photo}
                alt="Asset"
                className="h-32 w-auto rounded-lg border object-cover"
                data-testid="asset-photo-preview"
              />
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, identification_photo: null }))}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center shadow"
                title="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <label
              className="flex flex-col items-center gap-1 p-4 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
              data-testid="asset-photo-upload"
            >
              {photoLoading
                ? <span className="text-xs text-muted-foreground">Processing…</span>
                : <>
                    <Camera className="h-6 w-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Upload photo (GPS auto-extracted from EXIF)</span>
                  </>
              }
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAssetPhotoUpload(e.target.files[0])}
                disabled={photoLoading}
              />
            </label>
          )}
        </div>

        {/* GPS fields */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Latitude</Label>
            <Input
              value={formData.geo_lat}
              onChange={(e) => setFormData(prev => ({ ...prev, geo_lat: e.target.value }))}
              placeholder="e.g., 23.795771"
              className="text-xs h-8"
              data-testid="asset-geo-lat"
            />
          </div>
          <div>
            <Label className="text-xs">Longitude</Label>
            <Input
              value={formData.geo_lng}
              onChange={(e) => setFormData(prev => ({ ...prev, geo_lng: e.target.value }))}
              placeholder="e.g., 86.429551"
              className="text-xs h-8"
              data-testid="asset-geo-lng"
            />
          </div>
        </div>
        {formData.geo_lat && formData.geo_lng && (
          <a
            href={`https://maps.google.com/?q=${formData.geo_lat},${formData.geo_lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <MapPin className="h-3 w-3" /> View on Google Maps
          </a>
        )}
      </div>

      <Button onClick={isEdit ? handleUpdate : handleCreate} className="w-full">
        {isEdit ? 'Update Asset' : 'Create Asset'}
      </Button>
    </div>
  );

  const AssetCard = ({ asset }) => {
    const isGrouped = (asset.tracking_mode || 'individual') === 'grouped';
    const isBulkable = bulkMode && !isGrouped;
    const isBulkSelected = bulkSelected.has(asset._id);
    return (
    <div className={`flex items-center justify-between p-3 border-l-2 transition-all ${isBulkSelected ? 'border-teal-500 bg-teal-50/60' : 'border-primary/20 hover:border-primary/50 hover:bg-accent/30'}`} data-testid={`asset-row-${asset._id}`}>
      <div className="flex items-center gap-3 flex-1">
        {bulkMode && (
          <Checkbox
            checked={isBulkSelected}
            disabled={isGrouped}
            onCheckedChange={() => toggleBulkSelect(asset)}
            data-testid={`asset-bulk-check-${asset._id}`}
            title={isGrouped ? 'Grouped assets cannot be reassigned' : ''}
          />
        )}
        <div className="relative h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {asset.identification_photo
            ? <img src={asset.identification_photo} alt="" className="h-full w-full object-cover" />
            : <Box className="h-4 w-4 text-primary" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAssetHistory({ id: asset._id, number: asset.asset_number })}
              className="font-medium text-sm hover:text-primary transition-colors text-left"
            >
              {asset.asset_number}
            </button>
            {asset.sub_zone_name && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-teal-50 text-teal-800 border-teal-300" data-testid={`asset-subzone-badge-${asset._id}`}>
                {asset.sub_zone_name}
              </Badge>
            )}
            {asset.geo_lat && asset.geo_lng && (
              <a
                href={`https://maps.google.com/?q=${asset.geo_lat},${asset.geo_lng}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on map"
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin className="h-3 w-3 text-primary/60 hover:text-primary" />
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {asset.station_name} &middot; {asset.location_name}
            {!asset.sub_zone_name && isBulkable && <span className="text-[10px] text-amber-600 ml-2">· no sub-zone</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(asset.status)}
        {asset.schedule_frequency && (
          <Badge variant="outline" className="text-xs hidden sm:flex">every {asset.schedule_frequency}d</Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid={`asset-actions-trigger-${asset._id}`}
            >
              <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {asset.asset_number}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setAssetHistory({ id: asset._id, number: asset.asset_number })}
              data-testid={`asset-action-history-${asset._id}`}
            >
              <History className="h-3.5 w-3.5 mr-2" /> View history
            </DropdownMenuItem>
            {isAdmin() && (
              <>
                <DropdownMenuItem onClick={() => handleEdit(asset)} data-testid="asset-edit-button">
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit asset
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setMarkingAsset(asset)}
                  className="text-orange-600 focus:text-orange-700"
                  data-testid={`asset-mark-defective-${asset._id}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Mark defective
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDelete(asset._id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    );
  };

  // Initial-load skeleton only (full-page).
  // Subsequent reloads (search/filter/page) show a list-only skeleton so the
  // search input stays mounted and never loses focus mid-keystroke.
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  useEffect(() => {
    if (!loading && !initialLoadDone) setInitialLoadDone(true);
  }, [loading, initialLoadDone]);

  if (loading && !initialLoadDone) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Registry</h1>
          <p className="text-sm text-muted-foreground">{filteredAssets.length} assets found</p>
        </div>
        {isAdmin() && (
          <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="asset-create-button">
                <Plus className="h-4 w-4 mr-2" /> Add Asset
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create New Asset</DialogTitle></DialogHeader>
              {renderAssetForm(false)}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStation} onValueChange={(v) => { setFilterStation(v); setFilterLocation(''); setFilterSubZone(''); }}>
          <SelectTrigger className="w-[160px]" data-testid="asset-filter-station"><SelectValue placeholder="All Stations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filterStation && filterStation !== 'all' && filterLocationOptions.length > 0 && (
          <Select value={filterLocation} onValueChange={(v) => { setFilterLocation(v); setFilterSubZone(''); }}>
            <SelectTrigger className="w-[170px]" data-testid="asset-filter-location"><SelectValue placeholder="All Locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {filterLocationOptions.map(l => <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {filterLocation && filterLocation !== 'all' && filterSubZoneOptions.length > 0 && (
          <Select value={filterSubZone} onValueChange={setFilterSubZone}>
            <SelectTrigger className="w-[160px]" data-testid="asset-filter-subzone"><SelectValue placeholder="All Sub-Zones" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sub-Zones</SelectItem>
              {filterSubZoneOptions.map(z => <SelectItem key={z._id} value={z._id}>{z.name}{z.code ? ` (${z.code})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="working">Working</SelectItem>
            <SelectItem value="defective">Defective</SelectItem>
            <SelectItem value="pending_approval">Pending</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin() && (
          <Button
            size="sm"
            variant={bulkMode ? 'secondary' : 'outline'}
            onClick={() => bulkMode ? cancelBulkMode() : setBulkMode(true)}
            data-testid="bulk-mode-toggle"
            className="ml-auto gap-1.5"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {bulkMode ? 'Cancel selection' : 'Bulk assign sub-zone'}
          </Button>
        )}
      </div>

      {/* Bulk toolbar — sticky just below filters when ≥1 selected */}
      {bulkMode && bulkSelected.size > 0 && (
        <div
          className="sticky top-2 z-20 flex items-center gap-2 px-3 py-2 rounded-lg border border-teal-300 bg-teal-50/95 backdrop-blur shadow-sm flex-wrap"
          data-testid="bulk-toolbar"
        >
          <Badge className="bg-teal-600 text-white border-teal-600 text-[11px]">
            {bulkSelected.size} selected
          </Badge>
          {bulkSubZoneOptions.length === 0 ? (
            <span className="text-xs text-amber-700">
              No sub-zones exist for this location · <button onClick={() => window.location.href = '/admin'} className="underline">create one in Admin</button>
            </span>
          ) : (
            <>
              <span className="text-[11px] text-teal-800">Assign to</span>
              <Select value={bulkTargetSubZone} onValueChange={setBulkTargetSubZone}>
                <SelectTrigger className="w-[180px] h-8 text-xs bg-white" data-testid="bulk-subzone-select">
                  <SelectValue placeholder="Choose sub-zone…" />
                </SelectTrigger>
                <SelectContent>
                  {bulkSubZoneOptions.map(z => <SelectItem key={z._id} value={z._id}>{z.name}{z.code ? ` (${z.code})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8" disabled={bulkBusy || !bulkTargetSubZone} onClick={() => handleBulkAssign(false)} data-testid="bulk-assign-confirm">
                Assign
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={bulkBusy} onClick={() => handleBulkAssign(true)} data-testid="bulk-clear-subzone">
                Clear
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="h-8 ml-auto text-xs" onClick={cancelBulkMode}>Cancel</Button>
        </div>
      )}

      {/* Asset List Grouped by Type */}
      <div className="space-y-3">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)
        ) : filteredAssets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Box className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No assets found</p>
            </CardContent>
          </Card>
        ) : (
          Object.values(groupedByType).map((type) => {
            if (type.assets.length === 0) return null;
            
            return (
              <Collapsible key={type._id} defaultOpen>
                <Card>
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="p-4 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          {type.name}
                          <Badge variant="outline" className="text-xs font-normal">{type.assets.length} assets</Badge>
                        </CardTitle>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-4 pt-0 space-y-1">
                      {type.assets.map(asset => <AssetCard key={asset._id} asset={asset} />)}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        totalItems={total}
        loadedCount={assets.length}
        onPageChange={setPage}
        loading={loading}
        testIdPrefix="assets-pagination"
      />

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={(open) => { setShowEdit(open); if (!open) { setEditingAsset(null); resetForm(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          {renderAssetForm(true)}
        </DialogContent>
      </Dialog>

      {/* Asset History Drawer */}
      <AssetHistoryDrawer
        assetId={assetHistory?.id}
        assetNumber={assetHistory?.number}
        open={!!assetHistory}
        onOpenChange={(open) => !open && setAssetHistory(null)}
      />

      {/* Mark Defective Dialog (admin / superadmin only) */}
      <MarkDefectiveDialog
        asset={markingAsset}
        open={!!markingAsset}
        onOpenChange={(o) => !o && setMarkingAsset(null)}
        onMarked={() => { setMarkingAsset(null); loadAll(); }}
      />
    </div>
  );
}
