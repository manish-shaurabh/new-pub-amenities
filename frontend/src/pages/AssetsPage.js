import { useState, useEffect } from 'react';
import { assetsAPI, stationsAPI, locationsAPI, assetTypesAPI, departmentsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Plus, Search, Box, Trash2, Pencil } from 'lucide-react';

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
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [formData, setFormData] = useState({
    asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: ''
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

  const handleCreate = async () => {
    if (!formData.asset_type_id || !formData.station_id || !formData.location_id || !formData.asset_number) {
      toast.error('Please fill all required fields');
      return;
    }
    try {
      await assetsAPI.create({
        ...formData,
        schedule_frequency: formData.schedule_frequency || null
      });
      toast.success('Asset created successfully');
      setShowCreate(false);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create asset');
    }
  };

  // Change 5: Edit asset
  const handleEdit = (asset) => {
    setEditingAsset(asset);
    setFormData({
      asset_type_id: asset.asset_type_id || '',
      station_id: asset.station_id || '',
      location_id: asset.location_id || '',
      asset_number: asset.asset_number || '',
      description: asset.description || '',
      schedule_frequency: asset.schedule_frequency || ''
    });
    loadLocations(asset.station_id);
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
        schedule_frequency: formData.schedule_frequency || null
      });
      toast.success('Asset updated successfully');
      setShowEdit(false);
      setEditingAsset(null);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update asset');
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
    setFormData({ asset_type_id: '', station_id: '', location_id: '', asset_number: '', description: '', schedule_frequency: '' });
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
        <Select value={formData.asset_type_id} onValueChange={(v) => setFormData({...formData, asset_type_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {assetTypes.map(t => <SelectItem key={t._id} value={t._id}>{t.name} ({t.department_name})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Station *</Label>
        <Select value={formData.station_id} onValueChange={(v) => { setFormData({...formData, station_id: v, location_id: ''}); loadLocations(v); }}>
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
        <Label>Description</Label>
        <Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Optional description" />
      </div>
      <div>
        <Label>Inspection Frequency</Label>
        <Select value={formData.schedule_frequency} onValueChange={(v) => setFormData({...formData, schedule_frequency: v})}>
          <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={isEdit ? handleUpdate : handleCreate} className="w-full">
        {isEdit ? 'Update Asset' : 'Create Asset'}
      </Button>
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
            <DialogContent className="max-w-md">
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

      {/* Asset List */}
      <div className="space-y-2">
        {filteredAssets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Box className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No assets found</p>
            </CardContent>
          </Card>
        ) : (
          filteredAssets.map((asset) => (
            <Card key={asset._id} className="table-row-hover">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Box className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{asset.asset_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {asset.asset_type_name} &middot; {asset.station_name} &middot; {asset.location_name}
                      </p>
                      {asset.defective_since && asset.status === 'defective' && (
                        <p className="text-[10px] text-destructive">Defective since: {new Date(asset.defective_since).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(asset.status)}
                    {asset.schedule_frequency && (
                      <Badge variant="outline" className="text-xs hidden sm:flex">{asset.schedule_frequency}</Badge>
                    )}
                    {isAdmin() && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(asset)} data-testid="asset-edit-button">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(asset._id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Dialog - Change 5 */}
      <Dialog open={showEdit} onOpenChange={(open) => { setShowEdit(open); if (!open) { setEditingAsset(null); resetForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Asset</DialogTitle></DialogHeader>
          <AssetForm isEdit={true} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
