import { useState, useEffect } from 'react';
import { assetsAPI, stationsAPI, locationsAPI, assetTypesAPI, usersAPI } from '../lib/api';
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
import { toast } from 'sonner';
import { Plus, Search, Box, Trash2, Pencil, ChevronDown, User, MoreVertical, AlertTriangle, History } from 'lucide-react';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import SupervisorHistoryDrawer from '../components/SupervisorHistoryDrawer';
import MarkDefectiveDialog from '../components/dialogs/MarkDefectiveDialog';

export default function AssetsPage() {
  const { isAdmin } = useAuth();
  const [assets, setAssets] = useState([]);
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStation, setFilterStation] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assetHistory, setAssetHistory] = useState(null);
  const [supervisorHistory, setSupervisorHistory] = useState(null);
  const [markingAsset, setMarkingAsset] = useState(null);
  const [formData, setFormData] = useState({
    asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: '', assigned_supervisor_id: ''
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [assetsRes, stationsRes, typesRes] = await Promise.all([
        assetsAPI.list({}),
        stationsAPI.list(),
        assetTypesAPI.list()
      ]);
      setAssets(assetsRes.data);
      setStations(stationsRes.data);
      setAssetTypes(typesRes.data);
    } catch (e) {
      console.error('Failed to load assets', e);
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async (stationId) => {
    if (stationId) {
      const res = await locationsAPI.list(stationId);
      setLocations(res.data);
    }
  };

  const loadSupervisors = async (stationId, assetTypeId) => {
    // Get department from asset type
    const assetType = assetTypes.find(t => t._id === assetTypeId);
    const params = {};
    if (stationId) params.station_id = stationId;
    if (assetType?.department_id) params.department_id = assetType.department_id;
    
    try {
      const res = await usersAPI.supervisors(params);
      setSupervisors(res.data);
    } catch (e) {
      console.error('Failed to load supervisors', e);
      setSupervisors([]);
    }
  };

  const handleCreate = async () => {
    if (!formData.asset_type_id || !formData.station_id || !formData.location_id || !formData.asset_number) {
      toast.error('Please fill all required fields');
      return;
    }
    try {
      await assetsAPI.create({
        ...formData,
        schedule_frequency: formData.schedule_frequency ? parseInt(formData.schedule_frequency, 10) : null,
        assigned_supervisor_id: (formData.assigned_supervisor_id && formData.assigned_supervisor_id !== 'none') ? formData.assigned_supervisor_id : null
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
      assigned_supervisor_id: asset.assigned_supervisor_id || ''
    });
    loadLocations(asset.station_id);
    loadSupervisors(asset.station_id, asset.asset_type_id);
    setShowEdit(true);
  };

  const handleUpdate = async () => {
    if (!formData.asset_type_id || !formData.station_id || !formData.location_id || !formData.asset_number) {
      toast.error('Please fill all required fields');
      return;
    }
    try {
      await assetsAPI.update(editingAsset._id, {
        ...formData,
        schedule_frequency: formData.schedule_frequency ? parseInt(formData.schedule_frequency, 10) : null,
        assigned_supervisor_id: (formData.assigned_supervisor_id && formData.assigned_supervisor_id !== 'none') ? formData.assigned_supervisor_id : null
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
    setFormData({ asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: '', assigned_supervisor_id: '' });
    setLocations([]);
    setSupervisors([]);
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

  const AssetForm = ({ isEdit }) => (
    <div className="space-y-4">
      <div>
        <Label>Asset Type *</Label>
        <Select value={formData.asset_type_id} onValueChange={(v) => {
          setFormData({...formData, asset_type_id: v});
          if (formData.station_id) loadSupervisors(formData.station_id, v);
        }}>
          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {assetTypes.map(t => <SelectItem key={t._id} value={t._id}>{t.name} ({t.department_name})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Station *</Label>
        <Select value={formData.station_id} onValueChange={(v) => { 
          setFormData({...formData, station_id: v, location_id: ''}); 
          loadLocations(v);
          if (formData.asset_type_id) loadSupervisors(v, formData.asset_type_id);
        }}>
          <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
          <SelectContent>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Location *</Label>
        <Select value={formData.location_id} onValueChange={(v) => setFormData({...formData, location_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
          <SelectContent>
            {locations.map(l => <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Asset Number *</Label>
        <Input value={formData.asset_number} onChange={(e) => setFormData({...formData, asset_number: e.target.value})} placeholder="e.g., FAN-P1-001" />
      </div>
      <div>
        <Label>Assigned Supervisor</Label>
        <Select value={formData.assigned_supervisor_id} onValueChange={(v) => setFormData({...formData, assigned_supervisor_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select supervisor (optional)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Assignment</SelectItem>
            {supervisors.map(s => <SelectItem key={s._id} value={s._id}>{s.name} ({s.employee_id})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
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
      <Button onClick={isEdit ? handleUpdate : handleCreate} className="w-full">
        {isEdit ? 'Update Asset' : 'Create Asset'}
      </Button>
    </div>
  );

  const AssetCard = ({ asset }) => (
    <div className="flex items-center justify-between p-3 border-l-2 border-primary/20 hover:border-primary/50 hover:bg-accent/30 transition-all">
      <div className="flex items-center gap-3 flex-1">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Box className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setAssetHistory({ id: asset._id, number: asset.asset_number })}
            className="font-medium text-sm hover:text-primary transition-colors text-left"
          >
            {asset.asset_number}
          </button>
          <p className="text-xs text-muted-foreground truncate">
            {asset.station_name} &middot; {asset.location_name}
          </p>
          {asset.assigned_supervisor_name && (
            <button
              onClick={() => setSupervisorHistory({ id: asset.assigned_supervisor_id, name: asset.assigned_supervisor_name })}
              className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
            >
              <User className="h-3 w-3" />
              {asset.assigned_supervisor_name}
            </button>
          )}
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

  if (loading) {
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
              <AssetForm isEdit={false} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStation} onValueChange={setFilterStation}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Stations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stations</SelectItem>
            {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="working">Working</SelectItem>
            <SelectItem value="defective">Defective</SelectItem>
            <SelectItem value="pending_approval">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Asset List Grouped by Type */}
      <div className="space-y-3">
        {filteredAssets.length === 0 ? (
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

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={(open) => { setShowEdit(open); if (!open) { setEditingAsset(null); resetForm(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <AssetForm isEdit={true} />
        </DialogContent>
      </Dialog>

      {/* Asset History Drawer */}
      <AssetHistoryDrawer
        assetId={assetHistory?.id}
        assetNumber={assetHistory?.number}
        open={!!assetHistory}
        onOpenChange={(open) => !open && setAssetHistory(null)}
      />

      {/* Supervisor History Drawer */}
      <SupervisorHistoryDrawer
        supervisorId={supervisorHistory?.id}
        supervisorName={supervisorHistory?.name}
        open={!!supervisorHistory}
        onOpenChange={(open) => !open && setSupervisorHistory(null)}
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
