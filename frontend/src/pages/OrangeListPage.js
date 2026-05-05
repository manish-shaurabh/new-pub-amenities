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
import { AlertTriangle, CheckCircle, Clock, Download, FileText, FileSpreadsheet } from 'lucide-react';

export default function OrangeListPage() {
  const { user, canApprove } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('orange');
  const [actionDialog, setActionDialog] = useState(null);
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
      toast.success('Asset approved as working - removed from list');
      setActionDialog(null);
      setRemarks('');
      loadItems();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  // Change 4: Export functions
  const handleExportExcel = (listType) => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
    window.open(`${backendUrl}/api/orange-list/export/excel?list_type=${listType || ''}`, '_blank');
  };

  const handleExportPDF = (listType) => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
    window.open(`${backendUrl}/api/orange-list/export/pdf?list_type=${listType || ''}`, '_blank');
  };

  // Change 4: Split into orange (< 24hrs) and red (> 24hrs)
  const orangeItems = items.filter(i => i.list_type === 'orange' && i.status !== 'pending_approval');
  const redItems = items.filter(i => i.list_type === 'red' && i.status !== 'pending_approval');
  const pendingItems = items.filter(i => i.status === 'pending_approval');

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  const ItemCard = ({ item }) => (
    <Card className={`border-l-4 ${
      item.list_type === 'red' ? 'border-l-red-600' :
      item.status === 'pending_approval' ? 'border-l-[hsl(var(--pending))]' : 'border-l-[hsl(var(--orange-list))]'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm">{item.asset_info?.asset_number || 'Unknown Asset'}</p>
              {item.list_type === 'red' && (
                <Badge className="bg-red-600 text-white border-0 text-[10px]">RED LIST</Badge>
              )}
              {item.list_type === 'orange' && item.status !== 'pending_approval' && (
                <Badge className="status-defective text-[10px]">ORANGE LIST</Badge>
              )}
              {item.status === 'pending_approval' && (
                <Badge className="status-pending text-[10px]">Pending Approval</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {item.asset_info?.asset_type_name} &middot; {item.asset_info?.station_name} &middot; {item.asset_info?.location_name}
            </p>
            <div className="flex items-center gap-3 mt-1">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-[hsl(var(--orange-list))]" />
            Defective Assets
          </h1>
          <p className="text-sm text-muted-foreground">Orange List (&lt;24hrs) &middot; Red List (&gt;24hrs)</p>
        </div>
        {/* Export buttons */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExportExcel(activeTab !== 'pending' ? activeTab : null)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportPDF(activeTab !== 'pending' ? activeTab : null)}>
            <FileText className="h-4 w-4 mr-1" /> PDF
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orange">
            <AlertTriangle className="h-4 w-4 mr-1 text-orange-500" />
            Orange ({orangeItems.length})
          </TabsTrigger>
          <TabsTrigger value="red">
            <AlertTriangle className="h-4 w-4 mr-1 text-red-600" />
            Red ({redItems.length})
          </TabsTrigger>
          <TabsTrigger value="pending">
            <Clock className="h-4 w-4 mr-1" />
            Pending ({pendingItems.length})
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
              {actionDialog?.item?.defective_since && (
                <p className="text-xs text-destructive mt-1">
                  Defective since: {new Date(actionDialog.item.defective_since).toLocaleString()}
                </p>
              )}
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
