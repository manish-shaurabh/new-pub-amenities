import { useState, useEffect, useCallback, useMemo } from 'react';
import { orangeListAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import ZoneDivisionFilter from '../components/ZoneDivisionFilter';
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
import { AlertTriangle, CheckCircle, Clock, FileText, FileSpreadsheet, RefreshCw, CalendarIcon, XCircle, MessageSquare, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';
import RemarksThread from '../components/RemarksThread';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import { formatDateTime, formatDuration, toIstLiteral } from '../lib/utils';

const PAGE_SIZE = 25;

export default function OrangeListPage() {
  const { user, canApprove } = useAuth();
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('orange');
  const [page, setPage] = useState(1);
  const [actionDialog, setActionDialog] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [markedWorkingDate, setMarkedWorkingDate] = useState(null);
  const [markedWorkingTime, setMarkedWorkingTime] = useState('');
  const [expanded, setExpanded] = useState({});
  const [historyAsset, setHistoryAsset] = useState(null);
  const [etaCache, setEtaCache] = useState({});
  const [zdFilter, setZdFilter] = useState({ zoneId: '', divisionId: '', stationId: '' });

  // Role-scoped fetch: only superadmin/admin see global; everyone else scopes to their role.
  const isScoped = user && !['superadmin', 'admin'].includes(user.role);

  const loadItems = useCallback(async () => {
    if (!user?._id) return;
    try {
      const params = {};
      if (isScoped) params.for_user_id = user._id;
      const res = await orangeListAPI.list(params);
      setAllItems(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error('Failed to load orange list', e);
      toast.error(errString(e, 'Failed to load orange list'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?._id, isScoped]);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Reset page when tab changes
  useEffect(() => { setPage(1); }, [activeTab]);

  // Background-load ETAs for visible items (capped to 30 to limit calls)
  useEffect(() => {
    const BACKEND = process.env.REACT_APP_BACKEND_URL;
    const targets = allItems.filter(i => i.status !== 'pending_approval' && !etaCache[i.asset_id]).slice(0, 30);
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      await Promise.all(targets.map(async (it) => {
        try {
          const r = await fetch(`${BACKEND}/api/orange-list/${it.asset_id}/asset-stats?window_days=90`);
          if (!r.ok) return;
          const d = await r.json();
          updates[it.asset_id] = { eta_hrs: d.eta_hrs, source: d.eta_source };
        } catch (e) {
          // ETA is a best-effort enrichment — log but do not block list rendering.
          console.warn('[OrangeList] eta fetch failed for', it.asset_id, e);
        }
      }));
      if (!cancelled && Object.keys(updates).length) {
        setEtaCache(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const marked_working_at = markedWorkingDate
        ? toIstLiteral(markedWorkingDate, markedWorkingTime)
        : null;
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

  // ── Tab buckets — derived from the FULL unpaginated list so the tab
  // counts always reflect the true totals (not just the current page).
  const filteredItems = useMemo(() => {
    if (!zdFilter.stationId && !zdFilter.divisionId && !zdFilter.zoneId) return allItems;
    return allItems.filter(i => {
      if (zdFilter.stationId) return i.station_id === zdFilter.stationId;
      // For zone/division filtering, use station_id lookup — simplified here as pass-through
      return true;
    });
  }, [allItems, zdFilter]);

  const orangeItems = filteredItems.filter(i => i.list_type === 'orange' && i.status !== 'pending_approval');
  const redItems = filteredItems.filter(i => i.list_type === 'red' && i.status !== 'pending_approval');
  const yellowItems = allItems.filter(i => i.status === 'pending_approval');

  // Client-side pagination per active tab
  const activeBucket = activeTab === 'orange' ? orangeItems
                     : activeTab === 'red' ? redItems
                     : yellowItems;
  const total = activeBucket.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = activeBucket.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
              <button type="button"
                      onClick={() => setHistoryAsset({ id: item.asset_id, number: item.asset_info?.asset_number })}
                      className="font-medium text-sm hover:underline hover:text-teal-700"
                      data-testid={`ol-asset-link-${item._id}`}>
                {item.asset_info?.asset_number || 'Unknown Asset'}
              </button>
              <button type="button" title="View asset history & stats"
                      onClick={() => setHistoryAsset({ id: item.asset_id, number: item.asset_info?.asset_number })}
                      className="text-slate-400 hover:text-teal-700"
                      data-testid={`ol-history-icon-${item._id}`}>
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
              {item.list_type === 'red' && (
                <Badge className="bg-red-600 text-white border-0 text-[10px]">RED LIST</Badge>
              )}
              {item.list_type === 'orange' && item.status !== 'pending_approval' && (
                <Badge className="status-defective text-[10px]">ORANGE LIST</Badge>
              )}
              {item.status === 'pending_approval' && (
                <Badge className="bg-yellow-500 text-white border-0 text-[10px]">YELLOW LIST</Badge>
              )}
              {/* Deficiency-kind chip — only shown for non-default kinds. */}
              {(item.kind || 'defective') === 'missing' && (
                <Badge className="bg-purple-600 text-white border-0 text-[10px]"
                       data-testid={`ol-kind-missing-${item._id}`}>MISSING</Badge>
              )}
              {item.kind === 'needs_repair' && (
                <Badge className="bg-slate-500 text-white border-0 text-[10px]">REPAIR</Badge>
              )}
              {etaCache[item.asset_id]?.eta_hrs != null && (
                <Badge variant="outline" className="text-[10px] border-teal-300 text-teal-700"
                       data-testid={`ol-eta-${item._id}`}
                       title={`Tentative ETA — ${etaCache[item.asset_id].source === 'asset' ? 'this asset history' : 'asset-type @ station median'}`}>
                  ETA ~{etaCache[item.asset_id].eta_hrs}h
                </Badge>
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
                  Defective since: {formatDateTime(item.defective_since)}
                </p>
              )}
              {item.hours_defective != null && (
                <Badge variant="outline" className="text-[10px]">
                  {formatDuration(item.hours_defective)}
                </Badge>
              )}
              {/* Issue 2: Rectification time for yellow (pending_approval) items */}
              {item.status === 'pending_approval' && item.marked_working_at && (
                <p className="text-xs text-yellow-700 font-semibold" data-testid={`ol-repaired-at-${item._id}`}>
                  Repaired: {formatDateTime(item.marked_working_at)}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(prev => ({ ...prev, [item._id]: !prev[item._id] }))}
              data-testid={`orange-list-remarks-toggle-${item._id}`}
            >
              <MessageSquare className="h-4 w-4 mr-1" />
              Remarks
              {expanded[item._id] ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
            </Button>
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
        {expanded[item._id] && (
          <div className="mt-3 pt-3 border-t">
            <RemarksThread orangeListId={item._id} />
          </div>
        )}
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
        {/* Zone/Division filter row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-xs text-muted-foreground font-medium">Scope:</span>
          <ZoneDivisionFilter
            value={zdFilter}
            onChange={(v) => { setZdFilter(v); setPage(1); }}
            showStation
            compact
          />
          {(zdFilter.stationId || zdFilter.divisionId || zdFilter.zoneId) && (
            <button className="text-xs text-primary hover:underline" onClick={() => setZdFilter({ zoneId: '', divisionId: '', stationId: '' })}>
              Clear ↺
            </button>
          )}
        </div>
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
            items.map(item => <ItemCard key={item._id} item={item} />)
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
            items.map(item => <ItemCard key={item._id} item={item} />)
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
            items.map(item => <ItemCard key={item._id} item={item} />)
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
                  Defective since: {formatDateTime(actionDialog.item.defective_since)}
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
      <AssetHistoryDrawer
        assetId={historyAsset?.id}
        assetNumber={historyAsset?.number}
        open={!!historyAsset}
        onOpenChange={(o) => !o && setHistoryAsset(null)}
      />
    </div>
  );
}
