import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetsAPI, stationsAPI, locationsAPI, inspectionsAPI, usersAPI, uploadAPI } from '../lib/api';
import { errString } from '../lib/err';
import { openInspectionReport } from '../lib/inspection-report';
import { useAuth } from '../lib/auth-context';
import { toIstLiteral } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { toast } from 'sonner';
import { ClipboardCheck, Camera, Users, CalendarIcon, Clock, AlertTriangle, ChevronDown, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import { useLightbox } from '../components/PhotoLightbox';

export default function InspectionPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkAssetId = searchParams.get('asset_id');
  const [singleAssetMode, setSingleAssetMode] = useState(false);
  const [deepLinkAsset, setDeepLinkAsset] = useState(null);
  const [inspectionType, setInspectionType] = useState('individual');
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assets, setAssets] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [inspectionItems, setInspectionItems] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [overallRemarks, setOverallRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [assetHistory, setAssetHistory] = useState(null);
  const [inspectionDate, setInspectionDate] = useState(new Date());
  const [inspectionTime, setInspectionTime] = useState(format(new Date(), 'HH:mm'));
  const { open: openLightbox, lightbox } = useLightbox();

  useEffect(() => {
    loadStations();
    loadUsers();
  }, []);

  // Deep-link: when ?asset_id= is present, auto-preselect that asset and lock to single-asset mode.
  useEffect(() => {
    if (!deepLinkAssetId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await assetsAPI.get(deepLinkAssetId);
        const a = res.data;
        if (cancelled) return;
        setDeepLinkAsset(a);
        setSingleAssetMode(true);
        // Chain selections: station -> locations + assets, then preselect the asset
        setSelectedStation(a.station_id);
        await loadLocations(a.station_id);
        const params = { station_id: a.station_id };
        const ar = await assetsAPI.list(params);
        const allAssets = ar.data || [];
        setAssets(allAssets);
        const target = allAssets.find((x) => x._id === a._id) || a;
        setSelectedLocation(a.location_id || '');
        // Pre-add the asset as selected
        setSelectedAssets([target]);
        setInspectionItems([{
          asset_id: target._id,
          asset_number: target.asset_number,
          asset_status: target.status,
          defective_since_existing: target.defective_since,
          status: 'ok',
          checklist_responses: (target.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
          remarks: '',
          remarks_by: user.name,
          photo_urls: [],
          defective_since_date: null,
          defective_since_time: '',
          rectified_on_date: null,
          rectified_on_time: '',
        }]);
      } catch (e) {
        console.error('Deep link load failed', e);
        toast.error('Could not load the requested asset');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkAssetId]);

  const exitSingleAssetMode = () => {
    setSingleAssetMode(false);
    setDeepLinkAsset(null);
    setSearchParams({});
    setSelectedAssets([]);
    setInspectionItems([]);
  };

  const loadStations = async () => {
    const res = await stationsAPI.list();
    let filteredStations = res.data;
    
    // Role-based filtering
    if (user.role === 'approving_supervisor') {
      // Approving supervisors see only their assigned stations
      filteredStations = res.data.filter(s => s.approving_supervisor_id === user._id);
    } else if (user.role === 'supervisor' || user.role === 'reporting_officer') {
      // Supervisors and ROs see only their assigned stations
      filteredStations = res.data.filter(s => user.assigned_stations?.includes(s._id));
    }
    // Superadmin and admin see all stations
    
    setStations(filteredStations);
  };

  const loadUsers = async () => {
    const res = await usersAPI.list({});
    setUsers(res.data);
  };

  const loadLocations = async (stationId) => {
    const res = await locationsAPI.list(stationId);
    setLocations(res.data);
  };

  const loadAssets = async (stationId, locationId) => {
    const params = { station_id: stationId };
    if (locationId) params.location_id = locationId;
    const res = await assetsAPI.list(params);
    
    let filteredAssets = res.data;
    
    // Role-based filtering for assets
    if (user.role === 'supervisor') {
      // Supervisors see only assets from their department
      filteredAssets = res.data.filter(a => {
        // Get asset type department
        const assetDeptId = a.department_id; // We need this in asset response
        return assetDeptId === user.department_id;
      });
    }
    // Approving supervisors see all departments for their stations
    // Superadmin/admin see everything
    
    setAssets(filteredAssets);
  };

  const handleStationChange = (stationId) => {
    setSelectedStation(stationId);
    setSelectedLocation('');
    setSelectedAssets([]);
    setInspectionItems([]);
    loadLocations(stationId);
    loadAssets(stationId, null);
  };

  const handleLocationChange = (locationId) => {
    setSelectedLocation(locationId);
    setSelectedAssets([]);
    setInspectionItems([]);
    if (selectedStation) {
      loadAssets(selectedStation, locationId || null);
    }
  };

  const toggleAssetSelection = (asset) => {
    const exists = selectedAssets.find(a => a._id === asset._id);
    if (exists) {
      setSelectedAssets(prev => prev.filter(a => a._id !== asset._id));
      setInspectionItems(prev => prev.filter(i => i.asset_id !== asset._id));
    } else {
      setSelectedAssets(prev => [...prev, asset]);
      setInspectionItems(prev => [...prev, {
        asset_id: asset._id,
        asset_number: asset.asset_number,
        asset_status: asset.status,
        defective_since_existing: asset.defective_since,
        status: 'ok',
        checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
        remarks: '',
        remarks_by: user.name, // Track who is making remarks
        photo_urls: [],
        defective_since_date: null,
        defective_since_time: '',
        rectified_on_date: null, // NEW: Track when asset was marked OK
        rectified_on_time: ''     // NEW: Track time when marked OK
      }]);
    }
  };

  const selectAllAssets = () => {
    setSelectedAssets(assets);
    setInspectionItems(assets.map(asset => ({
      asset_id: asset._id,
      asset_number: asset.asset_number,
      asset_status: asset.status,
      defective_since_existing: asset.defective_since,
      status: 'ok',
      checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
      remarks: '',
      photo_urls: [],
      defective_since_date: null,
      defective_since_time: ''
    })));
  };

  const updateInspectionItem = (assetId, field, value) => {
    setInspectionItems(prev => prev.map(item =>
      item.asset_id === assetId ? { ...item, [field]: value } : item
    ));
  };

  const handlePhotoUpload = async (assetId, files) => {
    try {
      const uploaded = [];
      for (const file of files) {
        const res = await uploadAPI.single(file);
        uploaded.push(res.data.url);
      }
      setInspectionItems(prev => prev.map(item =>
        item.asset_id === assetId
          ? { ...item, photo_urls: [...item.photo_urls, ...uploaded] }
          : item
      ));
      toast.success(`${uploaded.length} photo(s) uploaded`);
    } catch (e) {
      toast.error('Photo upload failed');
    }
  };

  const handlePhotoDelete = (assetId, photoUrl) => {
    setInspectionItems(prev => prev.map(item =>
      item.asset_id === assetId
        ? { ...item, photo_urls: item.photo_urls.filter(url => url !== photoUrl) }
        : item
    ));
    toast.success('Photo removed');
  };

  const toggleParticipant = (empId) => {
    setParticipants(prev =>
      prev.includes(empId) ? prev.filter(p => p !== empId) : [...prev, empId]
    );
  };

  const handleSubmit = async () => {
    if (!selectedStation) { toast.error('Please select a station'); return; }
    if (inspectionItems.length === 0) { toast.error('Please select at least one asset'); return; }
    if (inspectionType === 'sig' && participants.length === 0) { toast.error('Please select SIG participants'); return; }

    // Validate defective_since for defective items
    for (const item of inspectionItems) {
      if ((item.status === 'not_ok' || item.status === 'needs_repair') && !item.defective_since_date) {
        toast.error(`Please set defective since date/time for ${item.asset_number}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // ── Build naive IST literal payloads. NEVER use .toISOString() — it
      // converts to UTC and silently shifts time by 5h30m, then backend
      // re-reads the wrong number as IST. The whole system is naive IST.
      const inspectionAtLiteral = toIstLiteral(inspectionDate, inspectionTime);

      const payload = {
        inspection_type: inspectionType,
        station_id: selectedStation,
        inspector_id: user._id,
        inspection_at: inspectionAtLiteral,
        items: inspectionItems.map(item => {
          let defective_since = null;
          if (item.status === 'not_ok' || item.status === 'needs_repair') {
            if (item.defective_since_date) {
              defective_since = toIstLiteral(item.defective_since_date, item.defective_since_time);
            }
          }

          let rectified_on = null;
          if (item.status === 'ok' && item.rectified_on_date) {
            rectified_on = toIstLiteral(item.rectified_on_date, item.rectified_on_time);
          }
          
          return {
            asset_id: item.asset_id,
            status: item.status,
            checklist_responses: item.checklist_responses,
            remarks: item.remarks,
            remarks_by: item.remarks_by, // Include who made the remarks
            photo_urls: item.photo_urls,
            defective_since: defective_since,
            rectified_on: rectified_on
          };
        }),
        participants: inspectionType === 'sig' ? participants : [],
        overall_remarks: overallRemarks
      };

      const submitRes = await inspectionsAPI.create(payload);
      const created = submitRes.data;
      const autoRejections = created.auto_rejections || [];
      if (autoRejections.length > 0) {
        toast.warning(
          `Inspection submitted. ⚠ ${autoRejections.length} asset(s) re-reported defective — prior rectification claim auto-rejected.`,
          { duration: 7000 }
        );
      } else {
        toast.success('Inspection submitted successfully!');
      }

      // Build asset_lookup for the report. Each entry carries the asset's CURRENT
      // live state so the PDF can render the correct ORANGE/RED/YELLOW/RESOLVED
      // badge and the canonical OL.defective_since (the source of truth).
      const lookup = {};
      selectedAssets.forEach((a) => {
        lookup[a._id] = {
          asset_number: a.asset_number,
          asset_type_name: a.asset_type_name,
          location_name: a.location_name,
          status: a.status,
          // Canonical defect timestamp from OL (asset.defective_since mirrors OL).
          ol_defective_since: a.defective_since,
          defective_since: a.defective_since,
        };
      });
      // For items that just transitioned to defective in this submission, the
      // selectedAsset's `status` is stale — patch it from the inspection items.
      (created.items || []).forEach((it) => {
        if (!lookup[it.asset_id]) return;
        if (it.status === 'not_ok' || it.status === 'needs_repair') {
          lookup[it.asset_id].status = 'defective';
          // If asset wasn't already defective, the new OL.defective_since equals what
          // the inspector typed (or now). Use the item's defective_since as canonical.
          if (!lookup[it.asset_id].ol_defective_since && it.defective_since) {
            lookup[it.asset_id].ol_defective_since = it.defective_since;
            lookup[it.asset_id].defective_since = it.defective_since;
          }
        } else if (it.status === 'ok' && lookup[it.asset_id].status === 'defective') {
          lookup[it.asset_id].status = 'pending_approval';
        }
      });
      const station = stations.find((s) => s._id === selectedStation);
      // Open the report in a new tab/window so user can print/save as PDF
      try {
        openInspectionReport({
          inspection: created,
          asset_lookup: lookup,
          station_name: station?.name,
          app_name: 'Asset Track Rail',
        });
      } catch (rep) {
        console.warn('Report open failed', rep);
      }

      setSelectedAssets([]);
      setInspectionItems([]);
      setParticipants([]);
      setOverallRemarks('');
      setInspectionDate(new Date());
      setInspectionTime(format(new Date(), 'HH:mm'));
    } catch (e) {
      toast.error(errString(e, 'Failed to submit inspection'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Inspection</h1>
        <p className="text-sm text-muted-foreground">Record asset inspection findings</p>
      </div>

      {singleAssetMode && deepLinkAsset && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ClipboardCheck className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                Single-asset inspection: <span className="text-primary">{deepLinkAsset.asset_number}</span>
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {deepLinkAsset.asset_type_name} &middot; {deepLinkAsset.station_name} &middot; {deepLinkAsset.location_name}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={exitSingleAssetMode}
            data-testid="exit-single-asset-mode"
          >
            Switch to multi-asset
          </Button>
        </div>
      )}

      {/* Type Selection */}
      <Tabs value={inspectionType} onValueChange={(v) => { setInspectionType(v); setSelectedAssets([]); setInspectionItems([]); }}>
        <TabsList>
          <TabsTrigger value="individual" data-testid="inspection-type-individual">
            <ClipboardCheck className="h-4 w-4 mr-2" /> Individual
          </TabsTrigger>
          <TabsTrigger value="sig" data-testid="inspection-type-sig">
            <Users className="h-4 w-4 mr-2" /> SIG
          </TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Station *</Label>
              <Select value={selectedStation} onValueChange={handleStationChange}>
                <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
                <SelectContent>
                  {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location (filter)</Label>
              <Select value={selectedLocation} onValueChange={handleLocationChange}>
                <SelectTrigger><SelectValue placeholder="All locations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(l => <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sig" className="space-y-4 mt-4" data-testid="sig-inspection-form">
          <div>
            <Label>Station * (All locations included)</Label>
            <Select value={selectedStation} onValueChange={handleStationChange}>
              <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
              <SelectContent>
                {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">SIG Participants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {users.filter(u => u._id !== user._id).map(u => (
                  <label key={u._id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={participants.includes(u.employee_id)}
                      onCheckedChange={() => toggleParticipant(u.employee_id)}
                    />
                    <span className="text-sm">{u.name}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{u.role?.replace('_', ' ')}</Badge>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Inspection Date/Time */}
      {selectedStation && assets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inspection Date & Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal mt-1">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {inspectionDate ? format(inspectionDate, 'dd MMM yyyy') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={inspectionDate}
                      onSelect={(date) => setInspectionDate(date || new Date())}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="w-[140px]">
                <Label className="text-xs">Time</Label>
                <Input
                  type="time"
                  value={inspectionTime}
                  onChange={(e) => setInspectionTime(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Asset Selection - Grouped by Type */}
      {selectedStation && assets.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Select Assets ({assets.length} available)</h3>
            {inspectionType === 'sig' && (
              <Button variant="outline" size="sm" onClick={selectAllAssets}>Select All</Button>
            )}
          </div>
          
          {/* Group assets by type */}
          {(() => {
            const grouped = assets.reduce((acc, asset) => {
              const typeKey = asset.asset_type_name || 'Unknown';
              if (!acc[typeKey]) acc[typeKey] = [];
              acc[typeKey].push(asset);
              return acc;
            }, {});

            return Object.keys(grouped).map(typeName => (
              <Collapsible key={typeName} defaultOpen>
                <Card>
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="p-3 hover:bg-accent/30 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          {typeName}
                          <Badge variant="outline" className="text-xs font-normal">{grouped[typeName].length} assets</Badge>
                        </CardTitle>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-3 pt-0">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {grouped[typeName].map(asset => (
                          <label key={asset._id} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedAssets.find(a => a._id === asset._id) ? 'border-primary bg-accent' : 'hover:bg-muted'
                          }`}>
                            <Checkbox
                              checked={!!selectedAssets.find(a => a._id === asset._id)}
                              onCheckedChange={() => toggleAssetSelection(asset)}
                            />
                            <div className="flex-1 min-w-0">
                              <button
                                onClick={(e) => { e.preventDefault(); setAssetHistory({ id: asset._id, number: asset.asset_number }); }}
                                className="text-sm font-medium truncate hover:text-primary transition-colors text-left"
                              >
                                {asset.asset_number}
                              </button>
                              {asset.status === 'defective' && (
                                <Badge className="status-defective text-[9px] px-1 py-0 ml-1">Defective</Badge>
                              )}
                              <p className="text-xs text-muted-foreground">{asset.location_name}</p>
                              {asset.status === 'defective' && asset.defective_since && (
                                <p className="text-[10px] text-destructive mt-0.5 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Since: {new Date(asset.defective_since).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ));
          })()}
        </div>
      )}

      {/* Inspection Items */}
      {inspectionItems.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Inspection Details</h3>
          {inspectionItems.map((item) => (
            <Card key={item.asset_id} className={`border-l-4 ${
              item.asset_status === 'defective' ? 'border-l-destructive' : 'border-l-primary'
            }`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{item.asset_number}</CardTitle>
                  {/* Change 3: Show defective since for already-defective */}
                  {item.asset_status === 'defective' && item.defective_since_existing && (
                    <Badge className="status-defective text-[10px]">
                      Defective since {new Date(item.defective_since_existing).toLocaleString()}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status */}
                <div>
                  <Label className="text-xs font-medium">Status *</Label>
                  <RadioGroup
                    value={item.status}
                    onValueChange={(v) => updateInspectionItem(item.asset_id, 'status', v)}
                    className="flex gap-4 mt-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="ok" id={`ok-${item.asset_id}`} />
                      <Label htmlFor={`ok-${item.asset_id}`} className="text-sm cursor-pointer">OK</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="not_ok" id={`not_ok-${item.asset_id}`} />
                      <Label htmlFor={`not_ok-${item.asset_id}`} className="text-sm cursor-pointer">Not OK</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="needs_repair" id={`repair-${item.asset_id}`} />
                      <Label htmlFor={`repair-${item.asset_id}`} className="text-sm cursor-pointer">Needs Repair</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Change 2: Defective Since Date/Time picker */}
                {(item.status === 'not_ok' || item.status === 'needs_repair') && (
                  <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
                    <Label className="text-xs font-medium text-destructive">Defective Since (Date & Time) *</Label>
                    <div className="flex gap-2 mt-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 justify-start text-left font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {item.defective_since_date
                              ? format(new Date(item.defective_since_date), 'dd MMM yyyy')
                              : 'Pick date'
                            }
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={item.defective_since_date ? new Date(item.defective_since_date) : undefined}
                            onSelect={(date) => updateInspectionItem(item.asset_id, 'defective_since_date', date?.toISOString())}
                            disabled={(date) => date > new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <Input
                        type="time"
                        value={item.defective_since_time}
                        onChange={(e) => updateInspectionItem(item.asset_id, 'defective_since_time', e.target.value)}
                        className="w-[130px]"
                        data-testid="defective-time-input"
                      />
                    </div>
                  </div>
                )}

                {/* NEW: Rectified On Date/Time picker */}
                {item.status === 'ok' && item.asset_status === 'defective' && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <Label className="text-xs font-medium text-green-700 dark:text-green-400">Rectified On (Date & Time)</Label>
                    <p className="text-[10px] text-muted-foreground mb-2">When was this asset fixed/working again?</p>
                    <div className="flex gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 justify-start text-left font-normal" data-testid="rectified-on-date-btn">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {item.rectified_on_date
                              ? format(new Date(item.rectified_on_date), 'dd MMM yyyy')
                              : 'Pick date'
                            }
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={item.rectified_on_date ? new Date(item.rectified_on_date) : undefined}
                            onSelect={(date) => updateInspectionItem(item.asset_id, 'rectified_on_date', date?.toISOString())}
                            disabled={(date) => date > new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <Input
                        type="time"
                        value={item.rectified_on_time}
                        onChange={(e) => updateInspectionItem(item.asset_id, 'rectified_on_time', e.target.value)}
                        className="w-[130px]"
                        data-testid="rectified-on-time-input"
                      />
                    </div>
                  </div>
                )}

                {/* Checklist */}
                {item.checklist_responses.length > 0 && (
                  <div>
                    <Label className="text-xs font-medium">Checklist</Label>
                    <div className="space-y-2 mt-1">
                      {item.checklist_responses.map((check, cidx) => (
                        <div key={cidx} className="flex items-center gap-3 p-2 bg-muted/50 rounded">
                          <Checkbox
                            checked={check.status === 'pass'}
                            onCheckedChange={(checked) => {
                              const updated = [...item.checklist_responses];
                              updated[cidx] = { ...check, status: checked ? 'pass' : 'fail' };
                              updateInspectionItem(item.asset_id, 'checklist_responses', updated);
                            }}
                          />
                          <span className="text-sm">{check.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Remarks */}
                <div>
                  <Label className="text-xs font-medium">Remarks</Label>
                  <Textarea
                    value={item.remarks}
                    onChange={(e) => updateInspectionItem(item.asset_id, 'remarks', e.target.value)}
                    placeholder="Add remarks..."
                    className="mt-1"
                  />
                </div>

                {/* Photo Upload */}
                <div>
                  <Label className="text-xs font-medium">Photos</Label>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {item.photo_urls.map((url, pidx) => (
                      <div key={pidx} className="relative h-16 w-16 rounded-lg overflow-hidden border group">
                        <img
                          src={`${process.env.REACT_APP_BACKEND_URL}${url}`}
                          alt=""
                          className="h-full w-full object-cover cursor-zoom-in"
                          onClick={() => openLightbox(item.photo_urls, pidx)}
                          data-testid={`inspection-photo-thumb-${item.asset_id}-${pidx}`}
                        />
                        <button
                          onClick={() => handlePhotoDelete(item.asset_id, url)}
                          className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remove photo"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {/* Take photo (camera) */}
                    <label
                      className="h-16 w-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 gap-0.5"
                      title="Take photo with camera"
                    >
                      <Camera className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[9px] text-muted-foreground">Camera</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handlePhotoUpload(item.asset_id, Array.from(e.target.files))}
                        data-testid={`inspection-photo-camera-${item.asset_id}`}
                      />
                    </label>
                    {/* Choose files (gallery / file picker) */}
                    <label
                      className="h-16 w-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 gap-0.5"
                      title="Choose from files"
                    >
                      <span className="text-[18px] leading-none text-muted-foreground">+</span>
                      <span className="text-[9px] text-muted-foreground">Files</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handlePhotoUpload(item.asset_id, Array.from(e.target.files))}
                        data-testid={`inspection-photo-files-${item.asset_id}`}
                      />
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          <div>
            <Label>Overall Remarks</Label>
            <Textarea
              value={overallRemarks}
              onChange={(e) => setOverallRemarks(e.target.value)}
              placeholder="Overall inspection notes..."
              className="mt-1"
            />
          </div>

          <div className="sticky bottom-4 bg-background/80 backdrop-blur p-4 rounded-xl border shadow-lg">
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full"
              size="lg"
              data-testid="inspection-submit-button"
            >
              {submitting ? 'Submitting...' : `Submit Inspection (${inspectionItems.length} assets)`}
            </Button>
          </div>
        </div>
      )}

      {selectedStation && assets.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No assets found for this selection</p>
          </CardContent>
        </Card>
      )}

      {/* Asset History Drawer */}
      <AssetHistoryDrawer
        assetId={assetHistory?.id}
        assetNumber={assetHistory?.number}
        open={!!assetHistory}
        onOpenChange={(open) => !open && setAssetHistory(null)}
      />
      {lightbox}
    </div>
  );
}
