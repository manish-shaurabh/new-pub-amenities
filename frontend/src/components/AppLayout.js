import { useState } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { notificationsAPI } from '../lib/api';
import { useEffect } from 'react';
import {
  LayoutDashboard, Box, ClipboardCheck, AlertTriangle,
  Users, Settings, Calendar, History, Menu, X, Bell, LogOut, ChevronDown, UserCircle, FileBarChart
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ScrollArea } from './ui/scroll-area';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: 'all' },
  { path: '/assets', label: 'Asset Registry', icon: Box, roles: ['superadmin', 'viewer'] },
  { path: '/inspection', label: 'New Inspection', icon: ClipboardCheck,
    roles: ['superadmin', 'admin', 'reporting_officer', 'approving_supervisor', 'supervisor'] },
  { path: '/inspection-history', label: 'Inspection History', icon: History, roles: 'all' },
  {
    path: '/orange-list', label: 'Orange / Red List', icon: AlertTriangle,
    roles: ['superadmin', 'admin', 'reporting_officer', 'approving_supervisor', 'supervisor', 'viewer']
  },
  { path: '/schedules', label: 'Schedules', icon: Calendar, roles: 'all' },
  { path: '/reports', label: 'Reports', icon: FileBarChart, roles: 'all' },
  { path: '/notifications', label: 'Notifications', icon: Bell, roles: 'all' },
  { path: '/admin', label: 'Admin Panel', icon: Settings, roles: ['superadmin', 'admin'] },
  {
    path: '/profile', label: 'My Profile', icon: UserCircle,
    roles: ['supervisor', 'approving_supervisor', 'reporting_officer']
  },
];

const roleLabels = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  reporting_officer: 'Reporting Officer',
  approving_supervisor: 'Approving Supervisor',
  supervisor: 'Supervisor',
  viewer: 'Viewer (Read-only)',
};

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (user?._id) {
      loadNotifications();
      const interval = setInterval(loadNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadNotifications = async () => {
    try {
      const countRes = await notificationsAPI.unreadCount(user._id);
      setUnreadCount(countRes.data.count);
      const listRes = await notificationsAPI.list(user._id, false);
      setNotifications(listRes.data.slice(0, 10));
    } catch (e) {
      console.error('Failed to load notifications', e);
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsAPI.markAllRead(user._id);
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (e) {
      console.error('Failed to mark all read', e);
    }
  };

  const filteredNavItems = navItems.filter(item => {
    if (item.roles === 'all') return true;
    return item.roles.includes(user?.role);
  });

  const NavLink = ({ item, onClick }) => {
    const isActive = location.pathname === item.path;
    return (
      <Link
        to={item.path}
        onClick={onClick}
        data-testid={`sidebar-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}-link`}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
          isActive
            ? 'bg-accent text-accent-foreground border-l-4 border-l-primary -ml-1 pl-3'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        <item.icon className="h-4 w-4 flex-shrink-0" />
        <span>{item.label}</span>
        {item.path === '/notifications' && unreadCount > 0 && (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 animate-pulse-badge">
            {unreadCount}
          </Badge>
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-[280px] border-r bg-card/60 backdrop-blur">
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Box className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">RailTrack</h1>
              <p className="text-[11px] text-muted-foreground">Asset Inspection</p>
            </div>
          </div>
        </div>
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-1">
            {filteredNavItems.map(item => (
              <NavLink key={item.path} item={item} />
            ))}
          </nav>
        </ScrollArea>
        <div className="p-4 border-t">
          <div
            className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
              ['supervisor','approving_supervisor','reporting_officer'].includes(user?.role)
                ? 'cursor-pointer hover:bg-muted' : ''
            }`}
            onClick={() => ['supervisor','approving_supervisor','reporting_officer'].includes(user?.role) && navigate('/profile')}
            data-testid="sidebar-user-profile-block"
          >
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground">{roleLabels[user?.role] || user?.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="sticky top-0 z-40 h-14 bg-background/80 backdrop-blur border-b flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" data-testid="mobile-nav-open-button">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <div className="p-6 border-b">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
                      <Box className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <h1 className="text-sm font-semibold">RailTrack</h1>
                      <p className="text-[11px] text-muted-foreground">Asset Inspection</p>
                    </div>
                  </div>
                </div>
                <ScrollArea className="flex-1 px-3 py-4">
                  <nav className="space-y-1">
                    {filteredNavItems.map(item => (
                      <NavLink key={item.path} item={item} onClick={() => setMobileOpen(false)} />
                    ))}
                  </nav>
                </ScrollArea>
              </SheetContent>
            </Sheet>
            <h2 className="text-sm font-medium text-muted-foreground hidden sm:block">
              {filteredNavItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" data-testid="topbar-notifications-button">
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] text-destructive-foreground flex items-center justify-center font-medium animate-pulse-badge">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="flex items-center justify-between p-3">
                  <h3 className="font-semibold text-sm">Notifications</h3>
                  {unreadCount > 0 && (
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                      Mark all read
                    </Button>
                  )}
                </div>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[300px]">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No notifications</p>
                  ) : (
                    notifications.map((notif) => {
                      // Build deep link based on related entity
                      let href = null;
                      if (notif.related_entity_type === 'orange_list' || notif.related_entity_type === 'asset') {
                        href = `/inspection-history?asset_id=${notif.related_entity_id}`;
                      } else if (notif.related_entity_type === 'inspection') {
                        href = `/inspection-history?inspection_id=${notif.related_entity_id}`;
                      }
                      const onClick = async () => {
                        try {
                          await notificationsAPI.markRead(notif._id);
                          setNotifications((prev) => prev.map((n) => n._id === notif._id ? { ...n, is_read: true } : n));
                          setUnreadCount((c) => Math.max(0, c - (!notif.is_read ? 1 : 0)));
                        } catch {}
                        if (href) navigate(href);
                      };
                      return (
                        <button
                          key={notif._id}
                          onClick={onClick}
                          className={`w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted/40 ${!notif.is_read ? 'bg-accent/30' : ''}`}
                          data-testid="notifications-panel-item"
                        >
                          <div className="flex items-start gap-2">
                            <div className={`h-2 w-2 rounded-full mt-1.5 flex-shrink-0 ${
                              notif.notification_type === 'alert' ? 'bg-destructive' : 'bg-primary'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{notif.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </ScrollArea>
                <DropdownMenuSeparator />
                <div className="p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center text-xs h-8"
                    onClick={() => navigate('/notifications')}
                    data-testid="topbar-notifications-view-all-button"
                  >
                    View all notifications
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {user?.name?.charAt(0) || 'U'}
                  </div>
                  <span className="hidden sm:inline text-sm">{user?.name}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{roleLabels[user?.role]}</p>
                  <p className="text-xs text-muted-foreground">ID: {user?.employee_id}</p>
                </div>
                <DropdownMenuSeparator />
                {['supervisor', 'approving_supervisor', 'reporting_officer'].includes(user?.role) && (
                  <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer">
                    <UserCircle className="h-4 w-4 mr-2" />
                    My Profile
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
