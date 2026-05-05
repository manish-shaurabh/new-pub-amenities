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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { toast } from 'sonner';
import { Plus, Trash2, Building2, MapPin, Layers, ClipboardList, Pencil, ChevronRight, ChevronDown } from 'lucide-react';

export default function AdminPage() {
  const [departments, setDepartments] = useState([]);
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [activeTab, setActiveTab] = useState('departments');
  const [loading, setLoading] = useState(true);

  // Expanded stations in locations tab
  const [expandedStations, setExpandedStations] = useState({});

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('create'); // 'create' or 'edit'
  const [dialogType, setDialogType] = useState(''); // 'department', 'station', 'location', 'asset-type'
  const [editingItem, setEditingItem] = useState(null);

  // Form data
  const [deptForm, setDeptForm] = useState({ name: '', code: '', description: '' });
  const [stationForm, setStationForm] = useState({ name: '', code: '', zone: '', division: '' });
  const [locationForm, setLocationForm] = useState({ name: '', station_id: '', description: '' });
  const [assetTypeForm, setAssetTypeForm] = useState({ name: '', department_id: '', description: '', checklist: [] });
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

  // ============ OPEN DIALOGS ============
  const openCreateDialog = (type) => {
    setDialogType(type);
    setDialogMode('create');
    setEditingItem(null);
    resetForms();
    setDialogOpen(true);
  };

  const openEditDialog = (type, item) => {
    setDialogType(type);
    setDialogMode('edit');
    setEditingItem(item);
    
    if (type === 'department') {
      setDeptForm({ name: item.name || '', code: item.code || '', description: item.description || '' });
    } else if (type === 'station') {
      setStationForm({ name: item.name || '', code: item.code || '', zone: item.zone || '', division: item.division || '' });
    } else if (type === 'location') {
      setLocationForm({ name: item.name || '', station_id: item.station_id || '', description: item.description || '' });
    } else if (type === 'asset-type') {
      setAssetTypeForm({
        name: item.name || '',
        department_id: item.department_id || '',
        description: item.description || '',
        checklist: (item.checklist || []).map(c => ({ name: c.name, description: c.description || '' }))
      });
    }
    setDialogOpen(true);
  };

  const resetForms = () => {
    setDeptForm({ name: '', code: '', description: '' });
    setStationForm({ name: '', code: '', zone: '', division: '' });
    setLocationForm({ name: '', station_id: '', description: '' });
    setAssetTypeForm({ name: '', department_id: '', description: '', checklist: [] });
    setNewChecklistItem('');
  };

  // ============ SUBMIT HANDLERS ============
  const handleSubmit = async () => {
    try {
      if (dialogType === 'department') {
        if (!deptForm.name || !deptForm.code) { toast.error('Name and code required'); return; }
        if (dialogMode === 'create') {
          await departmentsAPI.create(deptForm);
          toast.success('Department created');
        } else {
          await departmentsAPI.update(editingItem._id, deptForm);
          toast.success('Department updated');
        }
      } else if (dialogType === 'station') {
        if (!stationForm.name || !stationForm.code) { toast.error('Name and code required'); return; }
        if (dialogMode === 'create') {
          await stationsAPI.create(stationForm);
          toast.success('Station created');
        } else {
          await stationsAPI.update(editingItem._id, stationForm);
          toast.success('Station updated');
        }
      } else if (dialogType === 'location') {
        if (!locationForm.name || !locationForm.station_id) { toast.error('Name and station required'); return; }
        if (dialogMode === 'create') {
          await locationsAPI.create(locationForm);
          toast.success('Location created');
        } else {
          await locationsAPI.update(editingItem._id, locationForm);
          toast.success('Location updated');
        }
      } else if (dialogType === 'asset-type') {
        if (!assetTypeForm.name || !assetTypeForm.department_id) { toast.error('Name and department required'); return; }
        if (dialogMode === 'create') {
          await assetTypesAPI.create(assetTypeForm);
          toast.success('Asset type created');
        } else {
          await assetTypesAPI.update(editingItem._id, assetTypeForm);
          toast.success('Asset type updated');
        }
      }
      setDialogOpen(false);
      resetForms();
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Operation failed');
    }
  };

  // ============ DELETE HANDLERS ============
  const handleDelete = async (type, id) => {
    if (!window.confirm('Are you sure you want to delete this?')) return;
    try {
      if (type === 'department') await departmentsAPI.delete(id);
      else if (type === 'station') await stationsAPI.delete(id);
      else if (type === 'location') await locationsAPI.delete(id);
      else if (type === 'asset-type') await assetTypesAPI.delete(id);
      toast.success('Deleted successfully');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ============ CHECKLIST HELPERS ============
  const addChecklistItem = () => {
    if (!newChecklistItem.trim()) return;
    setAssetTypeForm(prev => ({
      ...prev,
      checklist: [...prev.checklist, { name: newChecklistItem.trim(), description: '' }]
    }));
    setNewChecklistItem('');
  };

  const removeChecklistItem = (idx) => {
    setAssetTypeForm(prev => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== idx)
    }));
  };

  // ============ LOCATIONS GROUPED BY STATION ============
  const toggleStation = (stationId) => {
    setExpandedStations(prev => ({ ...prev, [stationId]: !prev[stationId] }));
  };

  const getLocationsForStation = (stationId) => {
    return locations.filter(l => l.station_id === stationId);
  };

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  // ============ DIALOG CONTENT ============
  const renderDialogContent = () => {
    if (dialogType === 'department') {
      return (
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={deptForm.name} onChange={e => setDeptForm({...deptForm, name: e.target.value})} placeholder="e.g., Electrical" /></div>
          <div><Label>Code *</Label><Input value={deptForm.code} onChange={e => setDeptForm({...deptForm, code: e.target.value})} placeholder="e.g., ELEC" /></div>
          <div><Label>Description</Label><Input value={deptForm.description} onChange={e => setDeptForm({...deptForm, description: e.target.value})} placeholder="Optional" /></div>
        </div>
      );
    } else if (dialogType === 'station') {
      return (
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={stationForm.name} onChange={e => setStationForm({...stationForm, name: e.target.value})} placeholder="e.g., Mumbai Central" /></div>
          <div><Label>Code *</Label><Input value={stationForm.code} onChange={e => setStationForm({...stationForm, code: e.target.value})} placeholder="e.g., MMCT" /></div>
          <div><Label>Zone</Label><Input value={stationForm.zone} onChange={e => setStationForm({...stationForm, zone: e.target.value})} placeholder="e.g., Western" /></div>
          <div><Label>Division</Label><Input value={stationForm.division} onChange={e => setStationForm({...stationForm, division: e.target.value})} placeholder="e.g., Mumbai" /></div>
        </div>
      );
    } else if (dialogType === 'location') {
      return (
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={locationForm.name} onChange={e => setLocationForm({...locationForm, name: e.target.value})} placeholder="e.g., Platform 1" /></div>
          <div>
            <Label>Station *</Label>
            <Select value={locationForm.station_id} onValueChange={v => setLocationForm({...locationForm, station_id: v})}>
              <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
              <SelectContent>
                {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name} ({s.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Description</Label><Input value={locationForm.description} onChange={e => setLocationForm({...locationForm, description: e.target.value})} placeholder="Optional" /></div>
        </div>
      );
    } else if (dialogType === 'asset-type') {
      return (
        <div className="space-y-3">
          <div><Label>Name *</Label><Input value={assetTypeForm.name} onChange={e => setAssetTypeForm({...assetTypeForm, name: e.target.value})} placeholder="e.g., Ceiling Fan" /></div>
          <div>
            <Label>Department *</Label>
            <Select value={assetTypeForm.department_id} onValueChange={v => setAssetTypeForm({...assetTypeForm, department_id: v})}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Description</Label><Input value={assetTypeForm.description} onChange={e => setAssetTypeForm({...assetTypeForm, description: e.target.value})} placeholder="Optional" /></div>
          <div>
            <Label>Inspection Checklist Items</Label>
            <p className="text-xs text-muted-foreground mb-2">These items will appear as checkpoints during inspections</p>
            <div className="flex gap-2">
              <Input 
                value={newChecklistItem} 
                onChange={e => setNewChecklistItem(e.target.value)} 
                placeholder="Add checklist item" 
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())} 
              />
              <Button type="button" onClick={addChecklistItem} size="sm" variant="secondary">Add</Button>
            </div>
            {assetTypeForm.checklist.length > 0 && (
              <div className="space-y-1 mt-2 max-h-[200px] overflow-y-auto">
                {assetTypeForm.checklist.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">{idx + 1}.</span>
                      <span className="text-sm">{item.name}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeChecklistItem(idx)}>
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const dialogTitle = () => {
    const action = dialogMode === 'create' ? 'Add' : 'Edit';
    const types = { 'department': 'Department', 'station': 'Station', 'location': 'Location', 'asset-type': 'Asset Type' };
    return `${action} ${types[dialogType] || ''}`;
  };

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

        {/* ============ DEPARTMENTS ============ */}
        <TabsContent value="departments" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Departments ({departments.length})</h3>
            <Button size="sm" onClick={() => openCreateDialog('department')}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {departments.map(d => (
            <Card key={d._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">Code: {d.code} {d.description ? `| ${d.description}` : ''}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog('department', d)}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete('department', d._id)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ============ STATIONS ============ */}
        <TabsContent value="stations" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Stations ({stations.length})</h3>
            <Button size="sm" onClick={() => openCreateDialog('station')}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {stations.map(s => (
            <Card key={s._id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Code: {s.code} {s.zone ? `| Zone: ${s.zone}` : ''} {s.division ? `| Div: ${s.division}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog('station', s)}>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete('station', s._id)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ============ LOCATIONS (Grouped by Station - Accordion) ============ */}
        <TabsContent value="locations" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Locations ({locations.length})</h3>
            <Button size="sm" onClick={() => openCreateDialog('location')}>
              <Plus className="h-4 w-4 mr-1" /> Add Location
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">Click on a station to view/manage its locations</p>
          
          {stations.map(station => {
            const stationLocations = getLocationsForStation(station._id);
            const isExpanded = expandedStations[station._id];
            
            return (
              <Card key={station._id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleStation(station._id)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-primary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{station.name}</p>
                      <p className="text-xs text-muted-foreground">Code: {station.code}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {stationLocations.length} location{stationLocations.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                
                {isExpanded && (
                  <div className="border-t bg-muted/20 px-3 py-2 space-y-2">
                    {stationLocations.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2 text-center">No locations added for this station</p>
                    ) : (
                      stationLocations.map(loc => (
                        <div key={loc._id} className="flex items-center justify-between p-2 bg-background rounded-lg border">
                          <div className="flex items-center gap-2">
                            <Layers className="h-3.5 w-3.5 text-primary/60" />
                            <div>
                              <p className="text-sm">{loc.name}</p>
                              {loc.description && <p className="text-xs text-muted-foreground">{loc.description}</p>}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditDialog('location', loc); }}>
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleDelete('location', loc._id); }}>
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full mt-2 text-xs"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setLocationForm({ name: '', station_id: station._id, description: '' });
                        setDialogType('location');
                        setDialogMode('create');
                        setEditingItem(null);
                        setDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Location to {station.name}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </TabsContent>

        {/* ============ ASSET TYPES ============ */}
        <TabsContent value="asset-types" className="space-y-3 mt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Asset Types ({assetTypes.length})</h3>
            <Button size="sm" onClick={() => openCreateDialog('asset-type')}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {assetTypes.map(at => (
            <Card key={at._id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{at.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Dept: {at.department_name} {at.description ? `| ${at.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {at.checklist?.length || 0} checklist items
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog('asset-type', at)}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete('asset-type', at._id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                {/* Show checklist preview */}
                {at.checklist?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {at.checklist.map((c, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-normal">{c.name}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* ============ UNIVERSAL DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForms(); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle()}</DialogTitle>
          </DialogHeader>
          {renderDialogContent()}
          <Button onClick={handleSubmit} className="w-full mt-2">
            {dialogMode === 'create' ? 'Create' : 'Save Changes'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
