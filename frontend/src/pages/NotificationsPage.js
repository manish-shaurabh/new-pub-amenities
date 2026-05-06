import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationsAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger
} from '../components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Bell, Search, Filter, CheckCheck, Trash2, ChevronLeft, ChevronRight,
  X, Inbox, ExternalLink, Circle, CheckCircle2
} from 'lucide-react';

const PAGE_SIZE = 20;

const TYPE_LABEL = {
  alert: 'Alert',
  info: 'Info',
  reminder: 'Reminder',
  warning: 'Warning',
  approval: 'Approval',
};

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function relativeTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [page, setPage] = useState(1);
  const [readFilter, setReadFilter] = useState('all'); // all | unread | read
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user?._id) return;
    setLoading(true);
    try {
      const opts = {
        page,
        pageSize: PAGE_SIZE,
        unreadOnly: readFilter === 'unread',
        notificationType: typeFilter !== 'all' ? typeFilter : undefined,
        search: search || undefined,
        fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
        toDate: toDate ? new Date(toDate + 'T23:59:59').toISOString() : undefined,
      };
      const res = await notificationsAPI.listPaginated(user._id, opts);
      let list = res.data.items || [];
      // Read-only post-filter (backend supports unread_only, but not read-only directly)
      if (readFilter === 'read') {
        list = list.filter(n => n.is_read);
      }
      setItems(list);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch (e) {
      console.error('Failed to load notifications', e);
      toast.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [user?._id, page, readFilter, typeFilter, search, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [readFilter, typeFilter, search, fromDate, toDate]);

  const buildHref = (notif) => {
    if (!notif) return null;
    const t = notif.related_entity_type;
    const id = notif.related_entity_id;
    if (!id) return null;
    if (t === 'orange_list' || t === 'asset') {
      return `/inspection-history?asset_id=${id}`;
    }
    if (t === 'inspection') {
      return `/inspection-history?inspection_id=${id}`;
    }
    return null;
  };

  const handleOpen = async (notif) => {
    try {
      if (!notif.is_read) {
        await notificationsAPI.markRead(notif._id);
        setItems(prev => prev.map(n => n._id === notif._id ? { ...n, is_read: true } : n));
      }
    } catch (e) {
      console.error(e);
    }
    const href = buildHref(notif);
    if (href) navigate(href);
  };

  const toggleRead = async (notif, e) => {
    e?.stopPropagation();
    try {
      if (notif.is_read) {
        await notificationsAPI.markUnread(notif._id);
        setItems(prev => prev.map(n => n._id === notif._id ? { ...n, is_read: false } : n));
        toast.success('Marked as unread');
      } else {
        await notificationsAPI.markRead(notif._id);
        setItems(prev => prev.map(n => n._id === notif._id ? { ...n, is_read: true } : n));
        toast.success('Marked as read');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to update notification');
    }
  };

  const deleteOne = async (notif, e) => {
    e?.stopPropagation();
    try {
      await notificationsAPI.delete(notif._id);
      setItems(prev => prev.filter(n => n._id !== notif._id));
      setTotal(t => Math.max(0, t - 1));
      toast.success('Notification deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete notification');
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setReadFilter('all');
    setTypeFilter('all');
    setSearch('');
    setSearchInput('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const markAllRead = async () => {
    setBulkBusy(true);
    try {
      await notificationsAPI.markAllRead(user._id);
      toast.success('All notifications marked as read');
      await load();
    } catch (err) {
      console.error(err);
      toast.error('Failed to mark all as read');
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteAllRead = async () => {
    setBulkBusy(true);
    try {
      const res = await notificationsAPI.deleteRead(user._id);
      toast.success(`${res.data.deleted || 0} read notification(s) deleted`);
      await load();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete read notifications');
    } finally {
      setBulkBusy(false);
    }
  };

  const hasActiveFilters = readFilter !== 'all' || typeFilter !== 'all' || search || fromDate || toDate;

  return (
    <div className="space-y-4" data-testid="notifications-page">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notifications
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="notifications-total-count">
            {loading ? 'Loading...' : `${total} total notification${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            disabled={bulkBusy}
            data-testid="notifications-mark-all-read-button"
          >
            <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                data-testid="notifications-delete-read-button"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete read
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete read notifications?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove all notifications you have already read.
                  Unread notifications will be kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={deleteAllRead}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="notifications-delete-read-confirm-button"
                >
                  Delete read
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={clearFilters}
                data-testid="notifications-clear-filters-button"
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <form onSubmit={handleSearchSubmit} className="lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <div className="relative mt-1">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search title or message..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
                data-testid="notifications-search-input"
              />
            </div>
          </form>

          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={readFilter} onValueChange={setReadFilter}>
              <SelectTrigger className="mt-1" data-testid="notifications-read-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread only</SelectItem>
                <SelectItem value="read">Read only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="mt-1" data-testid="notifications-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="alert">Alert</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="approval">Approval</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1"
              data-testid="notifications-from-date"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1"
              data-testid="notifications-to-date"
            />
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? 'No notifications match your filters' : 'No notifications'}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y" data-testid="notifications-list">
              {items.map((notif) => {
                const href = buildHref(notif);
                return (
                  <li
                    key={notif._id}
                    onClick={() => handleOpen(notif)}
                    className={`p-4 hover:bg-muted/40 transition-colors cursor-pointer flex items-start gap-3 ${
                      !notif.is_read ? 'bg-accent/20' : ''
                    }`}
                    data-testid="notification-row"
                  >
                    <div className="pt-1.5">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          notif.notification_type === 'alert'
                            ? 'bg-destructive'
                            : notif.notification_type === 'warning'
                            ? 'bg-amber-500'
                            : notif.notification_type === 'approval'
                            ? 'bg-emerald-500'
                            : 'bg-primary'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm ${!notif.is_read ? 'font-semibold' : 'font-medium'}`}>
                            {notif.title}
                          </p>
                          {notif.notification_type && (
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                              {TYPE_LABEL[notif.notification_type] || notif.notification_type}
                            </Badge>
                          )}
                          {!notif.is_read && (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">NEW</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground" title={formatDate(notif.created_at)}>
                          {relativeTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{notif.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        {href && (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <ExternalLink className="h-3 w-3" /> Open related
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => toggleRead(notif, e)}
                          data-testid="notification-toggle-read-button"
                        >
                          {notif.is_read ? (
                            <><Circle className="h-3 w-3 mr-1" /> Mark unread</>
                          ) : (
                            <><CheckCircle2 className="h-3 w-3 mr-1" /> Mark read</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={(e) => deleteOne(notif, e)}
                          data-testid="notification-delete-button"
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} &middot; Showing {items.length} of {total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              data-testid="notifications-prev-page-button"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              data-testid="notifications-next-page-button"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
