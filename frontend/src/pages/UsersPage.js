import { useState, useEffect } from 'react';
import { usersAPI, departmentsAPI, stationsAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { toast } from 'sonner';
import { Plus, Search, Shield, Trash2, Pencil, ChevronDown, Users as UsersIcon } from 'lucide-react';
import SupervisorHistoryDrawer from '../components/SupervisorHistoryDrawer';

const roleLabels = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  reporting_officer: 'Reporting Officer',
  approving_supervisor: 'Approving Supervisor',
  supervisor: 'Supervisor',
  viewer: 'Viewer (Read-only)',
};

const roleColors = {
  superadmin: 'bg-primary/10 text-primary border-primary/20',
  admin: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))] border-[hsl(var(--info))]/20',
  reporting_officer: 'bg-[hsl(var(--pending))]/10 text-[hsl(var(--pending))] border-[hsl(var(--pending))]/20',
  approving_supervisor: 'bg-accent text-accent-foreground border-accent',
  supervisor: 'bg-muted text-muted-foreground border-border',
  viewer: 'bg-slate-100 text-slate-700 border-slate-300',
};

const roleOrder = ['superadmin', 'admin', 'approving_supervisor', 'reporting_officer', 'supervisor', 'viewer'];

export default function UsersPage() {
  const { user: currentUser, isSuperadmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [supervisorHistory, setSupervisorHistory] = useState(null);
  const [formData, setFormData] = useState({
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
    if (!formData.employee_id || !formData.name || !formData.password) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await usersAPI.create(formData);
      toast.success('User created successfully');
      setShowCreate(false);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to create user'));
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      employee_id: user.employee_id,
      name: user.name,
      role: user.role,
      department_id: user.department_id || '',
      assigned_stations: user.assigned_stations || [],
      password: '',
      email: user.email || '',
      phone: user.phone || ''
    });
    setShowEdit(true);
  };

  const handleUpdate = async () => {
    if (!formData.employee_id || !formData.name) {
      toast.error('Please fill required fields');
      return;
    }
    try {
      await usersAPI.update(editingUser._id, formData);
      toast.success('User updated successfully');
      setShowEdit(false);
      setEditingUser(null);
      resetForm();
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to update user'));
    }
  };

  const handleGrantAdmin = async (userId) => {
    try {
      await usersAPI.grantAdmin(userId, currentUser._id);
      toast.success('Admin powers granted');
      loadAll();
    } catch (e) {
      toast.error(errString(e, 'Failed to grant admin'));
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
    setFormData(prev => ({
      ...prev,
      assigned_stations: prev.assigned_stations.includes(stationId)
        ? prev.assigned_stations.filter(s => s !== stationId)
        : [...prev.assigned_stations, stationId]
    }));
  };

  const resetForm = () => {
    setFormData({ employee_id: '', name: '', role: 'supervisor', department_id: '', assigned_stations: [], password: '', email: '', phone: '' });
  };

  // Filter and group users
  const filteredUsers = users.filter(u => {
    const matchSearch = !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.employee_id?.toLowerCase().includes(search.toLowerCase());
    const matchRole = !filterRole || filterRole === 'all' || u.role === filterRole;
    return matchSearch && matchRole;
  });

  // Group by department
  const groupedByDepartment = departments.reduce((acc, dept) => {
    acc[dept._id] = {
      ...dept,
      users: filteredUsers.filter(u => u.department_id === dept._id)
    };
    return acc;
  }, {});

  // No department users
  const noDepartmentUsers = filteredUsers.filter(u => !u.department_id);

  // ─── FIX: defined as a function CALL (not a React component) so it doesn't
  // get a new component identity on every parent re-render, which was causing
  // <Input> elements to lose focus after each keystroke.
  const renderUserForm = (isEdit) => (
    <div className="space-y-4">
      <div>
        <Label>Employee ID *</Label>
        <Input value={formData.employee_id} onChange={(e) => setFormData({...formData, employee_id: e.target.value})} placeholder="e.g., SUP002" disabled={isEdit} />
      </div>
      <div>
        <Label>Name *</Label>
        <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Full name" />
      </div>
      <div>
        <Label>Role *</Label>
        <Select value={formData.role} onValueChange={(v) => setFormData({...formData, role: v})}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="supervisor">Supervisor</SelectItem>
            <SelectItem value="approving_supervisor">Approving Supervisor</SelectItem>
            <SelectItem value="reporting_officer">Reporting Officer</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            {isSuperadmin() && <SelectItem value="superadmin">Super Admin</SelectItem>}
            {isSuperadmin() && <SelectItem value="viewer">Viewer (Read-only)</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Department</Label>
        <Select value={formData.department_id} onValueChange={(v) => setFormData({...formData, department_id: v})}>
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
                checked={formData.assigned_stations.includes(s._id)}
                onCheckedChange={() => toggleStation(s._id)}
              />
              <span className="text-sm">{s.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <Label>Password {isEdit && '(leave blank to keep current)'}</Label>
        <Input type="password" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} placeholder={isEdit ? "Leave blank to keep current" : "Set password"} />
      </div>
      <div>
        <Label>Email</Label>
        <Input value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} placeholder="Email (optional)" />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} placeholder="Phone (optional)" />
      </div>
      <Button onClick={isEdit ? handleUpdate : handleCreate} className="w-full">
        {isEdit ? 'Update User' : 'Create User'}
      </Button>
    </div>
  );

  const UserCard = ({ user }) => (
    <div className="flex items-center justify-between p-3 border-l-2 border-primary/20 hover:border-primary/50 hover:bg-accent/30 transition-all">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
          {user.name?.charAt(0)}
        </div>
        <div>
          <p className="font-medium text-sm">{user.name}</p>
          <p className="text-xs text-muted-foreground">ID: {user.employee_id}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge className={roleColors[user.role] || ''}>{roleLabels[user.role] || user.role}</Badge>
        {(user.role === 'supervisor' || user.role === 'approving_supervisor') && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7" 
            onClick={() => setSupervisorHistory({ id: user._id, name: user.name })}
          >
            <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(user)}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        {isSuperadmin() && user.role !== 'superadmin' && user.role !== 'admin' && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => handleGrantAdmin(user._id)}>
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
        {user._id !== currentUser._id && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(user._id)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );

  const RoleSection = ({ roleKey, users }) => {
    if (users.length === 0) return null;
    return (
      <div className="mb-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-3">
          {roleLabels[roleKey]} ({users.length})
        </h4>
        <div className="space-y-1">
          {users.map(u => <UserCard key={u._id} user={u} />)}
        </div>
      </div>
    );
  };

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
            {renderUserForm(false)}
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
            <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Department Grouped View */}
      <div className="space-y-3">
        {Object.values(groupedByDepartment).map((dept) => {
          if (dept.users.length === 0) return null;
          
          // Group users by role within department
          const usersByRole = roleOrder.reduce((acc, role) => {
            acc[role] = dept.users.filter(u => u.role === role);
            return acc;
          }, {});

          return (
            <Collapsible key={dept._id} defaultOpen>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="p-4 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        {dept.name}
                        <Badge variant="outline" className="text-xs font-normal">{dept.users.length} users</Badge>
                      </CardTitle>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="p-4 pt-0">
                    {roleOrder.map(role => (
                      <RoleSection key={role} roleKey={role} users={usersByRole[role]} />
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}

        {/* Users without department */}
        {noDepartmentUsers.length > 0 && (
          <Collapsible defaultOpen>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="p-4 hover:bg-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      No Department
                      <Badge variant="outline" className="text-xs font-normal">{noDepartmentUsers.length} users</Badge>
                    </CardTitle>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-4 pt-0">
                  {roleOrder.map(role => {
                    const roleUsers = noDepartmentUsers.filter(u => u.role === role);
                    return <RoleSection key={role} roleKey={role} users={roleUsers} />;
                  })}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={(open) => { setShowEdit(open); if (!open) { setEditingUser(null); resetForm(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {renderUserForm(true)}
        </DialogContent>
      </Dialog>

      {/* Supervisor History Drawer */}
      <SupervisorHistoryDrawer
        supervisorId={supervisorHistory?.id}
        supervisorName={supervisorHistory?.name}
        open={!!supervisorHistory}
        onOpenChange={(open) => !open && setSupervisorHistory(null)}
      />
    </div>
  );
}
