/**
 * OrangeListPanel — compact Orange/Red/Yellow list embedded in role dashboards.
 *
 * mode='sup'  → Orange + Red tabs, Mark Working action (with date/time picker)
 * mode='asup' → Yellow List only, Approve + Reject actions
 * mode='ro'   → Orange + Red + Yellow tabs, read-only
 */
import { useState, useEffect, useCallback } from 'react';
import { orangeListAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, CalendarIcon, XCircle, Wrench, MessageSquare, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { formatDateTimeCompact, formatDateTime, formatDuration, toIstLiteral } from '../lib/utils';
import RemarksThread from './RemarksThread';
import AssetHistoryDrawer from './AssetHistoryDrawer';

export default function OrangeListPanel({ userId, mode = 'sup' }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionDialog, setActionDialog] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [markedWorkingDate, setMarkedWorkingDate] = useState(null);
  const [markedWorkingTime, setMarkedWorkingTime] = useState('');
  const [activeTab, setActiveTab] = useState(mode === 'asup' ? 'yellow' : 'orange');
  const [expanded, setExpanded] = useState({}); // { [itemId]: true } for remarks thread
  const [historyAsset, setHistoryAsset] = useState(null);
  const [etaCache, setEtaCache] = useState({}); // { [asset_id]: { eta_hrs, n } }

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await orangeListAPI.listPaginated({ for_user_id: userId, pageSize: 100 });
      setItems(res.data.items || []);
    } catch (e) {
      toast.error(errString(e, 'Failed to load defects'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Background-load ETAs for all open items (capped to first 30 to limit calls)
  useEffect(() => {
    const BACKEND = process.env.REACT_APP_BACKEND_URL;
    const targets = items.filter(i => i.status !== 'pending_approval' && !etaCache[i.asset_id]).slice(0, 30);
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
        } catch (e) { /* ignore */ }
      }));
      if (!cancelled && Object.keys(updates).length) {
        setEtaCache(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetDialog = () => {
    setActionDialog(null);
    setRemarks('');
    setMarkedWorkingDate(null);
    setMarkedWorkingTime('');
  };

  const openMarkWorkingDialog = (item) => {
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
      load();
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
      await orangeListAPI.approve(actionDialog.item._id, { approved_by: user._id, remarks });
      toast.success('Approved — asset removed from list');
      resetDialog();
      load();
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
      await orangeListAPI.rejectWorking(actionDialog.item._id, { rejected_by: user._id, remarks });
      toast.success('Rectification rejected — asset returned to defective');
      resetDialog();
      load();
    } catch (e) {
      toast.error(errString(e, 'Failed to reject'));
    } finally {
      setSubmitting(false);
    }
  };

  const orangeItems = items.filter(i => i.list_type === 'orange' && i.status !== 'pending_approval');
  const redItems = items.filter(i => i.list_type === 'red' && i.status !== 'pending_approval');
  const yellowItems = items.filter(i => i.status === 'pending_approval');

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-lg" />)}
      </div>
    );
  }

  const ItemRow = ({ item }) => {
    const isDefective = item.status === 'defective';
    const isPending = item.status === 'pending_approval';
    const isOpen = !!expanded[item._id];
    return (
      <div className="border-b last:border-0">
        <div className="flex items-center justify-between px-3 py-2.5 gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0 ${
            // Issue 7 fix: isPending checked BEFORE list_type so yellow items show
            // yellow icon regardless of their original orange/red classification.
            isPending                ? 'bg-yellow-50 text-yellow-600' :
            item.list_type === 'red' ? 'bg-red-50 text-red-600' :
            'bg-orange-50 text-orange-600'
          }`}>
            <Wrench className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button"
                      onClick={() => setHistoryAsset({ id: item.asset_id, number: item.asset_info?.asset_number })}
                      className="text-sm font-medium truncate hover:underline hover:text-teal-700"
                      data-testid={`ol-asset-link-${item._id}`}>
                {item.asset_info?.asset_number || '—'}
              </button>
              <button type="button" title="View history & stats"
                      onClick={() => setHistoryAsset({ id: item.asset_id, number: item.asset_info?.asset_number })}
                      className="text-slate-400 hover:text-teal-700"
                      data-testid={`ol-history-icon-${item._id}`}>
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
              {item.list_type === 'red' && isDefective && (
                <Badge className="bg-red-600 text-white border-0 text-[9px] px-1 py-0">RED</Badge>
              )}
              {item.list_type === 'orange' && isDefective && (
                <Badge className="bg-orange-500 text-white border-0 text-[9px] px-1 py-0">ORANGE</Badge>
              )}
              {isPending && (
                <Badge className="bg-yellow-500 text-white border-0 text-[9px] px-1 py-0">YELLOW</Badge>
              )}
              {etaCache[item.asset_id]?.eta_hrs != null && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-teal-300 text-teal-700"
                       data-testid={`ol-eta-${item._id}`}
                       title={`Tentative repair ETA — ${etaCache[item.asset_id].source === 'asset' ? 'this asset history' : 'asset-type @ station median'}`}>
                  ETA ~{etaCache[item.asset_id].eta_hrs}h
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {item.asset_info?.asset_type_name} &middot; {item.asset_info?.location_name}
            </p>
            {item.defective_since && (
              <p className="text-[10px] text-destructive">
                Since {formatDateTimeCompact(item.defective_since)}
                {item.hours_defective != null && (
                  <span className="ml-1 text-muted-foreground">
                    ({formatDuration(item.hours_defective)})
                  </span>
                )}
              </p>
            )}
            {/* Issue 2: Show rectification time on yellow items so ASUP can see WHEN the SUP claimed repair */}
            {isPending && item.marked_working_at && (
              <p className="text-[10px] text-yellow-700 font-medium mt-0.5" data-testid={`panel-repaired-at-${item._id}`}>
                Repaired: {formatDateTimeCompact(item.marked_working_at)}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0 items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setExpanded(prev => ({ ...prev, [item._id]: !prev[item._id] }))}
            data-testid={`panel-remarks-toggle-${item._id}`}
          >
            <MessageSquare className="h-3 w-3 mr-1" />
            Remarks
            {isOpen ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
          </Button>
          {mode === 'sup' && isDefective && (
            <Button
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => openMarkWorkingDialog(item)}
              data-testid={`panel-mark-working-${item._id}`}
            >
              Mark Working
            </Button>
          )}
          {mode === 'asup' && isPending && (
            <>
              <Button
                size="sm"
                className="h-7 text-xs px-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => { setRemarks(''); setActionDialog({ type: 'approve', item }); }}
                data-testid={`panel-approve-${item._id}`}
              >
                <CheckCircle className="h-3 w-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs px-2"
                onClick={() => { setRemarks(''); setActionDialog({ type: 'reject', item }); }}
                data-testid={`panel-reject-${item._id}`}
              >
                <XCircle className="h-3 w-3 mr-1" /> Reject
              </Button>
            </>
          )}
        </div>
        </div>
        {isOpen && (
          <div className="px-3 pb-3 pt-1 bg-muted/20">
            <RemarksThread orangeListId={item._id} />
          </div>
        )}
      </div>
    );
  };

  const EmptyState = ({ text }) => (
    <div className="py-10 text-center">
      <CheckCircle className="h-8 w-8 text-emerald-500/50 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Summary row + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {orangeItems.length > 0 && (
            <span className="text-orange-600 font-medium">{orangeItems.length} orange</span>
          )}
          {redItems.length > 0 && (
            <span className="text-red-600 font-medium">{redItems.length} red</span>
          )}
          {yellowItems.length > 0 && (
            <span className="text-yellow-600 font-medium">{yellowItems.length} pending approval</span>
          )}
          {orangeItems.length === 0 && redItems.length === 0 && yellowItems.length === 0 && (
            <span>No active defects in your scope</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setRefreshing(true); load(); }}
          disabled={refreshing}
          className="h-7 text-xs"
          data-testid="panel-refresh"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ASUP: Yellow List only */}
      {mode === 'asup' && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-yellow-500" />
            <p className="text-xs font-medium">Awaiting Your Approval</p>
            <Badge className="bg-yellow-500 text-white border-0 text-[10px]">{yellowItems.length}</Badge>
          </div>
          {yellowItems.length === 0
            ? <EmptyState text="No items awaiting your approval" />
            : yellowItems.map(item => <ItemRow key={item._id} item={item} />)
          }
        </Card>
      )}

      {/* SUP / RO: Tabbed view */}
      {mode !== 'asup' && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-8">
            <TabsTrigger value="orange" className="text-xs h-7" data-testid="panel-tab-orange">
              <AlertTriangle className="h-3 w-3 mr-1 text-orange-500" />
              Orange ({orangeItems.length})
            </TabsTrigger>
            <TabsTrigger value="red" className="text-xs h-7" data-testid="panel-tab-red">
              <AlertTriangle className="h-3 w-3 mr-1 text-red-600" />
              Red ({redItems.length})
            </TabsTrigger>
            {mode === 'ro' && (
              <TabsTrigger value="yellow" className="text-xs h-7" data-testid="panel-tab-yellow">
                <Clock className="h-3 w-3 mr-1 text-yellow-500" />
                Yellow ({yellowItems.length})
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="orange" className="mt-2">
            <Card className="overflow-hidden">
              {orangeItems.length === 0
                ? <EmptyState text="No orange list items (defective < 24h)" />
                : orangeItems.map(item => <ItemRow key={item._id} item={item} />)
              }
            </Card>
          </TabsContent>

          <TabsContent value="red" className="mt-2">
            <Card className="overflow-hidden">
              {redItems.length === 0
                ? <EmptyState text="No red list items (defective > 24h)" />
                : redItems.map(item => <ItemRow key={item._id} item={item} />)
              }
            </Card>
          </TabsContent>

          {mode === 'ro' && (
            <TabsContent value="yellow" className="mt-2">
              <Card className="overflow-hidden">
                {yellowItems.length === 0
                  ? <EmptyState text="No items awaiting approval" />
                  : yellowItems.map(item => <ItemRow key={item._id} item={item} />)
                }
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}

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
                : 'Reject this rectification claim — asset returns to defective.'}
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

            {actionDialog?.type === 'mark_working' && (
              <div>
                <Label className="text-sm font-medium">Marked Working At</Label>
                <p className="text-[11px] text-muted-foreground mb-2">When was this asset fixed? (defaults to now)</p>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start text-left font-normal"
                        data-testid="panel-marked-working-date"
                      >
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
                    data-testid="panel-marked-working-time"
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
                data-testid="panel-action-remarks"
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
              data-testid="panel-action-confirm"
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
