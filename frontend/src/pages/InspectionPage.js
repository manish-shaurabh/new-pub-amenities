import { useState, useEffect } from 'react';
import { assetsAPI, stationsAPI, locationsAPI, inspectionsAPI, usersAPI, uploadAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
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
import { ClipboardCheck, Camera, Users, CalendarIcon, Clock, AlertTriangle, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';

export default function InspectionPage() {
  const { user } = useAuth();
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

  useEffect(() => {
    loadStations();
    loadUsers();
  }, []);

  const loadStations = async () => {
    const res = await stationsAPI.list();
    setStations(res.data);
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
    setAssets(res.data);
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
        photo_urls: [],
        defective_since_date: null,
        defective_since_time: ''
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
      // Build inspection_at from inspectionDate and inspectionTime
      const inspectionDateTime = new Date(inspectionDate);
      if (inspectionTime) {
        const [hours, minutes] = inspectionTime.split(':');
        inspectionDateTime.setHours(parseInt(hours), parseInt(minutes));
      }

      const payload = {
        inspection_type: inspectionType,
        station_id: selectedStation,
        inspector_id: user._id,
        inspection_at: inspectionDateTime.toISOString(),
        items: inspectionItems.map(item => {
          let defective_since = null;
          if (item.status === 'not_ok' || item.status === 'needs_repair') {
            if (item.defective_since_date) {
              const date = new Date(item.defective_since_date);
              if (item.defective_since_time) {
                const [hours, minutes] = item.defective_since_time.split(':');
                date.setHours(parseInt(hours), parseInt(minutes));
              }
              defective_since = date.toISOString();
            }
          }
          return {
            asset_id: item.asset_id,
            status: item.status,
            checklist_responses: item.checklist_responses,
            remarks: item.remarks,
            photo_urls: item.photo_urls,
            defective_since: defective_since
          };
        }),
        participants: inspectionType === 'sig' ? participants : [],
        overall_remarks: overallRemarks
      };

      await inspectionsAPI.create(payload);
      toast.success('Inspection submitted successfully!');
      setSelectedAssets([]);
      setInspectionItems([]);
      setParticipants([]);
      setOverallRemarks('');
      setInspectionDate(new Date());
      setInspectionTime(format(new Date(), 'HH:mm'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to submit inspection');
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
                      <div key={pidx} className="relative h-16 w-16 rounded-lg overflow-hidden border">
                        <img src={`${process.env.REACT_APP_BACKEND_URL}${url}`} alt="" className="h-full w-full object-cover" />
                      </div>
                    ))}
                    <label className="h-16 w-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/40">
                      <Camera className="h-5 w-5 text-muted-foreground" />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handlePhotoUpload(item.asset_id, Array.from(e.target.files))}
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
    </div>
  );
}
