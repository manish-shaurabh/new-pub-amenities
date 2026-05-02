import { useState, useEffect } from 'react';
import { usersAPI, departmentsAPI, stationsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Search, Users, Shield, Trash2 } from 'lucide-react';

const roleLabels = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  reporting_officer: 'Reporting Officer',
  approving_supervisor: 'Approving Supervisor',
  supervisor: 'Supervisor',
};

const roleColors = {
  superadmin: 'bg-primary/10 text-primary border-primary/20',
  admin: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))] border-[hsl(var(--info))]/20',
  reporting_officer: 'bg-[hsl(var(--pending))]/10 text-[hsl(var(--pending))] border-[hsl(var(--pending))]/20',
  approving_supervisor: 'bg-accent text-accent-foreground border-accent',
  supervisor: 'bg-muted text-muted-foreground border-border',
};

export default function UsersPage() {
  const { user: currentUser, isSuperadmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({
    employee_id: '', name: '', role: 'supervisor', department_id: '', assigned_stations: [], password: '', email: '', phone: ''
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [usersRes, deptsRes, stationsRes] = await Promise.all([
        usersAPI.list({}),
        departmentsAPI.list(),
        stationsAPI.list()
      ]);
      setUsers(usersRes.data);
      setDepartments(deptsRes.data);
      setStations(stationsRes.data);
    } catch (e) {
      console.error('Failed to load', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newUser.employee_id || !newUser.name || !newUser.password) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await usersAPI.create(newUser);
      toast.success('User created successfully');
      setShowCreate(false);
      setNewUser({ employee_id: '', name: '', role: 'supervisor', department_id: '', assigned_stations: [], password: '', email: '', phone: '' });
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create user');
    }
  };

  const handleGrantAdmin = async (userId) => {
    try {
      await usersAPI.grantAdmin(userId, currentUser._id);
      toast.success('Admin powers granted');
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to grant admin');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure?')) return;
    try {
      await usersAPI.delete(id);
      toast.success('User deleted');
      loadAll();
    } catch (e) {
      toast.error('Failed to delete user');
    }
  };

  const toggleStation = (stationId) => {
    setNewUser(prev => ({
      ...prev,
      assigned_stations: prev.assigned_stations.includes(stationId)
        ? prev.assigned_stations.filter(s => s !== stationId)
        : [...prev.assigned_stations, stationId]
    }));
  };

  const filteredUsers = users.filter(u => {
    const matchSearch = !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.employee_id?.toLowerCase().includes(search.toLowerCase());
    const matchRole = !filterRole || filterRole === 'all' || u.role === filterRole;
    return matchSearch && matchRole;
  });

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground">{filteredUsers.length} users</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add User</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Employee ID *</Label>
                <Input value={newUser.employee_id} onChange={(e) => setNewUser({...newUser, employee_id: e.target.value})} placeholder="e.g., SUP002" />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={newUser.name} onChange={(e) => setNewUser({...newUser, name: e.target.value})} placeholder="Full name" />
              </div>
              <div>
                <Label>Role *</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({...newUser, role: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="approving_supervisor">Approving Supervisor</SelectItem>
                    <SelectItem value="reporting_officer">Reporting Officer</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    {isSuperadmin() && <SelectItem value="superadmin">Super Admin</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={newUser.department_id} onValueChange={(v) => setNewUser({...newUser, department_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map(d => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Assigned Stations</Label>
                <div className="space-y-2 mt-1 max-h-[150px] overflow-y-auto">
                  {stations.map(s => (
                    <label key={s._id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={newUser.assigned_stations.includes(s._id)}
                        onCheckedChange={() => toggleStation(s._id)}
                      />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Password *</Label>
                <Input type="password" value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} placeholder="Set password" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} placeholder="Email (optional)" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={newUser.phone} onChange={(e) => setNewUser({...newUser, phone: e.target.value})} placeholder="Phone (optional)" />
              </div>
              <Button onClick={handleCreate} className="w-full">Create User</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="table-filter-bar">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="approving_supervisor">Approving Supervisor</SelectItem>
            <SelectItem value="reporting_officer">Reporting Officer</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="superadmin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {filteredUsers.map((u) => (
          <Card key={u._id} className="table-row-hover">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    {u.name?.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{u.name}</p>
                    <p className="text-xs text-muted-foreground">ID: {u.employee_id} {u.department_name ? `| ${u.department_name}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={roleColors[u.role] || ''}>{roleLabels[u.role] || u.role}</Badge>
                  {isSuperadmin() && u.role !== 'superadmin' && u.role !== 'admin' && (
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => handleGrantAdmin(u._id)}>
                      <Shield className="h-3 w-3 mr-1" /> Grant Admin
                    </Button>
                  )}
                  {u._id !== currentUser._id && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(u._id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
