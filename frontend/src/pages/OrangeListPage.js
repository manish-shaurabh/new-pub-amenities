import { useState, useEffect } from 'react';
import { orangeListAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function OrangeListPage() {
  const { user, canApprove } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('defective');
  const [actionDialog, setActionDialog] = useState(null); // { type: 'mark_working' | 'approve', item }
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    try {
      const res = await orangeListAPI.list({});
      setItems(res.data);
    } catch (e) {
      console.error('Failed to load orange list', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkWorking = async () => {
    if (!actionDialog?.item) return;
    setSubmitting(true);
    try {
      await orangeListAPI.markWorking(actionDialog.item._id, {
        marked_by: user._id,
        remarks: remarks
      });
      toast.success('Asset marked as working - pending approval');
      setActionDialog(null);
      setRemarks('');
      loadItems();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to mark working');
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
        remarks: remarks
      });
      toast.success('Asset approved as working - removed from Orange List');
      setActionDialog(null);
      setRemarks('');
      loadItems();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  const defectiveItems = items.filter(i => i.status === 'defective');
  const pendingItems = items.filter(i => i.status === 'pending_approval');

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  const ItemCard = ({ item }) => (
    <Card className={`orange-stripe ${item.status === 'pending_approval' ? 'border-l-[hsl(var(--pending))]' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm">{item.asset_info?.asset_number || 'Unknown Asset'}</p>
              <Badge className={item.status === 'pending_approval' ? 'status-pending' : 'status-defective'}>
                {item.status === 'pending_approval' ? 'Pending Approval' : 'Defective'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {item.asset_info?.asset_type_name} &middot; {item.asset_info?.station_name} &middot; {item.asset_info?.location_name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reported by: {item.reporter_name} &middot; {new Date(item.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            {item.status === 'defective' && (
              <Button
                size="sm"
                onClick={() => setActionDialog({ type: 'mark_working', item })}
                data-testid="orange-list-mark-working-button"
              >
                Mark Working
              </Button>
            )}
            {item.status === 'pending_approval' && canApprove() && (
              <Button
                size="sm"
                variant="default"
                onClick={() => setActionDialog({ type: 'approve', item })}
                data-testid="orange-list-approve-button"
              >
                <CheckCircle className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-[hsl(var(--orange-list))]" />
          Orange List
        </h1>
        <p className="text-sm text-muted-foreground">Track and resolve defective assets</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="defective">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Defective ({defectiveItems.length})
          </TabsTrigger>
          <TabsTrigger value="pending">
            <Clock className="h-4 w-4 mr-1" />
            Pending Approval ({pendingItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="defective" className="space-y-3 mt-4">
          {defectiveItems.length === 0 ? (
            <Card data-testid="orange-list-empty-state">
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 text-[hsl(var(--ok))]/50 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No defective assets right now.</p>
                <p className="text-xs text-muted-foreground">Keep inspections consistent!</p>
              </CardContent>
            </Card>
          ) : (
            defectiveItems.map(item => <ItemCard key={item._id} item={item} />)
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {pendingItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No pending approvals</p>
              </CardContent>
            </Card>
          ) : (
            pendingItems.map(item => <ItemCard key={item._id} item={item} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === 'mark_working' ? 'Mark Asset as Working' : 'Approve Working Status'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">{actionDialog?.item?.asset_info?.asset_number}</p>
              <p className="text-xs text-muted-foreground">
                {actionDialog?.item?.asset_info?.station_name} &middot; {actionDialog?.item?.asset_info?.location_name}
              </p>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={actionDialog?.type === 'mark_working' ? 'Describe repairs done...' : 'Field verification notes...'}
                className="mt-1"
              />
            </div>
            <Button
              onClick={actionDialog?.type === 'mark_working' ? handleMarkWorking : handleApprove}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? 'Processing...' : (actionDialog?.type === 'mark_working' ? 'Confirm Mark Working' : 'Confirm Approval')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
