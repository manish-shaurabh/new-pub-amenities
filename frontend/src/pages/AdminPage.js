import { useState, useEffect } from 'react';
import { departmentsAPI, stationsAPI, locationsAPI, assetTypesAPI, usersAPI, adminAPI, remarksAPI, zonesAPI, divisionsAPI, subZonesAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Trash2, Building2, MapPin, Layers, ClipboardList, Pencil, ChevronDown, Users, Link, Table as TableIcon, User, ArrowRightLeft, Briefcase, Tag, ShieldAlert, Globe, GitBranch } from 'lucide-react';
import RemarkTagsManager from '../components/RemarkTagsManager';
import DataHealthPanel from '../components/DataHealthPanel';
import ZoneDivisionFilter from '../components/ZoneDivisionFilter';

// Import the user management components from the old UsersPage
const roleLabels = {
  superadmin: 'Super Admin',
  divisional_admin: 'Divisional Admin',
  admin: 'Admin',
  reporting_officer: 'Reporting Officer',
  approving_supervisor: 'Approving Supervisor',
  supervisor: 'Supervisor',
};

const roleColors = {
  superadmin: 'bg-primary/10 text-primary border-primary/20',
  divisional_admin: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  admin: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))] border-[hsl(var(--info))]/20',
  reporting_officer: 'bg-[hsl(var(--pending))]/10 text-[hsl(var(--pending))] border-[hsl(var(--pending))]/20',
  approving_supervisor: 'bg-accent text-accent-foreground border-accent',
  supervisor: 'bg-muted text-muted-foreground border-border',
};

export default function AdminPage() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const isDivAdmin = user?.role === 'divisional_admin';
  const [activeTab, setActiveTab] = useState('stations');
  const [loading, setLoading] = useState(true);
  
  // Data
  const [departments, setDepartments] = useState([]);
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [subZones, setSubZones] = useState([]);
  const [users, setUsers] = useState([]);
  const [zones, setZones] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [stationStaff, setStationStaff] = useState([]);
  const [approvingSupervisors, setApprovingSupervisors] = useState([]);
  
  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('create');
  const [dialogType, setDialogType] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  
  // Forms
  const [stationForm, setStationForm] = useState({ name: '', code: '', zone: '', division: '', division_id: '', approving_supervisor_id: '' });
  const [locationForm, setLocationForm] = useState({ name: '', station_id: '', description: '' });
  // Sub-Zone form (children of a Location)
  const [subZoneForm, setSubZoneForm] = useState({ name: '', code: '', station_id: '', location_id: '', description: '', order: 0 });
  const [assetTypeForm, setAssetTypeForm] = useState({ name: '', department_id: '', description: '', checklist: [], tracking_mode: 'individual' });
  const [departmentForm, setDepartmentForm] = useState({ name: '', code: '', description: '' });
  const [deptFieldErrors, setDeptFieldErrors] = useState({});
  const [userForm, setUserForm] = useState({
    employee_id: '', name: '', role: 'supervisor', department_id: '', assigned_stations: [], 
    password: '', email: '', phone: '', reports_to_id: '', assigned_division_id: '',
  });
  // Zone/Division inline CRUD state
  const [zoneForm, setZoneForm] = useState({ name: '', code: '' });
  const [divisionForm, setDivisionForm] = useState({ name: '', code: '', zone_id: '' });
  const [editingZone, setEditingZone] = useState(null);
  const [editingDivision, setEditingDivision] = useState(null);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showDivisionForm, setShowDivisionForm] = useState(false);
  const [divisionStationAssign, setDivisionStationAssign] = useState(null); // division being assigned
  const [assigningStations, setAssigningStations] = useState([]);
  
  // Link Supervisors tab
  const [selectedRO, setSelectedRO] = useState('');
  const [selectedSupervisors, setSelectedSupervisors] = useState([]);
  
  // Personnel Map filter
  const [personnelStationFilter, setPersonnelStationFilter] = useState('all');
  const [personnelDepartmentFilter, setPersonnelDepartmentFilter] = useState('all');
  const [personnelZoneFilter, setPersonnelZoneFilter] = useState('');
  const [personnelDivisionFilter, setPersonnelDivisionFilter] = useState('');

  // Transfer Supervisor tab
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  const handleTransferSupervisor = async () => {
    if (!transferFrom) {
      toast.error('Select the supervisor to transfer assets from');
      return;
    }
    if (transferFrom === transferTo) {
      toast.error('From and To supervisor cannot be the same');
      return;
    }
    const fromUser = users.find((u) => u._id === transferFrom);
    const toUser = transferTo && transferTo !== 'unassign' ? users.find((u) => u._id === transferTo) : null;
    const confirmMsg = toUser
      ? `Reassign all assets from ${fromUser?.name} to ${toUser.name}?`
      : `Unassign all assets from ${fromUser?.name}? They will have no supervisor afterwards.`;
    if (!window.confirm(confirmMsg)) return;
    setTransferLoading(true);
    try {
      const r = await adminAPI.transferSupervisor(
        transferFrom,
        transferTo === 'unassign' || !transferTo ? null : transferTo
      );
      toast.success(`${r.data.assets_updated} asset(s) reassigned`);
      setTransferFrom('');
      setTransferTo('');
    } catch (e) {
      toast.error(errString(e, 'Transfer failed'));
    } finally {
      setTransferLoading(false);
    }
  };
  
  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [deptsRes, stationsRes, locsRes, typesRes, usersRes, zonesRes, divisionsRes, subZonesRes] = await Promise.all([
        departmentsAPI.list(),
        stationsAPI.list(),
        locationsAPI.list(),
        assetTypesAPI.list(),
        usersAPI.list({}),
        zonesAPI.list(),
        divisionsAPI.list(),
        subZonesAPI.list().catch(() => ({ data: [] })),
      ]);
      setDepartments(deptsRes.data);
      const allStations = stationsRes.data;
      // Divisional Admin sees only their division's stations
      setStations(isDivAdmin
        ? allStations.filter(s => s.division_id === user?.assigned_division_id)
        : allStations);
      setLocations(locsRes.data);
      setAssetTypes(typesRes.data);
      setSubZones(subZonesRes.data || []);
      const allUsers = usersRes.data;
      setUsers(isDivAdmin
        ? allUsers.filter(u => {
            if (u.role === 'divisional_admin') return u.assigned_division_id === user?.assigned_division_id;
            const myStationIds = new Set(allStations.filter(s => s.division_id === user?.assigned_division_id).map(s => s._id));
            return u.assigned_stations?.some(sid => myStationIds.has(sid));
          })
        : allUsers);
      setZones(zonesRes.data);
      setDivisions(divisionsRes.data);
      
      // Get approving supervisors
      const asups = usersRes.data.filter(u => u.role === 'approving_supervisor');
      setApprovingSupervisors(asups);
    } catch (e) {
      console.error('Failed to load', e);
    } finally {
      setLoading(false);
    }
  };

  const loadStationStaff = async () => {
    try {
      const res = await usersAPI.stationStaff();
      setStationStaff(res.data);
    } catch (e) {
      console.error('Failed to load station staff', e);
    }
  };

  useEffect(() => {
    if (activeTab === 'personnel-map') {
      loadStationStaff();
    }
  }, [activeTab]);

  // ========== Department CRUD ==========
  const validateDepartmentForm = () => {
    const errs = {};
    const name = (departmentForm.name || '').trim();
    const code = (departmentForm.code || '').trim();
    if (!name) errs.name = 'Name is required';
    else if (name.length > 120) errs.name = 'Name is too long (max 120 chars)';
    if (!code) errs.code = 'Code is required';
    else if (code.length > 8) errs.code = 'Code must be 1-8 characters';
    else if (!/^[A-Z0-9]+$/.test(code)) errs.code = 'Only letters and numbers allowed';
    setDeptFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateDepartment = async () => {
    if (!validateDepartmentForm()) return;
    try {
      await departmentsAPI.create({
        name: departmentForm.name.trim(),
        code: departmentForm.code.trim().toUpperCase(),
        description: (departmentForm.description || '').trim() || null,
      }, user?._id);
      toast.success(`Department "${departmentForm.name.trim()}" created`);
      setDeptFieldErrors({});
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create department'));
    }
  };

  const handleUpdateDepartment = async () => {
    if (!validateDepartmentForm()) return;
    try {
      await departmentsAPI.update(editingItem._id, {
        name: departmentForm.name.trim(),
        code: departmentForm.code.trim().toUpperCase(),
        description: (departmentForm.description || '').trim() || null,
      }, user?._id);
      toast.success('Department updated');
      setDeptFieldErrors({});
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to update'));
    }
  };

  const handleDeleteDepartment = async (id) => {
    if (!window.confirm('Delete this department? This will fail if any asset types still reference it.')) return;
    try {
      await departmentsAPI.delete(id, user?._id);
      toast.success('Department deleted');
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to delete — remove dependent asset types first'));
    }
  };

  // ========== Zone CRUD ==========
  const handleCreateZone = async () => {
    if (!zoneForm.name || !zoneForm.code) { toast.error('Name and code required'); return; }
    try {
      await zonesAPI.create({ name: zoneForm.name.trim(), code: zoneForm.code.trim().toUpperCase() });
      toast.success('Zone created');
      setZoneForm({ name: '', code: '' });
      setShowZoneForm(false);
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed')); }
  };
  const handleUpdateZone = async () => {
    try {
      await zonesAPI.update(editingZone._id, { name: zoneForm.name.trim(), code: zoneForm.code.trim().toUpperCase() });
      toast.success('Zone updated');
      setEditingZone(null);
      setShowZoneForm(false);
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed')); }
  };
  const handleDeleteZone = async (id) => {
    if (!window.confirm('Delete this zone? Fails if divisions reference it.')) return;
    try {
      await zonesAPI.delete(id);
      toast.success('Zone deleted');
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed — remove dependent divisions first')); }
  };

  // ========== Division CRUD ==========
  const handleCreateDivision = async () => {
    if (!divisionForm.name || !divisionForm.code || !divisionForm.zone_id) { toast.error('Name, code, and zone required'); return; }
    try {
      await divisionsAPI.create(divisionForm);
      toast.success('Division created');
      setDivisionForm({ name: '', code: '', zone_id: '' });
      setShowDivisionForm(false);
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed')); }
  };
  const handleUpdateDivision = async () => {
    try {
      await divisionsAPI.update(editingDivision._id, divisionForm);
      toast.success('Division updated');
      setEditingDivision(null);
      setShowDivisionForm(false);
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed')); }
  };
  const handleDeleteDivision = async (id) => {
    if (!window.confirm('Delete this division? Fails if stations are assigned to it.')) return;
    try {
      await divisionsAPI.delete(id);
      toast.success('Division deleted');
      loadAll();
    } catch (e) { toast.error(errString(e, 'Cannot delete — reassign its stations first')); }
  };
  const handleAssignStationsToDivision = async () => {
    try {
      await divisionsAPI.assignStations(divisionStationAssign, assigningStations);
      toast.success('Stations assigned');
      setDivisionStationAssign(null);
      setAssigningStations([]);
      loadAll();
    } catch (e) { toast.error(errString(e, 'Failed')); }
  };

  // ========== Station CRUD ==========
  const handleCreateStation = async () => {
    if (!stationForm.name || !stationForm.code) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await stationsAPI.create(stationForm);
      toast.success('Station created');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create'));
    }
  };

  const handleUpdateStation = async () => {
    try {
      await stationsAPI.update(editingItem._id, stationForm);
      toast.success('Station updated');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to update');
    }
  };

  const handleDeleteStation = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await stationsAPI.delete(id);
      toast.success('Deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ========== Location CRUD ==========
  const handleCreateLocation = async () => {
    if (!locationForm.name || !locationForm.station_id) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await locationsAPI.create(locationForm);
      toast.success('Location created');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to create');
    }
  };

  const handleUpdateLocation = async () => {
    try {
      await locationsAPI.update(editingItem._id, locationForm);
      toast.success('Location updated');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to update');
    }
  };

  const handleDeleteLocation = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await locationsAPI.delete(id);
      toast.success('Deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ========== Sub-Zone CRUD ==========
  const handleCreateSubZone = async () => {
    if (!subZoneForm.name || !subZoneForm.location_id || !subZoneForm.station_id) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await subZonesAPI.create({ ...subZoneForm, order: Number(subZoneForm.order) || 0 });
      toast.success('Sub-zone created');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create sub-zone'));
    }
  };

  const handleUpdateSubZone = async () => {
    try {
      await subZonesAPI.update(editingItem._id, { ...subZoneForm, order: Number(subZoneForm.order) || 0 });
      toast.success('Sub-zone updated');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to update'));
    }
  };

  const handleDeleteSubZone = async (id) => {
    if (!window.confirm('Delete this sub-zone? This will fail if assets still reference it.')) return;
    try {
      await subZonesAPI.delete(id);
      toast.success('Deleted');
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to delete'));
    }
  };

  // ========== Asset Type CRUD ==========
  const handleCreateAssetType = async () => {
    if (!assetTypeForm.name || !assetTypeForm.department_id) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await assetTypesAPI.create(assetTypeForm);
      toast.success('Asset Type created');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to create');
    }
  };

  const handleUpdateAssetType = async () => {
    try {
      await assetTypesAPI.update(editingItem._id, assetTypeForm);
      toast.success('Asset Type updated');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to update');
    }
  };

  const handleDeleteAssetType = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await assetTypesAPI.delete(id);
      toast.success('Deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ========== User CRUD ==========
  const handleCreateUser = async () => {
    if (!userForm.employee_id || !userForm.name || !userForm.password) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await usersAPI.create(userForm);
      toast.success('User created');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create'));
    }
  };

  const handleUpdateUser = async () => {
    try {
      await usersAPI.update(editingItem._id, userForm);
      toast.success('User updated');
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast.error('Failed to update');
    }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await usersAPI.delete(id);
      toast.success('Deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete');
    }
  };

  // ========== Link Supervisors ==========
  const handleLinkSupervisors = async () => {
    if (!selectedRO || selectedSupervisors.length === 0) {
      toast.error('Please select reporting officer and supervisors');
      return;
    }
    try {
      await usersAPI.linkSupervisors(selectedRO, selectedSupervisors);
      toast.success('Supervisors linked successfully');
      setSelectedRO('');
      setSelectedSupervisors([]);
      loadAll();
    } catch (e) {
      toast.error('Failed to link supervisors');
    }
  };

  const toggleSupervisorSelection = (supervisorId) => {
    setSelectedSupervisors(prev =>
      prev.includes(supervisorId)
        ? prev.filter(id => id !== supervisorId)
        : [...prev, supervisorId]
    );
  };

  // Open dialogs
  const openCreateDialog = (type) => {
    setDialogType(type);
    setDialogMode('create');
    setEditingItem(null);
    setDeptFieldErrors({});
    // Reset forms based on type
    if (type === 'department') setDepartmentForm({ name: '', code: '', description: '' });
    else if (type === 'station') setStationForm({ name: '', code: '', zone: '', division: '', division_id: '', approving_supervisor_id: '' });
    else if (type === 'location') setLocationForm({ name: '', station_id: '', description: '' });
    else if (type === 'sub-zone') setSubZoneForm({ name: '', code: '', station_id: '', location_id: '', description: '', order: 0 });
    else if (type === 'asset-type') setAssetTypeForm({ name: '', department_id: '', description: '', checklist: [], tracking_mode: 'individual' });
    else if (type === 'user') setUserForm({ employee_id: '', name: '', role: 'supervisor', department_id: '', assigned_stations: [], password: '', email: '', phone: '', reports_to_id: '', assigned_division_id: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (type, item) => {
    setDialogType(type);
    setDialogMode('edit');
    setEditingItem(item);
    if (type === 'department') {
      setDeptFieldErrors({});
      setDepartmentForm({ name: item.name, code: item.code || '', description: item.description || '' });
    } else if (type === 'station') {
      setStationForm({ name: item.name, code: item.code, zone: item.zone || '', division: item.division || '', division_id: item.division_id || '', approving_supervisor_id: item.approving_supervisor_id || '' });
    } else if (type === 'location') {
      setLocationForm({ name: item.name, station_id: item.station_id, description: item.description || '' });
    } else if (type === 'sub-zone') {
      setSubZoneForm({
        name: item.name, code: item.code || '', station_id: item.station_id,
        location_id: item.location_id, description: item.description || '', order: item.order || 0,
      });
    } else if (type === 'asset-type') {
      setAssetTypeForm({ name: item.name, department_id: item.department_id, description: item.description || '', checklist: item.checklist || [], tracking_mode: item.tracking_mode || 'individual' });
    } else if (type === 'user') {
      setUserForm({ employee_id: item.employee_id, name: item.name, role: item.role, department_id: item.department_id || '', assigned_stations: item.assigned_stations || [], password: '', email: item.email || '', phone: item.phone || '', reports_to_id: item.reports_to_id || '', assigned_division_id: item.assigned_division_id || '' });
    }
    setDialogOpen(true);
  };

  const handleDialogSubmit = () => {
    if (dialogMode === 'create') {
      if (dialogType === 'department') handleCreateDepartment();
      else if (dialogType === 'station') handleCreateStation();
      else if (dialogType === 'location') handleCreateLocation();
      else if (dialogType === 'sub-zone') handleCreateSubZone();
      else if (dialogType === 'asset-type') handleCreateAssetType();
      else if (dialogType === 'user') handleCreateUser();
    } else {
      if (dialogType === 'department') handleUpdateDepartment();
      else if (dialogType === 'station') handleUpdateStation();
      else if (dialogType === 'location') handleUpdateLocation();
      else if (dialogType === 'sub-zone') handleUpdateSubZone();
      else if (dialogType === 'asset-type') handleUpdateAssetType();
      else if (dialogType === 'user') handleUpdateUser();
    }
  };

  const toggleUserStation = (stationId) => {
    setUserForm(prev => ({
      ...prev,
      assigned_stations: prev.assigned_stations.includes(stationId)
        ? prev.assigned_stations.filter(s => s !== stationId)
        : [...prev.assigned_stations, stationId]
    }));
  };

  const addChecklistItem = () => {
    if (!assetTypeForm.checklist) return;
    const itemName = prompt('Enter checklist item name:');
    if (itemName) {
      setAssetTypeForm(prev => ({
        ...prev,
        checklist: [...prev.checklist, { name: itemName, description: '', expected_value: '' }]
      }));
    }
  };

  const removeChecklistItem = (index) => {
    setAssetTypeForm(prev => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== index)
    }));
  };

  // Filter supervisors by RO's department
  const getFilteredSupervisors = () => {
    if (!selectedRO) return [];
    const ro = users.find(u => u._id === selectedRO);
    if (!ro || !ro.department_id) return users.filter(u => u.role === 'supervisor');
    return users.filter(u => u.role === 'supervisor' && u.department_id === ro.department_id);
  };

  // Filter station staff by selected station
  const filteredStationStaff = personnelStationFilter === 'all'
    ? stationStaff
    : stationStaff.filter(s => s.station_id === personnelStationFilter);

  // Group by department
  const groupedByDepartment = filteredStationStaff.reduce((acc, station) => {
    const deptIds = new Set();
    station.supervisors?.forEach(s => s.department_id && deptIds.add(s.department_id));
    station.reporting_officers?.forEach(ro => ro.department_id && deptIds.add(ro.department_id));
    
    if (deptIds.size === 0) {
      if (!acc['no-department']) acc['no-department'] = [];
      acc['no-department'].push(station);
    } else {
      deptIds.forEach(deptId => {
        if (!acc[deptId]) acc[deptId] = [];
        acc[deptId].push(station);
      });
    }
    return acc;
  }, {});

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Manage system configuration</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`grid w-full ${isSuperadmin ? 'grid-cols-4 sm:grid-cols-12' : 'grid-cols-3 sm:grid-cols-10'} overflow-x-auto`}>
          <TabsTrigger value="departments" data-testid="tab-departments"><Briefcase className="h-4 w-4 mr-2 hidden sm:inline" /> Depts</TabsTrigger>
          <TabsTrigger value="stations"><Building2 className="h-4 w-4 mr-2 hidden sm:inline" /> Stations</TabsTrigger>
          <TabsTrigger value="locations"><MapPin className="h-4 w-4 mr-2 hidden sm:inline" /> Locations</TabsTrigger>
          <TabsTrigger value="asset-types"><Layers className="h-4 w-4 mr-2 hidden sm:inline" /> Asset Types</TabsTrigger>
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-2 hidden sm:inline" /> Users</TabsTrigger>
          <TabsTrigger value="link-supervisors"><Link className="h-4 w-4 mr-2 hidden sm:inline" /> Link</TabsTrigger>
          <TabsTrigger value="personnel-map"><TableIcon className="h-4 w-4 mr-2 hidden sm:inline" /> Personnel Map</TabsTrigger>
          <TabsTrigger value="transfer"><ArrowRightLeft className="h-4 w-4 mr-2 hidden sm:inline" /> Transfer</TabsTrigger>
          <TabsTrigger value="tags" data-testid="tab-tags"><Tag className="h-4 w-4 mr-2 hidden sm:inline" /> Tags</TabsTrigger>
          <TabsTrigger value="data-health" data-testid="tab-data-health"><ShieldAlert className="h-4 w-4 mr-2 hidden sm:inline" /> Health</TabsTrigger>
          {isSuperadmin && <TabsTrigger value="zones" data-testid="tab-zones"><Globe className="h-4 w-4 mr-2 hidden sm:inline" /> Zones</TabsTrigger>}
          {isSuperadmin && <TabsTrigger value="divisions" data-testid="tab-divisions"><GitBranch className="h-4 w-4 mr-2 hidden sm:inline" /> Divisions</TabsTrigger>}
        </TabsList>

        {/* DEPARTMENTS TAB */}
        <TabsContent value="departments" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{departments.length} Departments</h3>
            {user?.role === 'superadmin' ? (
              <Button onClick={() => openCreateDialog('department')} size="sm" data-testid="add-department-button">
                <Plus className="h-4 w-4 mr-1" /> Add Department
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground italic" data-testid="departments-readonly-note">
                Read-only — only Super Admin can manage departments
              </p>
            )}
          </div>
          <div className="space-y-2">
            {departments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No departments yet. {user?.role === 'superadmin' ? 'Click "Add Department" to create one (e.g. S&T, Civil, Electrical).' : 'Ask a Super Admin to add departments.'}
              </p>
            )}
            {departments.map(dept => (
              <Card key={dept._id} data-testid={`department-row-${dept._id}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium" data-testid={`department-name-${dept._id}`}>
                      {dept.name}
                      {dept.code && (
                        <span className="ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                          {dept.code}
                        </span>
                      )}
                    </p>
                    {dept.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{dept.description}</p>
                    )}
                  </div>
                  {user?.role === 'superadmin' && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog('department', dept)}
                        data-testid={`edit-department-${dept._id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteDepartment(dept._id)}
                        data-testid={`delete-department-${dept._id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* STATIONS TAB */}
        <TabsContent value="stations" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{stations.length} Stations</h3>
            <Button onClick={() => openCreateDialog('station')} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Station
            </Button>
          </div>
          <div className="space-y-2">
            {stations.map(station => (
              <Card key={station._id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{station.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Code: {station.code}
                      {station.zone && ` • Zone: ${station.zone}`}
                      {station.division && ` • Division: ${station.division}`}
                    </p>
                    {station.approving_supervisor_name && (
                      <p className="text-xs text-primary mt-1">
                        Approving Supervisor: {station.approving_supervisor_name}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog('station', station)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteStation(station._id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* LOCATIONS TAB */}
        <TabsContent value="locations" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{locations.length} Locations</h3>
            <Button onClick={() => openCreateDialog('location')} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Location
            </Button>
          </div>
          <div className="space-y-2">
            {stations.map(station => {
              const stationLocs = locations.filter(l => l.station_id === station._id);
              if (stationLocs.length === 0) return null;
              return (
                <Collapsible key={station._id} defaultOpen>
                  <Card>
                    <CollapsibleTrigger className="w-full">
                      <CardHeader className="p-3 hover:bg-accent/30 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium">{station.name}</CardTitle>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{stationLocs.length} locations</Badge>
                            <ChevronDown className="h-4 w-4" />
                          </div>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="p-3 pt-0 space-y-1">
                        {stationLocs.map(loc => {
                          const locSubZones = subZones.filter(z => z.location_id === loc._id);
                          return (
                            <Collapsible key={loc._id}>
                              <div className="flex items-center justify-between p-2 rounded hover:bg-muted">
                                <div className="flex items-center gap-2 min-w-0">
                                  <CollapsibleTrigger asChild>
                                    <button className="text-muted-foreground hover:text-foreground" data-testid={`loc-expand-${loc._id}`}>
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                  </CollapsibleTrigger>
                                  <span className="text-sm">{loc.name}</span>
                                  {locSubZones.length > 0 && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      {locSubZones.length} sub-zone{locSubZones.length === 1 ? '' : 's'}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7"
                                    data-testid={`loc-add-subzone-${loc._id}`}
                                    onClick={() => {
                                      setDialogType('sub-zone');
                                      setDialogMode('create');
                                      setEditingItem(null);
                                      setSubZoneForm({
                                        name: '', code: '', station_id: station._id,
                                        location_id: loc._id, description: '', order: 0,
                                      });
                                      setDialogOpen(true);
                                    }}
                                    title="Add sub-zone">
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog('location', loc)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteLocation(loc._id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              {locSubZones.length > 0 && (
                                <CollapsibleContent>
                                  <div className="ml-7 pl-3 border-l-2 border-dashed border-muted space-y-1 py-1">
                                    {locSubZones.map(sz => (
                                      <div key={sz._id} className="flex items-center justify-between p-1.5 rounded hover:bg-accent/40" data-testid={`subzone-row-${sz._id}`}>
                                        <div className="flex items-center gap-2 min-w-0 text-xs">
                                          <span className="font-medium text-slate-700">{sz.name}</span>
                                          {sz.code && <Badge variant="outline" className="text-[9px] py-0">{sz.code}</Badge>}
                                          {sz.description && <span className="text-muted-foreground truncate max-w-[200px]">· {sz.description}</span>}
                                        </div>
                                        <div className="flex gap-1">
                                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog('sub-zone', sz)}>
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteSubZone(sz._id)}>
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </CollapsibleContent>
                              )}
                            </Collapsible>
                          );
                        })}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        </TabsContent>

        {/* ASSET TYPES TAB */}
        <TabsContent value="asset-types" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{assetTypes.length} Asset Types</h3>
            <Button onClick={() => openCreateDialog('asset-type')} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Asset Type
            </Button>
          </div>
          <div className="space-y-2">
            {assetTypes.map(type => (
              <Card key={type._id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{type.name}</p>
                      {type.tracking_mode === 'grouped' && (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]" data-testid={`at-mode-badge-${type._id}`}>
                          Grouped
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Department: {type.department_name} • {type.checklist?.length || 0} checklist items
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog('asset-type', type)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteAssetType(type._id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* USERS TAB */}
        <TabsContent value="users" className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{users.length} Users</h3>
            <div className="flex gap-2">
              <Select value={personnelStationFilter} onValueChange={setPersonnelStationFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Stations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stations</SelectItem>
                  {stations.map(s => (
                    <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => openCreateDialog('user')} size="sm">
                <Plus className="h-4 w-4 mr-1" /> Add User
              </Button>
            </div>
          </div>
          
          {/* Group users by role */}
          {['superadmin', 'divisional_admin', 'admin', 'reporting_officer', 'approving_supervisor', 'supervisor'].map(role => {
            const roleUsers = users.filter(u => {
              const matchRole = u.role === role;
              if (!matchRole) return false;
              
              // Filter by station
              if (personnelStationFilter === 'all') return true;
              
              // For approving supervisors, check station assignment via stations collection
              if (role === 'approving_supervisor') {
                return stations.some(s => s.approving_supervisor_id === u._id && s._id === personnelStationFilter);
              }
              
              // For others, check assigned_stations
              return u.assigned_stations?.includes(personnelStationFilter);
            });
            
            if (roleUsers.length === 0) return null;
            
            return (
              <Card key={role}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    {roleLabels[role]} ({roleUsers.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {roleUsers.map(user => (
                    <Card key={user._id}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">
                            ID: {user.employee_id}
                            {user.department_name && ` • ${user.department_name}`}
                          </p>
                          {user.assigned_stations?.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Stations: {user.assigned_stations.map(sid => stations.find(s => s._id === sid)?.name).filter(Boolean).join(', ')}
                            </p>
                          )}
                          {user.reports_to_name && (
                            <p className="text-xs text-primary mt-1">Reports to: {user.reports_to_name}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={roleColors[user.role]}>{roleLabels[user.role]}</Badge>
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog('user', user)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(user._id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* LINK SUPERVISORS TAB */}
        <TabsContent value="link-supervisors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Link Supervisors to Reporting Officer</CardTitle>
              <p className="text-xs text-muted-foreground">Supervisors can only be linked to Reporting Officers in the same department</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Select Reporting Officer *</Label>
                <Select value={selectedRO} onValueChange={(v) => { setSelectedRO(v); setSelectedSupervisors([]); }}>
                  <SelectTrigger><SelectValue placeholder="Choose Reporting Officer" /></SelectTrigger>
                  <SelectContent>
                    {users.filter(u => u.role === 'reporting_officer').map(ro => (
                      <SelectItem key={ro._id} value={ro._id}>
                        {ro.name} ({ro.employee_id}) - {ro.department_name || 'No Department'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRO && (
                <div>
                  <Label>Select Supervisors (from same department) *</Label>
                  <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto border rounded-lg p-3">
                    {getFilteredSupervisors().length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No supervisors available in this department</p>
                    ) : (
                      getFilteredSupervisors().map(sup => (
                        <label key={sup._id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                          <Checkbox
                            checked={selectedSupervisors.includes(sup._id)}
                            onCheckedChange={() => toggleSupervisorSelection(sup._id)}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{sup.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {sup.employee_id}
                              {sup.reports_to_name && ` • Currently reports to: ${sup.reports_to_name}`}
                            </p>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <Button onClick={handleLinkSupervisors} disabled={!selectedRO || selectedSupervisors.length === 0} className="w-full">
                <Link className="h-4 w-4 mr-2" />
                Link {selectedSupervisors.length} Supervisor{selectedSupervisors.length !== 1 ? 's' : ''}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STATION PERSONNEL MAP TAB */}
        <TabsContent value="personnel-map" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <ZoneDivisionFilter
              value={{ zoneId: personnelZoneFilter, divisionId: personnelDivisionFilter, stationId: personnelStationFilter === 'all' ? '' : personnelStationFilter }}
              onChange={({ zoneId, divisionId, stationId }) => {
                setPersonnelZoneFilter(zoneId || '');
                setPersonnelDivisionFilter(divisionId || '');
                setPersonnelStationFilter(stationId || 'all');
              }}
              showStation
            />
            <Label className="text-sm font-medium">Dept:</Label>
            <Select value={personnelDepartmentFilter} onValueChange={setPersonnelDepartmentFilter}>
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {Object.keys(groupedByDepartment).map(deptId => {
            // Skip if department filter is active and doesn't match
            if (personnelDepartmentFilter !== 'all' && deptId !== personnelDepartmentFilter && deptId !== 'no-department') {
              return null;
            }
            
            const dept = departments.find(d => d._id === deptId);
            const deptName = dept?.name || 'No Department';
            const deptStations = groupedByDepartment[deptId];

            return (
              <Card key={deptId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{deptName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground">Station</th>
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground hidden md:table-cell">Zone</th>
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground hidden md:table-cell">Division</th>
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground">Approving Supervisor</th>
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground">Reporting Officer</th>
                          <th className="text-left p-2 text-xs font-medium text-muted-foreground">Supervisors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptStations.map(station => {
                          // Filter supervisors and ROs by department
                          const deptSupervisors = station.supervisors?.filter(s => 
                            s.department_id === deptId || (deptId === 'no-department' && !s.department_id)
                          ) || [];
                          
                          const deptROs = station.reporting_officers?.filter(ro =>
                            ro.department_id === deptId || (deptId === 'no-department' && !ro.department_id)
                          ) || [];
                          
                          // If no ROs for this department, show one row with unlinked supervisors
                          if (deptROs.length === 0) {
                            return (
                              <tr key={`${station.station_id}-${deptId}-no-ro`} className="border-b hover:bg-muted/30">
                                <td className="p-2 text-sm font-medium">{station.station_name}</td>
                                <td className="p-2 hidden md:table-cell">
                                  <span className="text-xs text-muted-foreground">{station.zone_name || '—'}</span>
                                </td>
                                <td className="p-2 hidden md:table-cell">
                                  <span className="text-xs text-muted-foreground">{station.division_name || '—'}</span>
                                </td>
                                <td className="p-2">
                                  {station.approving_supervisor ? (
                                    <button className="text-sm text-primary hover:underline">
                                      {station.approving_supervisor.name}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">Not assigned</span>
                                  )}
                                </td>
                                <td className="p-2">
                                  <span className="text-xs text-muted-foreground">None</span>
                                </td>
                                <td className="p-2">
                                  {deptSupervisors.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {deptSupervisors.map((sup, idx) => (
                                        <span key={sup._id}>
                                          <button className="text-xs text-primary hover:underline">
                                            {sup.name}
                                          </button>
                                          {idx < deptSupervisors.length - 1 && <span className="text-xs text-muted-foreground">, </span>}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">None</span>
                                  )}
                                </td>
                              </tr>
                            );
                          }
                          
                          // One row per Reporting Officer
                          return deptROs.map((ro, roIndex) => {
                            // Get supervisors linked to this RO in this department
                            const linkedSupervisors = deptSupervisors.filter(sup => sup.reports_to_id === ro._id);
                            
                            return (
                              <tr key={`${station.station_id}-${deptId}-${ro._id}`} className="border-b hover:bg-muted/30">
                                {/* Show station name only in first row */}
                                <td className="p-2 text-sm font-medium">
                                  {roIndex === 0 ? station.station_name : ''}
                                </td>
                                <td className="p-2 hidden md:table-cell">
                                  {roIndex === 0 ? <span className="text-xs text-muted-foreground">{station.zone_name || '—'}</span> : ''}
                                </td>
                                <td className="p-2 hidden md:table-cell">
                                  {roIndex === 0 ? <span className="text-xs text-muted-foreground">{station.division_name || '—'}</span> : ''}
                                </td>
                                <td className="p-2">
                                  {roIndex === 0 && station.approving_supervisor ? (
                                    <button className="text-sm text-primary hover:underline">
                                      {station.approving_supervisor.name}
                                    </button>
                                  ) : roIndex === 0 ? (
                                    <span className="text-xs text-muted-foreground">Not assigned</span>
                                  ) : ''}
                                </td>
                                <td className="p-2">
                                  <button className="text-sm text-primary hover:underline">
                                    {ro.name}
                                  </button>
                                </td>
                                <td className="p-2">
                                  {linkedSupervisors.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {linkedSupervisors.map((sup, idx) => (
                                        <span key={sup._id}>
                                          <button className="text-xs text-primary hover:underline">
                                            {sup.name}
                                          </button>
                                          {idx < linkedSupervisors.length - 1 && <span className="text-xs text-muted-foreground">, </span>}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">None linked</span>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* TRANSFER SUPERVISOR TAB */}
        <TabsContent value="transfer" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-primary" /> Transfer Assets to Another Supervisor
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Reassign every asset currently allocated to a supervisor over to another supervisor. Use this when a
                supervisor is transferred or retired. Choose &quot;Unassign&quot; to leave the assets without a supervisor.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">From Supervisor *</Label>
                  <Select value={transferFrom} onValueChange={setTransferFrom}>
                    <SelectTrigger data-testid="transfer-from-supervisor">
                      <SelectValue placeholder="Select supervisor" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.filter((u) => u.role === 'supervisor').map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.name} ({s.employee_id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">To Supervisor</Label>
                  <Select value={transferTo} onValueChange={setTransferTo}>
                    <SelectTrigger data-testid="transfer-to-supervisor">
                      <SelectValue placeholder="Select target (or unassign)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassign">— Unassign (no supervisor) —</SelectItem>
                      {users.filter((u) => u.role === 'supervisor' && u._id !== transferFrom).map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.name} ({s.employee_id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {transferFrom && (
                <p className="text-xs text-muted-foreground">
                  This action affects every asset currently assigned to{' '}
                  <span className="font-medium text-foreground">
                    {users.find((u) => u._id === transferFrom)?.name}
                  </span>
                  .
                </p>
              )}
              <Button
                onClick={handleTransferSupervisor}
                disabled={transferLoading || !transferFrom}
                data-testid="transfer-execute-button"
              >
                {transferLoading ? 'Transferring…' : 'Transfer Assets'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAGS TAB */}
        <TabsContent value="tags" className="space-y-3">
          <RemarkTagsManager />
        </TabsContent>

        {/* DATA HEALTH TAB */}
        <TabsContent value="data-health" className="space-y-3">
          <DataHealthPanel currentUser={user} />
        </TabsContent>

        {/* ZONES TAB — SA only */}
        {isSuperadmin && (
          <TabsContent value="zones" className="space-y-3" data-testid="tab-zones-content">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium">{zones.length} Railway Zones</h3>
              <Button size="sm" onClick={() => { setZoneForm({ name: '', code: '' }); setEditingZone(null); setShowZoneForm(v => !v); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Zone
              </Button>
            </div>
            {showZoneForm && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <p className="text-sm font-medium">{editingZone ? 'Edit Zone' : 'New Zone'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Name *</Label>
                      <Input value={zoneForm.name} onChange={e => setZoneForm(p => ({...p, name: e.target.value}))} placeholder="East Central Railway" data-testid="zone-name-input" />
                    </div>
                    <div>
                      <Label className="text-xs">Code *</Label>
                      <Input value={zoneForm.code} onChange={e => setZoneForm(p => ({...p, code: e.target.value.toUpperCase()}))} placeholder="ECR" data-testid="zone-code-input" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={editingZone ? handleUpdateZone : handleCreateZone} data-testid="zone-submit-button">
                      {editingZone ? 'Update' : 'Create'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowZoneForm(false); setEditingZone(null); }}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              {zones.map(zone => (
                <Card key={zone._id} data-testid={`zone-row-${zone._id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{zone.name}</p>
                      <p className="text-xs text-muted-foreground">Code: {zone.code}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => { setZoneForm({ name: zone.name, code: zone.code }); setEditingZone(zone); setShowZoneForm(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteZone(zone._id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}

        {/* DIVISIONS TAB — SA only */}
        {isSuperadmin && (
          <TabsContent value="divisions" className="space-y-3" data-testid="tab-divisions-content">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium">{divisions.length} Divisions</h3>
              <Button size="sm" onClick={() => { setDivisionForm({ name: '', code: '', zone_id: '' }); setEditingDivision(null); setShowDivisionForm(v => !v); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Division
              </Button>
            </div>
            {showDivisionForm && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <p className="text-sm font-medium">{editingDivision ? 'Edit Division' : 'New Division'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Name *</Label>
                      <Input value={divisionForm.name} onChange={e => setDivisionForm(p => ({...p, name: e.target.value}))} placeholder="Dhanbad Division" data-testid="division-name-input" />
                    </div>
                    <div>
                      <Label className="text-xs">Code *</Label>
                      <Input value={divisionForm.code} onChange={e => setDivisionForm(p => ({...p, code: e.target.value.toUpperCase()}))} placeholder="DHN" data-testid="division-code-input" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Zone *</Label>
                    <Select value={divisionForm.zone_id} onValueChange={v => setDivisionForm(p => ({...p, zone_id: v}))}>
                      <SelectTrigger data-testid="division-zone-select"><SelectValue placeholder="Select zone" /></SelectTrigger>
                      <SelectContent>
                        {zones.map(z => <SelectItem key={z._id} value={z._id}>{z.name} ({z.code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={editingDivision ? handleUpdateDivision : handleCreateDivision} data-testid="division-submit-button">
                      {editingDivision ? 'Update' : 'Create'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowDivisionForm(false); setEditingDivision(null); }}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              {divisions.map(div => (
                <Card key={div._id} data-testid={`division-row-${div._id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{div.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Code: {div.code} &middot; Zone: {div.zone_name} &middot; {div.station_count} station(s)
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setDivisionStationAssign(div._id); setAssigningStations([]); }} data-testid={`assign-stations-btn-${div._id}`}>
                          <MapPin className="h-3 w-3 mr-1" /> Assign Stations
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setDivisionForm({ name: div.name, code: div.code, zone_id: div.zone_id }); setEditingDivision(div); setShowDivisionForm(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteDivision(div._id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Station assignment panel */}
                    {divisionStationAssign === div._id && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium mb-2">Select stations to assign to {div.name}:</p>
                        <div className="grid grid-cols-2 gap-1 max-h-[200px] overflow-y-auto">
                          {stations.map(s => (
                            <label key={s._id} className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted cursor-pointer">
                              <Checkbox
                                checked={assigningStations.includes(s._id)}
                                onCheckedChange={() => setAssigningStations(prev => prev.includes(s._id) ? prev.filter(x => x !== s._id) : [...prev, s._id])}
                              />
                              <span className="truncate">{s.name}</span>
                              {s.division_id === div._id && <Badge className="text-[9px] py-0 px-1 ml-auto">current</Badge>}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={handleAssignStationsToDivision} disabled={assigningStations.length === 0}>
                            Assign {assigningStations.length} station(s)
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDivisionStationAssign(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* UNIVERSAL DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Create' : 'Edit'}{' '}
              {dialogType === 'department' && 'Department'}
              {dialogType === 'station' && 'Station'}
              {dialogType === 'location' && 'Location'}
              {dialogType === 'asset-type' && 'Asset Type'}
              {dialogType === 'user' && 'User'}
            </DialogTitle>
          </DialogHeader>

          {/* DEPARTMENT FORM */}
          {dialogType === 'department' && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="dept-name-input">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dept-name-input"
                  value={departmentForm.name}
                  onChange={(e) => {
                    setDepartmentForm({ ...departmentForm, name: e.target.value });
                    if (deptFieldErrors.name) setDeptFieldErrors({ ...deptFieldErrors, name: undefined });
                  }}
                  placeholder="e.g. Signal & Telecommunication"
                  aria-invalid={!!deptFieldErrors.name}
                  className={deptFieldErrors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
                  data-testid="department-name-input"
                />
                {deptFieldErrors.name && (
                  <p className="text-xs text-destructive mt-1" data-testid="department-name-error">
                    {deptFieldErrors.name}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="dept-code-input">
                  Code <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dept-code-input"
                  value={departmentForm.code}
                  onChange={(e) => {
                    // auto-uppercase, strip invalid chars, then cap to 8 valid chars
                    const cleaned = (e.target.value || '')
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 8);
                    setDepartmentForm({ ...departmentForm, code: cleaned });
                    if (deptFieldErrors.code) setDeptFieldErrors({ ...deptFieldErrors, code: undefined });
                  }}
                  placeholder="e.g. SNT"
                  aria-invalid={!!deptFieldErrors.code}
                  className={deptFieldErrors.code ? 'border-destructive focus-visible:ring-destructive' : ''}
                  data-testid="department-code-input"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Short unique identifier, 1-8 characters (letters/numbers), auto-uppercased.
                </p>
                {deptFieldErrors.code && (
                  <p className="text-xs text-destructive mt-1" data-testid="department-code-error">
                    {deptFieldErrors.code}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="dept-desc-input">Description</Label>
                <Input
                  id="dept-desc-input"
                  value={departmentForm.description}
                  onChange={(e) => setDepartmentForm({ ...departmentForm, description: e.target.value })}
                  placeholder="Brief purpose of this department"
                  data-testid="department-description-input"
                />
              </div>
              <Button onClick={handleDialogSubmit} className="w-full" data-testid="department-submit-button">
                {dialogMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </div>
          )}

          {/* STATION FORM */}
          {dialogType === 'station' && (
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={stationForm.name} onChange={(e) => setStationForm({...stationForm, name: e.target.value})} />
              </div>
              <div>
                <Label>Code *</Label>
                <Input value={stationForm.code} onChange={(e) => setStationForm({...stationForm, code: e.target.value})} />
              </div>
              <div>
                <Label>Division</Label>
                <Select value={stationForm.division_id || 'none'} onValueChange={(v) => setStationForm({...stationForm, division_id: v === 'none' ? '' : v})}>
                  <SelectTrigger data-testid="station-division-select"><SelectValue placeholder="Select Division" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {divisions.map(d => <SelectItem key={d._id} value={d._id}>{d.name} ({d.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Approving Supervisor (Optional)</Label>
                <Select value={stationForm.approving_supervisor_id || 'none'} onValueChange={(v) => setStationForm({...stationForm, approving_supervisor_id: v === 'none' ? '' : v})}>
                  <SelectTrigger><SelectValue placeholder="Select Approving Supervisor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {approvingSupervisors.map(sup => (
                      <SelectItem key={sup._id} value={sup._id}>{sup.name} ({sup.employee_id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleDialogSubmit} className="w-full">
                {dialogMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </div>
          )}

          {/* LOCATION FORM */}
          {dialogType === 'location' && (
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={locationForm.name} onChange={(e) => setLocationForm({...locationForm, name: e.target.value})} />
              </div>
              <div>
                <Label>Station *</Label>
                <Select value={locationForm.station_id} onValueChange={(v) => setLocationForm({...locationForm, station_id: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={locationForm.description} onChange={(e) => setLocationForm({...locationForm, description: e.target.value})} />
              </div>
              <Button onClick={handleDialogSubmit} className="w-full">
                {dialogMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </div>
          )}

          {/* SUB-ZONE FORM */}
          {dialogType === 'sub-zone' && (
            <div className="space-y-3" data-testid="subzone-form">
              <div>
                <Label>Name *</Label>
                <Input data-testid="subzone-name" value={subZoneForm.name} onChange={(e) => setSubZoneForm({...subZoneForm, name: e.target.value})} placeholder="e.g., Sub-Zone A" />
              </div>
              <div>
                <Label>Code</Label>
                <Input data-testid="subzone-code" value={subZoneForm.code} onChange={(e) => setSubZoneForm({...subZoneForm, code: e.target.value})} placeholder="e.g., SZ-A (used in auto asset IDs)" />
              </div>
              <div>
                <Label>Station *</Label>
                <Select value={subZoneForm.station_id} onValueChange={(v) => setSubZoneForm({...subZoneForm, station_id: v, location_id: ''})}>
                  <SelectTrigger data-testid="subzone-station"><SelectValue placeholder="Select Station" /></SelectTrigger>
                  <SelectContent>
                    {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location *</Label>
                <Select value={subZoneForm.location_id} onValueChange={(v) => setSubZoneForm({...subZoneForm, location_id: v})}>
                  <SelectTrigger data-testid="subzone-location"><SelectValue placeholder="Select Location" /></SelectTrigger>
                  <SelectContent>
                    {locations.filter(l => l.station_id === subZoneForm.station_id).map(l => (
                      <SelectItem key={l._id} value={l._id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={subZoneForm.description} onChange={(e) => setSubZoneForm({...subZoneForm, description: e.target.value})} placeholder="Optional" />
              </div>
              <div>
                <Label>Display Order</Label>
                <Input type="number" min="0" value={subZoneForm.order} onChange={(e) => setSubZoneForm({...subZoneForm, order: e.target.value})} />
              </div>
              <Button data-testid="subzone-submit" onClick={handleDialogSubmit} className="w-full">
                {dialogMode === 'create' ? 'Create Sub-Zone' : 'Update Sub-Zone'}
              </Button>
            </div>
          )}

          {/* ASSET TYPE FORM */}
          {dialogType === 'asset-type' && (
            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={assetTypeForm.name} onChange={(e) => setAssetTypeForm({...assetTypeForm, name: e.target.value})} />
              </div>
              <div>
                <Label>Department *</Label>
                <Select value={assetTypeForm.department_id} onValueChange={(v) => setAssetTypeForm({...assetTypeForm, department_id: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={assetTypeForm.description} onChange={(e) => setAssetTypeForm({...assetTypeForm, description: e.target.value})} />
              </div>
              <div>
                <Label>Tracking Mode *</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    data-testid="at-mode-individual"
                    onClick={() => setAssetTypeForm({...assetTypeForm, tracking_mode: 'individual'})}
                    className={`rounded-md border p-3 text-left transition ${assetTypeForm.tracking_mode === 'individual' ? 'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="text-sm font-semibold text-slate-800">Individual</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Each unit tracked separately (Lift, Escalator, AC, etc.)</div>
                  </button>
                  <button
                    type="button"
                    data-testid="at-mode-grouped"
                    onClick={() => setAssetTypeForm({...assetTypeForm, tracking_mode: 'grouped'})}
                    className={`rounded-md border p-3 text-left transition ${assetTypeForm.tracking_mode === 'grouped' ? 'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="text-sm font-semibold text-slate-800">Grouped (Count-based)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Bulk units in a sub-zone, e.g., 120 fans on a platform</div>
                  </button>
                </div>
              </div>
              <div>
                <Label>Checklist Items</Label>
                <div className="space-y-1 mt-1">
                  {assetTypeForm.checklist?.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-sm flex-1">{item.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeChecklistItem(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addChecklistItem} className="w-full">
                    <Plus className="h-3 w-3 mr-1" /> Add Item
                  </Button>
                </div>
              </div>
              <Button onClick={handleDialogSubmit} className="w-full">
                {dialogMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </div>
          )}

          {/* USER FORM */}
          {dialogType === 'user' && (
            <div className="space-y-3">
              <div>
                <Label>Employee ID *</Label>
                <Input value={userForm.employee_id} onChange={(e) => setUserForm({...userForm, employee_id: e.target.value})} disabled={dialogMode === 'edit'} />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={userForm.name} onChange={(e) => setUserForm({...userForm, name: e.target.value})} />
              </div>
              <div>
                <Label>Role *</Label>
                <Select value={userForm.role} onValueChange={(v) => setUserForm({...userForm, role: v})}>
                  <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="approving_supervisor">Approving Supervisor</SelectItem>
                    <SelectItem value="reporting_officer">Reporting Officer</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    {isSuperadmin && <SelectItem value="divisional_admin">Divisional Admin</SelectItem>}
                    {isSuperadmin && <SelectItem value="superadmin">Super Admin</SelectItem>}
                    {isSuperadmin && <SelectItem value="viewer">Viewer (Read-only)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {/* Division assignment — only for divisional_admin role */}
              {userForm.role === 'divisional_admin' && (
                <div>
                  <Label className="text-xs">Assigned Division *</Label>
                  <Select value={userForm.assigned_division_id || 'none'} onValueChange={v => setUserForm(p => ({...p, assigned_division_id: v === 'none' ? '' : v}))}>
                    <SelectTrigger data-testid="user-division-select"><SelectValue placeholder="Select Division" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {divisions.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Department</Label>
                <Select value={userForm.department_id || 'none'} onValueChange={(v) => setUserForm({...userForm, department_id: v === 'none' ? '' : v})}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Assigned Stations</Label>
                <div className="space-y-1 mt-1 max-h-[120px] overflow-y-auto">
                  {stations.map(s => (
                    <label key={s._id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={userForm.assigned_stations.includes(s._id)}
                        onCheckedChange={() => toggleUserStation(s._id)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Reports To (Reporting Officer)</Label>
                <Select value={userForm.reports_to_id || 'none'} onValueChange={(v) => setUserForm({...userForm, reports_to_id: v === 'none' ? '' : v})}>
                  <SelectTrigger><SelectValue placeholder="Select Reporting Officer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {users.filter(u => {
                      // Must be reporting officer
                      if (u.role !== 'reporting_officer') return false;
                      // Must be in same department
                      if (u.department_id !== userForm.department_id) return false;
                      // Must have overlapping stations
                      if (!userForm.assigned_stations || userForm.assigned_stations.length === 0) return true;
                      if (!u.assigned_stations || u.assigned_stations.length === 0) return false;
                      return userForm.assigned_stations.some(s => u.assigned_stations.includes(s));
                    }).map(ro => (
                      <SelectItem key={ro._id} value={ro._id}>{ro.name} ({ro.employee_id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Shows ROs from same department with overlapping stations
                </p>
              </div>
              <div>
                <Label>Password {dialogMode === 'edit' && '(leave blank to keep current)'}</Label>
                <Input type="password" value={userForm.password} onChange={(e) => setUserForm({...userForm, password: e.target.value})} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={userForm.phone} onChange={(e) => setUserForm({...userForm, phone: e.target.value})} />
              </div>
              <Button onClick={handleDialogSubmit} className="w-full">
                {dialogMode === 'create' ? 'Create' : 'Update'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
