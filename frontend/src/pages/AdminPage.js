import { useState, useEffect } from 'react';
import { departmentsAPI, stationsAPI, locationsAPI, assetTypesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, Building2, MapPin, Layers, ClipboardList } from 'lucide-react';

export default function AdminPage() {
  const [departments, setDepartments] = useState([]);
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [activeTab, setActiveTab] = useState('departments');
  const [loading, setLoading] = useState(true);

  // Forms
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [newDept, setNewDept] = useState({ name: '', code: '', description: '' });
  const [showStationForm, setShowStationForm] = useState(false);
  const [newStation, setNewStation] = useState({ name: '', code: '', zone: '', division: '' });
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: '', station_id: '', description: '' });
  const [showAssetTypeForm, setShowAssetTypeForm] = useState(false);
  const [newAssetType, setNewAssetType] = useState({ name: '', department_id: '', description: '', checklist: [] });
  const [newChecklistItem, setNewChecklistItem] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [deptsRes, stationsRes, locsRes, typesRes] = await Promise.all([
        departmentsAPI.list(),
        stationsAPI.list(),
        locationsAPI.list(),
        assetTypesAPI.list()
      ]);
      setDepartments(deptsRes.data);
      setStations(stationsRes.data);
      setLocations(locsRes.data);
      setAssetTypes(typesRes.data);
    } catch (e) {
      console.error('Failed to load', e);
    } finally {
      setLoading(false);
    }
  };

  // Department CRUD
  const createDepartment = async () => {
    if (!newDept.name || !newDept.code) { toast.error('Name and code required'); return; }
    try {
      await departmentsAPI.create(newDept);
      toast.success('Department created');
      setShowDeptForm(false);
      setNewDept({ name: '', code: '', description: '' });
      loadAll();
    } catch (e) { toast.error('Failed to create department'); }
  };

  const deleteDepartment = async (id) => {
    if (!window.confirm('Delete this department?')) return;
    try {
      await departmentsAPI.delete(id);
      toast.success('Department deleted');
      loadAll();
    } catch (e) { toast.error('Failed to delete'); }
  };

  // Station CRUD
  const createStation = async () => {
    if (!newStation.name || !newStation.code) { toast.error('Name and code required'); return; }
    try {
      await stationsAPI.create(newStation);
      toast.success('Station created');
      setShowStationForm(false);
      setNewStation({ name: '', code: '', zone: '', division: '' });
      loadAll();
    } catch (e) { toast.error('Failed to create station'); }
  };

  const deleteStation = async (id) => {
    if (!window.confirm('Delete this station?')) return;
    try {
      await stationsAPI.delete(id);
      toast.success('Station deleted');
      loadAll();
    } catch (e) { toast.error('Failed to delete'); }
  };

  // Location CRUD
  const createLocation = async () => {
    if (!newLocation.name || !newLocation.station_id) { toast.error('Name and station required'); return; }
    try {
      await locationsAPI.create(newLocation);
      toast.success('Location created');
      setShowLocationForm(false);
      setNewLocation({ name: '', station_id: '', description: '' });
      loadAll();
    } catch (e) { toast.error('Failed to create location'); }
  };

  const deleteLocation = async (id) => {
    if (!window.confirm('Delete this location?')) return;
    try {
      await locationsAPI.delete(id);
      toast.success('Location deleted');
      loadAll();
    } catch (e) { toast.error('Failed to delete'); }
  };

  // Asset Type CRUD
  const addChecklistItem = () => {
    if (!newChecklistItem) return;
    setNewAssetType(prev => ({
      ...prev,
      checklist: [...prev.checklist, { name: newChecklistItem, description: '' }]
    }));
    setNewChecklistItem('');
  };

  const removeChecklistItem = (idx) => {
    setNewAssetType(prev => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== idx)
    }));
  };

  const createAssetType = async () => {
    if (!newAssetType.name || !newAssetType.department_id) { toast.error('Name and department required'); return; }
    try {
      await assetTypesAPI.create(newAssetType);
      toast.success('Asset type created');
      setShowAssetTypeForm(false);
      setNewAssetType({ name: '', department_id: '', description: '', checklist: [] });
      loadAll();
    } catch (e) { toast.error('Failed to create asset type'); }
  };

  const deleteAssetType = async (id) => {
    if (!window.confirm('Delete this asset type?')) return;
    try {
      await assetTypesAPI.delete(id);
      toast.success('Asset type deleted');
      loadAll();
    } catch (e) { toast.error('Failed to delete'); }
  };

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="admin-panel">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Manage system configuration</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="departments"><Building2 className="h-4 w-4 mr-1 hidden sm:inline" /> Depts</TabsTrigger>
          <TabsTrigger value="stations"><MapPin className="h-4 w-4 mr-1 hidden sm:inline" /> Stations</TabsTrigger>
          <TabsTrigger value="locations"><Layers className="h-4 w-4 mr-1 hidden sm:inline" /> Locations</TabsTrigger>
          <TabsTrigger value="asset-types"><ClipboardList className="h-4 w-4 mr-1 hidden sm:inline" /> Types</TabsTrigger>
        </TabsList>

        {/* Departments */}
        <TabsContent value="departments" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Departments ({departments.length})</h3>
            <Dialog open={showDeptForm} onOpenChange={setShowDeptForm}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Department</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name *</Label><Input value={newDept.name} onChange={e => setNewDept({...newDept, name: e.target.value})} /></div>
                  <div><Label>Code *</Label><Input value={newDept.code} onChange={e => setNewDept({...newDept, code: e.target.value})} placeholder="e.g., ELEC" /></div>
                  <div><Label>Description</Label><Input value={newDept.description} onChange={e => setNewDept({...newDept, description: e.target.value})} /></div>
                  <Button onClick={createDepartment} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {departments.map(d => (
            <Card key={d._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">Code: {d.code}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteDepartment(d._id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Stations */}
        <TabsContent value="stations" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Stations ({stations.length})</h3>
            <Dialog open={showStationForm} onOpenChange={setShowStationForm}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Station</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name *</Label><Input value={newStation.name} onChange={e => setNewStation({...newStation, name: e.target.value})} /></div>
                  <div><Label>Code *</Label><Input value={newStation.code} onChange={e => setNewStation({...newStation, code: e.target.value})} placeholder="e.g., MMCT" /></div>
                  <div><Label>Zone</Label><Input value={newStation.zone} onChange={e => setNewStation({...newStation, zone: e.target.value})} /></div>
                  <div><Label>Division</Label><Input value={newStation.division} onChange={e => setNewStation({...newStation, division: e.target.value})} /></div>
                  <Button onClick={createStation} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {stations.map(s => (
            <Card key={s._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">Code: {s.code} {s.zone ? `| ${s.zone}` : ''} {s.division ? `| ${s.division}` : ''}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteStation(s._id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Locations */}
        <TabsContent value="locations" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Locations ({locations.length})</h3>
            <Dialog open={showLocationForm} onOpenChange={setShowLocationForm}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Location</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name *</Label><Input value={newLocation.name} onChange={e => setNewLocation({...newLocation, name: e.target.value})} placeholder="e.g., Platform 1" /></div>
                  <div>
                    <Label>Station *</Label>
                    <Select value={newLocation.station_id} onValueChange={v => setNewLocation({...newLocation, station_id: v})}>
                      <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
                      <SelectContent>
                        {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Description</Label><Input value={newLocation.description} onChange={e => setNewLocation({...newLocation, description: e.target.value})} /></div>
                  <Button onClick={createLocation} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {locations.map(l => (
            <Card key={l._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">Station: {l.station_name}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteLocation(l._id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Asset Types */}
        <TabsContent value="asset-types" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Asset Types ({assetTypes.length})</h3>
            <Dialog open={showAssetTypeForm} onOpenChange={setShowAssetTypeForm}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] overflow-y-auto">
                <DialogHeader><DialogTitle>New Asset Type</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Name *</Label><Input value={newAssetType.name} onChange={e => setNewAssetType({...newAssetType, name: e.target.value})} placeholder="e.g., Fan" /></div>
                  <div>
                    <Label>Department *</Label>
                    <Select value={newAssetType.department_id} onValueChange={v => setNewAssetType({...newAssetType, department_id: v})}>
                      <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Description</Label><Input value={newAssetType.description} onChange={e => setNewAssetType({...newAssetType, description: e.target.value})} /></div>
                  <div>
                    <Label>Checklist Items</Label>
                    <div className="flex gap-2 mt-1">
                      <Input value={newChecklistItem} onChange={e => setNewChecklistItem(e.target.value)} placeholder="Add checklist item" onKeyDown={e => e.key === 'Enter' && addChecklistItem()} />
                      <Button type="button" onClick={addChecklistItem} size="sm">Add</Button>
                    </div>
                    <div className="space-y-1 mt-2">
                      {newAssetType.checklist.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded">
                          <span className="text-sm">{item.name}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeChecklistItem(idx)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button onClick={createAssetType} className="w-full">Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {assetTypes.map(at => (
            <Card key={at._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{at.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Dept: {at.department_name} &middot; {at.checklist?.length || 0} checklist items
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteAssetType(at._id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
