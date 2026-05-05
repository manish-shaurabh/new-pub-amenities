import { useState, useEffect } from 'react';
import { inspectionsAPI, assetsAPI, assetTypesAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ClipboardCheck, Users, Calendar, ChevronDown, User, FileText, Image as ImageIcon } from 'lucide-react';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';

export default function InspectionHistoryPage() {
  const { user } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [assetHistory, setAssetHistory] = useState(null);

  // Scope determination: only Superadmin/Admin see everything; other roles
  // are scoped server-side via for_user_id.
  const isScoped = user && !['superadmin', 'admin'].includes(user.role);

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [user?._id]);

  const loadAll = async () => {
    if (!user) return;
    try {
      const params = { limit: 200 };
      if (isScoped) params.for_user_id = user._id;
      const [inspRes, assetsRes, typesRes] = await Promise.all([
        inspectionsAPI.list(params),
        assetsAPI.list({}),
        assetTypesAPI.list()
      ]);
      setInspections(inspRes.data);
      setAssets(assetsRes.data);
      setAssetTypes(typesRes.data);
    } catch (e) {
      console.error('Failed to load', e);
    } finally {
      setLoading(false);
    }
  };

  // Build a map: assetId -> [inspections]
  const inspectionsByAsset = inspections.reduce((acc, insp) => {
    insp.items?.forEach(item => {
      if (!acc[item.asset_id]) acc[item.asset_id] = [];
      acc[item.asset_id].push({
        ...insp,
        assetItem: item
      });
    });
    return acc;
  }, {});

  // Filter assets
  const filteredAssets = assets.filter(a => {
    const hasInspections = inspectionsByAsset[a._id]?.length > 0;
    if (!hasInspections) return false;

    const matchType = !filterType || filterType === 'all' || a.asset_type_id === filterType;
    const matchStatus = !filterStatus || filterStatus === 'all' || a.status === filterStatus;
    return matchType && matchStatus;
  });

  // Group by asset type
  const groupedByType = assetTypes.reduce((acc, type) => {
    const typeAssets = filteredAssets.filter(a => a.asset_type_id === type._id);
    if (typeAssets.length > 0) {
      acc[type._id] = {
        ...type,
        assets: typeAssets
      };
    }
    return acc;
  }, {});

  const statusBadge = (status) => {
    const styles = {
      ok: 'status-working',
      not_ok: 'status-defective',
      needs_repair: 'status-pending'
    };
    return <Badge className={styles[status] || 'bg-muted'}>{status?.replace('_', ' ')}</Badge>;
  };

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inspection History</h1>
        <p className="text-sm text-muted-foreground">{filteredAssets.length} assets with inspection history</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Asset Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Asset Types</SelectItem>
            {assetTypes.map(t => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="working">Working</SelectItem>
            <SelectItem value="defective">Defective</SelectItem>
            <SelectItem value="pending_approval">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Asset-wise Inspection History */}
      <div className="space-y-3">
        {Object.keys(groupedByType).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No inspection history found</p>
            </CardContent>
          </Card>
        ) : (
          Object.values(groupedByType).map((type) => (
            <Collapsible key={type._id} defaultOpen>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="p-4 hover:bg-accent/30 transition-colors cursor-pointer">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        {type.name}
                        <Badge variant="outline" className="text-xs font-normal">{type.assets.length} assets</Badge>
                      </CardTitle>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="p-4 pt-0 space-y-3">
                    {type.assets.map(asset => {
                      const assetInspections = inspectionsByAsset[asset._id] || [];
                      // Sort by latest first
                      const sorted = assetInspections.sort((a, b) => 
                        new Date(b.inspection_at || b.created_at) - new Date(a.inspection_at || a.created_at)
                      );

                      return (
                        <Collapsible key={asset._id} defaultOpen={false}>
                          <Card className="border-l-2 border-primary/20">
                            <CollapsibleTrigger className="w-full">
                              <CardHeader className="p-3 hover:bg-accent/30 transition-colors cursor-pointer">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setAssetHistory({ id: asset._id, number: asset.asset_number }); }}
                                      className="font-medium text-sm hover:text-primary transition-colors"
                                    >
                                      {asset.asset_number}
                                    </button>
                                    <Badge className={asset.status === 'working' ? 'status-working' : 'status-defective'}>
                                      {asset.status}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {asset.station_name} &middot; {asset.location_name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">{sorted.length} inspections</Badge>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
                                  </div>
                                </div>
                              </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <CardContent className="p-3 pt-0 space-y-2">
                                {sorted.map((insp, idx) => (
                                  <div
                                    key={`${insp._id}-${idx}`}
                                    className="p-3 rounded-lg border hover:bg-accent/30 transition-colors cursor-pointer"
                                    onClick={() => setSelectedInspection(insp)}
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                          <span className="text-xs font-medium">
                                            {new Date(insp.inspection_at || insp.created_at).toLocaleString()}
                                          </span>
                                          <Badge variant={insp.inspection_type === 'sig' ? 'default' : 'secondary'} className="text-[10px]">
                                            {insp.inspection_type === 'sig' ? 'SIG' : 'Individual'}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          <User className="h-3 w-3" />
                                          <span>{insp.inspector_name}</span>
                                        </div>
                                      </div>
                                      {insp.assetItem && statusBadge(insp.assetItem.status)}
                                    </div>

                                    {insp.assetItem?.checklist_responses?.length > 0 && (
                                      <div className="mt-2 pt-2 border-t">
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Checklist</p>
                                        <div className="flex flex-wrap gap-1">
                                          {insp.assetItem.checklist_responses.map((check, cidx) => (
                                            <Badge
                                              key={cidx}
                                              variant={check.status === 'pass' ? 'default' : 'destructive'}
                                              className="text-[10px] px-1.5 py-0"
                                            >
                                              {check.name}: {check.status}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {insp.assetItem?.remarks && (
                                      <div className="mt-2 pt-2 border-t">
                                        <div className="flex items-start gap-1.5">
                                          <FileText className="h-3 w-3 text-muted-foreground mt-0.5" />
                                          <p className="text-xs text-muted-foreground">{insp.assetItem.remarks}</p>
                                        </div>
                                      </div>
                                    )}

                                    {insp.assetItem?.photo_urls?.length > 0 && (
                                      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                                        <ImageIcon className="h-3 w-3" />
                                        <span>{insp.assetItem.photo_urls.length} photo(s)</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </CardContent>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      );
                    })}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))
        )}
      </div>

      {/* Inspection Detail Modal */}
      <Dialog open={!!selectedInspection} onOpenChange={(open) => !open && setSelectedInspection(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inspection Details</DialogTitle>
          </DialogHeader>
          {selectedInspection && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Type</p>
                  <Badge variant={selectedInspection.inspection_type === 'sig' ? 'default' : 'secondary'}>
                    {selectedInspection.inspection_type === 'sig' ? 'SIG' : 'Individual'}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Station</p>
                  <p className="font-medium">{selectedInspection.station_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Inspector</p>
                  <p className="font-medium">{selectedInspection.inspector_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Date & Time</p>
                  <p className="font-medium">{new Date(selectedInspection.inspection_at || selectedInspection.created_at).toLocaleString()}</p>
                </div>
              </div>

              {selectedInspection.inspection_type === 'sig' && selectedInspection.participants?.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-2">SIG Participants</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedInspection.participants.map((p, idx) => (
                      <Badge key={idx} variant="outline">{p.name}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedInspection.assetItem && (
                <div className="border-t pt-4">
                  <p className="font-medium mb-3">Asset Inspection Result</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      {statusBadge(selectedInspection.assetItem.status)}
                    </div>
                    
                    {selectedInspection.assetItem.checklist_responses?.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">Checklist</p>
                        <div className="space-y-1">
                          {selectedInspection.assetItem.checklist_responses.map((check, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                              <span className="text-sm">{check.name}</span>
                              <Badge variant={check.status === 'pass' ? 'default' : 'destructive'} className="text-xs">
                                {check.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedInspection.assetItem.remarks && (
                      <div>
                        <p className="text-sm text-muted-foreground">Remarks</p>
                        <p className="text-sm mt-1 p-2 bg-muted/30 rounded">{selectedInspection.assetItem.remarks}</p>
                      </div>
                    )}

                    {selectedInspection.assetItem.photo_urls?.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">Photos</p>
                        <div className="grid grid-cols-3 gap-2">
                          {selectedInspection.assetItem.photo_urls.map((url, idx) => (
                            <div key={idx} className="aspect-square rounded-lg overflow-hidden border">
                              <img
                                src={`${process.env.REACT_APP_BACKEND_URL}${url}`}
                                alt={`Inspection ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedInspection.overall_remarks && (
                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground">Overall Remarks</p>
                  <p className="text-sm mt-1 p-2 bg-muted/30 rounded">{selectedInspection.overall_remarks}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Asset History Drawer */}
      <AssetHistoryDrawer
        assetId={assetHistory?.id}
        assetNumber={assetHistory?.number}
        open={!!assetHistory}
        onOpenChange={(open) => !open && setAssetHistory(null)}
      />
    </div>
  );
}
