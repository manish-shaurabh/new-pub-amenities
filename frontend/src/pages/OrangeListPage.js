import { useState, useEffect, useCallback } from 'react';
import { orangeListAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Clock, FileText, FileSpreadsheet, RefreshCw, CalendarIcon, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';

const PAGE_SIZE = 25;

export default function OrangeListPage() {
  const { user, canApprove } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('orange');
  const [actionDialog, setActionDialog] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [markedWorkingDate, setMarkedWorkingDate] = useState(null);
  const [markedWorkingTime, setMarkedWorkingTime] = useState('');

  // Role-scoped fetch: only superadmin/admin see global; everyone else scopes to their role.
  const isScoped = user && !['superadmin', 'admin'].includes(user.role);

  const loadItems = useCallback(async () => {
    if (!user?._id) return;
    try {
      const opts = { page, pageSize: PAGE_SIZE };
      if (isScoped) opts.for_user_id = user._id;
      const res = await orangeListAPI.listPaginated(opts);
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.total_pages || 1);
    } catch (e) {
      console.error('Failed to load orange list', e);
      toast.error(errString(e, 'Failed to load orange list'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?._id, isScoped, page]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Reset page when tab changes
  useEffect(() => { setPage(1); }, [activeTab]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadItems();
  };

  const resetDialog = () => {
    setActionDialog(null);
    setRemarks('');
    setMarkedWorkingDate(null);
    setMarkedWorkingTime('');
  };

  const openMarkWorkingDialog = (item) => {
    // Default to current date/time
    setMarkedWorkingDate(new Date());
    setMarkedWorkingTime(format(new Date(), 'HH:mm'));
    setRemarks('');
    setActionDialog({ type: 'mark_working', item });
  };

  const handleMarkWorking = async () => {
    if (!actionDialog?.item) return;
    setSubmitting(true);
    try {
      let marked_working_at = null;
      if (markedWorkingDate) {
        const date = new Date(markedWorkingDate);
        if (markedWorkingTime) {
          const [h, m] = markedWorkingTime.split(':');
          date.setHours(parseInt(h), parseInt(m));
        }
        marked_working_at = date.toISOString();
      }
      await orangeListAPI.markWorking(actionDialog.item._id, {
        marked_by: user._id,
        remarks,
        marked_working_at,
      });
      toast.success('Asset marked as working — pending ASUP approval');
      resetDialog();
      loadItems();
    } catch (e) {
      toast.error(errString(e, 'Failed to mark working'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!actionDialog?.item) return;
    setSubmitting(true);
    try {
      await orangeListAPI.approve(actionDialog.item._id, {
        approved_by: user._id,
        remarks,
      });
      toast.success('Asset approved as working — removed from list');
      resetDialog();
      loadItems();
    } catch (e) {
      toast.error(errString(e, 'Failed to approve'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!actionDialog?.item) return;
    setSubmitting(true);
    try {
      await orangeListAPI.rejectWorking(actionDialog.item._id, {
        rejected_by: user._id,
        remarks,
      });
      toast.success('Rectification rejected — asset returned to defective');
      resetDialog();
      loadItems();
    } catch (e) {
      toast.error(errString(e, 'Failed to reject rectification'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportExcel = (listType) => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
    window.open(`${backendUrl}/api/orange-list/export/excel?list_type=${listType || ''}`, '_blank');
  };

  const handleExportPDF = (listType) => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
    window.open(`${backendUrl}/api/orange-list/export/pdf?list_type=${listType || ''}`, '_blank');
  };

  const orangeItems = items.filter(i => i.list_type === 'orange' && i.status !== 'pending_approval');
  const redItems = items.filter(i => i.list_type === 'red' && i.status !== 'pending_approval');
  const yellowItems = items.filter(i => i.status === 'pending_approval');

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  const ItemCard = ({ item }) => (
    <Card className={`border-l-4 ${
      item.list_type === 'red' ? 'border-l-red-600' :
      item.status === 'pending_approval' ? 'border-l-yellow-500' : 'border-l-[hsl(var(--orange-list))]'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{item.asset_info?.asset_number || 'Unknown Asset'}</p>
              {item.list_type === 'red' && (
                <Badge className="bg-red-600 text-white border-0 text-[10px]">RED LIST</Badge>
              )}
              {item.list_type === 'orange' && item.status !== 'pending_approval' && (
                <Badge className="status-defective text-[10px]">ORANGE LIST</Badge>
              )}
              {item.status === 'pending_approval' && (
                <Badge className="bg-yellow-500 text-white border-0 text-[10px]">YELLOW LIST</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {item.asset_info?.asset_type_name} &middot; {item.asset_info?.station_name} &middot; {item.asset_info?.location_name}
            </p>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Reported by: {item.reporter_name}
              </p>
              {item.defective_since && (
                <p className="text-xs text-destructive font-medium">
                  Defective since: {new Date(item.defective_since).toLocaleString()}
                </p>
              )}
              {item.hours_defective !== undefined && (
                <Badge variant="outline" className="text-[10px]">
                  {item.hours_defective > 24
                    ? `${Math.floor(item.hours_defective / 24)}d ${Math.round(item.hours_defective % 24)}h`
                    : `${Math.round(item.hours_defective)}h`
                  }
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {item.status === 'defective' && (
              <Button
                size="sm"
                onClick={() => openMarkWorkingDialog(item)}
                data-testid="orange-list-mark-working-button"
              >
                Mark Working
              </Button>
            )}
            {item.status === 'pending_approval' && canApprove() && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => { setRemarks(''); setActionDialog({ type: 'approve', item }); }}
                  data-testid="orange-list-approve-button"
                >
                  <CheckCircle className="h-4 w-4 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setRemarks(''); setActionDialog({ type: 'reject', item }); }}
                  data-testid="orange-list-reject-button"
                >
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-[hsl(var(--orange-list))]" />
            Defective Assets
          </h1>
          <p className="text-sm text-muted-foreground">Orange List (&lt;24hrs) &middot; Red List (&gt;24hrs) &middot; Yellow List (pending approval)</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="orange-list-refresh-button"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportExcel(activeTab !== 'yellow' ? activeTab : null)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportPDF(activeTab !== 'yellow' ? activeTab : null)}>
            <FileText className="h-4 w-4 mr-1" /> PDF
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orange" data-testid="tab-orange">
            <AlertTriangle className="h-4 w-4 mr-1 text-orange-500" />
            Orange ({orangeItems.length})
          </TabsTrigger>
          <TabsTrigger value="red" data-testid="tab-red">
            <AlertTriangle className="h-4 w-4 mr-1 text-red-600" />
            Red ({redItems.length})
          </TabsTrigger>
          <TabsTrigger value="yellow" data-testid="tab-yellow-list">
            <Clock className="h-4 w-4 mr-1 text-yellow-500" />
            Yellow List ({yellowItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orange" className="space-y-3 mt-4">
          {orangeItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 text-[hsl(var(--ok))]/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No items in Orange List (defective &lt; 24 hours)</p>
              </CardContent>
            </Card>
          ) : (
            orangeItems.map(item => <ItemCard key={item._id} item={item} />)
          )}
        </TabsContent>

        <TabsContent value="red" className="space-y-3 mt-4">
          {redItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 text-[hsl(var(--ok))]/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No items in Red List (defective &gt; 24 hours)</p>
              </CardContent>
            </Card>
          ) : (
            redItems.map(item => <ItemCard key={item._id} item={item} />)
          )}
        </TabsContent>

        <TabsContent value="yellow" className="space-y-3 mt-4" data-testid="yellow-list-tab-content">
          {yellowItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No items awaiting approval</p>
              </CardContent>
            </Card>
          ) : (
            yellowItems.map(item => <ItemCard key={item._id} item={item} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        totalItems={total}
        loadedCount={items.length}
        loading={loading || refreshing}
        onPageChange={setPage}
        testIdPrefix="orange-list-pagination"
      />

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === 'mark_working' ? 'Mark Asset as Working' :
               actionDialog?.type === 'approve' ? 'Approve Working Status' :
               'Reject Rectification'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.type === 'mark_working'
                ? 'Record when the asset was fixed and submit for ASUP approval.'
                : actionDialog?.type === 'approve'
                ? 'Confirm field verification that the asset is working.'
                : 'Reject this rectification claim — the asset returns to defective status.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">{actionDialog?.item?.asset_info?.asset_number}</p>
              <p className="text-xs text-muted-foreground">
                {actionDialog?.item?.asset_info?.station_name} &middot; {actionDialog?.item?.asset_info?.location_name}
              </p>
              {actionDialog?.item?.defective_since && (
                <p className="text-xs text-destructive mt-1">
                  Defective since: {new Date(actionDialog.item.defective_since).toLocaleString()}
                </p>
              )}
            </div>

            {/* Date/Time picker — only for Mark Working */}
            {actionDialog?.type === 'mark_working' && (
              <div>
                <Label className="text-sm font-medium">Marked Working At</Label>
                <p className="text-[11px] text-muted-foreground mb-2">When was this asset fixed? (defaults to now)</p>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="flex-1 justify-start text-left font-normal" data-testid="marked-working-date-btn">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {markedWorkingDate ? format(new Date(markedWorkingDate), 'dd MMM yyyy') : 'Pick date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={markedWorkingDate ? new Date(markedWorkingDate) : undefined}
                        onSelect={(date) => setMarkedWorkingDate(date || new Date())}
                        disabled={(date) => date > new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    value={markedWorkingTime}
                    onChange={(e) => setMarkedWorkingTime(e.target.value)}
                    className="w-[130px]"
                    data-testid="marked-working-time-input"
                  />
                </div>
              </div>
            )}

            <div>
              <Label>Remarks{actionDialog?.type === 'reject' ? ' *' : ''}</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  actionDialog?.type === 'mark_working' ? 'Describe repairs done...' :
                  actionDialog?.type === 'approve' ? 'Field verification notes...' :
                  'Reason for rejection...'
                }
                className="mt-1"
                data-testid="action-dialog-remarks"
              />
            </div>

            <Button
              onClick={
                actionDialog?.type === 'mark_working' ? handleMarkWorking :
                actionDialog?.type === 'approve' ? handleApprove :
                handleReject
              }
              disabled={submitting || (actionDialog?.type === 'reject' && !remarks.trim())}
              variant={actionDialog?.type === 'reject' ? 'destructive' : 'default'}
              className="w-full"
              data-testid="action-dialog-confirm-button"
            >
              {submitting ? 'Processing...' :
               actionDialog?.type === 'mark_working' ? 'Confirm Mark Working' :
               actionDialog?.type === 'approve' ? 'Confirm Approval' :
               'Confirm Reject'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
