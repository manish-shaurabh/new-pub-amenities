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
import { toast } from 'sonner';
import { ClipboardCheck, Camera, X, Users, Upload } from 'lucide-react';

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
  const [photos, setPhotos] = useState({});

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
    if (inspectionType === 'sig') {
      loadAssets(stationId, null);
    }
  };

  const handleLocationChange = (locationId) => {
    setSelectedLocation(locationId);
    setSelectedAssets([]);
    setInspectionItems([]);
    if (selectedStation) {
      loadAssets(selectedStation, locationId);
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
        status: 'ok',
        checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
        remarks: '',
        photo_urls: []
      }]);
    }
  };

  const selectAllAssets = () => {
    setSelectedAssets(assets);
    setInspectionItems(assets.map(asset => ({
      asset_id: asset._id,
      asset_number: asset.asset_number,
      status: 'ok',
      checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
      remarks: '',
      photo_urls: []
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

    setSubmitting(true);
    try {
      const payload = {
        inspection_type: inspectionType,
        station_id: selectedStation,
        inspector_id: user._id,
        items: inspectionItems.map(item => ({
          asset_id: item.asset_id,
          status: item.status,
          checklist_responses: item.checklist_responses,
          remarks: item.remarks,
          photo_urls: item.photo_urls
        })),
        participants: inspectionType === 'sig' ? participants : [],
        overall_remarks: overallRemarks
      };

      await inspectionsAPI.create(payload);
      toast.success('Inspection submitted successfully!');
      // Reset
      setSelectedAssets([]);
      setInspectionItems([]);
      setParticipants([]);
      setOverallRemarks('');
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
          {/* Station & Location Selection */}
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
              <Label>Location</Label>
              <Select value={selectedLocation} onValueChange={handleLocationChange}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sig" className="space-y-4 mt-4" data-testid="sig-inspection-form">
          {/* Station Selection for SIG */}
          <div>
            <Label>Station * (All locations will be included)</Label>
            <Select value={selectedStation} onValueChange={handleStationChange}>
              <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
              <SelectContent>
                {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Participants */}
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

      {/* Asset Selection */}
      {selectedStation && assets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Select Assets to Inspect ({assets.length} available)</CardTitle>
              {inspectionType === 'sig' && (
                <Button variant="outline" size="sm" onClick={selectAllAssets}>Select All</Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
              {assets.map(asset => (
                <label key={asset._id} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedAssets.find(a => a._id === asset._id) ? 'border-primary bg-accent' : 'hover:bg-muted'
                }`}>
                  <Checkbox
                    checked={!!selectedAssets.find(a => a._id === asset._id)}
                    onCheckedChange={() => toggleAssetSelection(asset)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{asset.asset_number}</p>
                    <p className="text-xs text-muted-foreground">{asset.asset_type_name} &middot; {asset.location_name}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inspection Items */}
      {inspectionItems.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Inspection Details</h3>
          {inspectionItems.map((item, idx) => (
            <Card key={item.asset_id} className="border-l-4 border-l-primary">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{item.asset_number}</CardTitle>
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
                      <RadioGroupItem value="ok" id={`ok-${item.asset_id}`} data-testid="inspection-status-radio-working" />
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
                    data-testid="inspection-remarks-textarea"
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
                    <label className="h-16 w-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/40" data-testid="inspection-photo-upload">
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

          {/* Overall Remarks */}
          <div>
            <Label>Overall Remarks</Label>
            <Textarea
              value={overallRemarks}
              onChange={(e) => setOverallRemarks(e.target.value)}
              placeholder="Overall inspection notes..."
              className="mt-1"
            />
          </div>

          {/* Submit */}
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
    </div>
  );
}
