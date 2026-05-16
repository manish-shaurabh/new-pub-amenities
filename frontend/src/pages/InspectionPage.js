import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetsAPI, stationsAPI, locationsAPI, inspectionsAPI, usersAPI, uploadAPI } from '../lib/api';
import { errString } from '../lib/err';
import { openInspectionReport } from '../lib/inspection-report';
import { useAuth } from '../lib/auth-context';
import { toIstLiteral } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { toast } from 'sonner';
import {
  ClipboardCheck, Camera, Users, CalendarIcon, AlertTriangle,
  ChevronDown, Trash2, MapPin, CheckCircle2, XCircle, Wrench,
  CheckSquare, Square, ChevronRight, ListChecks
} from 'lucide-react';
import { format } from 'date-fns';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import { useLightbox } from '../components/PhotoLightbox';

// ────────────────────────────────────────────────────────────────
// Status helpers
// ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  ok: { label: 'OK', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  not_ok: { label: 'Not OK', icon: XCircle, color: 'text-destructive', bg: 'bg-red-50 border-red-200' },
  needs_repair: { label: 'Needs Repair', icon: Wrench, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
};

const ASSET_STATUS_COLOR = {
  working: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  defective: 'bg-red-100 text-red-800 border-red-200',
  pending_approval: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

// ────────────────────────────────────────────────────────────────
// Inline asset inspection row (expands when selected)
// ────────────────────────────────────────────────────────────────
function AssetInspectionRow({ item, asset, onUpdate, onToggle, onPhotoUpload, onPhotoDelete, onHistory, openLightbox }) {
  const selected = !!item;
  const [checklistOpen, setChecklistOpen] = useState(false);
  const hasChecklist = asset.checklist && asset.checklist.length > 0;

  const handlePhotoInput = async (files) => {
    if (onPhotoUpload) onPhotoUpload(asset._id, Array.from(files));
  };

  const statusCfg = item ? STATUS_CONFIG[item.status] : null;

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${
        selected ? 'border-primary/40 bg-primary/3 shadow-sm' : 'border-border hover:border-primary/20 hover:bg-muted/30'
      }`}
      data-testid={`asset-row-${asset._id}`}
    >
      {/* Row header — always visible */}
      <div className="flex items-center gap-3 p-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(asset)}
          data-testid={`asset-checkbox-${asset._id}`}
          className="flex-shrink-0"
        />

        {/* Photo thumbnail */}
        {asset.identification_photo && (
          <img
            src={asset.identification_photo}
            alt=""
            className="h-8 w-8 rounded object-cover flex-shrink-0 border cursor-zoom-in"
            onClick={() => openLightbox([asset.identification_photo], 0)}
          />
        )}

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onHistory({ id: asset._id, number: asset.asset_number })}
              className="font-medium text-sm hover:text-primary transition-colors"
            >
              {asset.asset_number}
            </button>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">{asset.asset_type_name}</Badge>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${ASSET_STATUS_COLOR[asset.status] || ''}`}>
              {asset.status?.replace('_', ' ')}
            </span>
            {asset.geo_lat && asset.geo_lng && (
              <a href={`https://maps.google.com/?q=${asset.geo_lat},${asset.geo_lng}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                <MapPin className="h-3 w-3 text-primary/50 hover:text-primary" />
              </a>
            )}
          </div>
          {asset.status === 'defective' && asset.defective_since && (
            <p className="text-[10px] text-destructive flex items-center gap-1 mt-0.5">
              <AlertTriangle className="h-3 w-3" />
              Defective since {asset.defective_since}
            </p>
          )}
        </div>

        {/* Inspection result badge when selected */}
        {selected && statusCfg && (
          <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${statusCfg.bg} ${statusCfg.color}`}>
            <statusCfg.icon className="h-3 w-3" />
            {statusCfg.label}
          </span>
        )}
      </div>

      {/* Expanded form when selected */}
      {selected && item && (
        <div className="px-3 pb-3 pt-0 space-y-3 border-t border-primary/10 mt-0" data-testid={`asset-form-${asset._id}`}>
          {/* Status radio */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inspection Result *</Label>
            <RadioGroup
              value={item.status}
              onValueChange={(v) => onUpdate(asset._id, 'status', v)}
              className="flex gap-3 mt-2 flex-wrap"
            >
              {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                <label
                  key={val}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer transition-all text-sm font-medium
                    ${item.status === val ? `${cfg.bg} ${cfg.color} border-current` : 'border-border hover:bg-muted/50'}`}
                  data-testid={`status-${val}-${asset._id}`}
                >
                  <RadioGroupItem value={val} className="sr-only" />
                  <cfg.icon className="h-3.5 w-3.5" />
                  {cfg.label}
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* Defective since */}
          {(item.status === 'not_ok' || item.status === 'needs_repair') && (
            <div className="p-2.5 bg-destructive/5 border border-destructive/20 rounded-lg">
              <Label className="text-xs font-medium text-destructive">Defective Since (Date &amp; Time) *</Label>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs justify-start">
                      <CalendarIcon className="mr-1.5 h-3 w-3" />
                      {item.defective_since_date ? format(new Date(item.defective_since_date), 'dd MMM yyyy') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={item.defective_since_date ? new Date(item.defective_since_date) : undefined}
                      onSelect={(d) => onUpdate(asset._id, 'defective_since_date', d?.toISOString())}
                      disabled={(d) => d > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={item.defective_since_time || ''}
                  onChange={(e) => onUpdate(asset._id, 'defective_since_time', e.target.value)}
                  className="w-[110px] h-8 text-xs"
                  data-testid={`defective-time-${asset._id}`}
                />
              </div>
            </div>
          )}

          {/* Rectified on */}
          {item.status === 'ok' && asset.status === 'defective' && (
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <Label className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Rectified On (optional)</Label>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs justify-start" data-testid={`rectified-date-${asset._id}`}>
                      <CalendarIcon className="mr-1.5 h-3 w-3" />
                      {item.rectified_on_date ? format(new Date(item.rectified_on_date), 'dd MMM yyyy') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={item.rectified_on_date ? new Date(item.rectified_on_date) : undefined}
                      onSelect={(d) => onUpdate(asset._id, 'rectified_on_date', d?.toISOString())}
                      disabled={(d) => d > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={item.rectified_on_time || ''}
                  onChange={(e) => onUpdate(asset._id, 'rectified_on_time', e.target.value)}
                  className="w-[110px] h-8 text-xs"
                />
              </div>
            </div>
          )}

          {/* Checklist */}
          {hasChecklist && (
            <Collapsible open={checklistOpen} onOpenChange={setChecklistOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 pl-0">
                  <ListChecks className="h-3.5 w-3.5" />
                  Checklist ({item.checklist_responses?.filter(c => c.status === 'pass').length}/{item.checklist_responses?.length})
                  <ChevronDown className={`h-3 w-3 transition-transform ${checklistOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-1.5 mt-1">
                  {(item.checklist_responses || []).map((check, cidx) => (
                    <label key={cidx} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer">
                      <Checkbox
                        checked={check.status === 'pass'}
                        onCheckedChange={(checked) => {
                          const updated = [...item.checklist_responses];
                          updated[cidx] = { ...check, status: checked ? 'pass' : 'fail' };
                          onUpdate(asset._id, 'checklist_responses', updated);
                        }}
                      />
                      <span className="text-xs">{check.name}</span>
                    </label>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Remarks */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Remarks (optional)</Label>
            <Textarea
              value={item.remarks || ''}
              onChange={(e) => onUpdate(asset._id, 'remarks', e.target.value)}
              placeholder="Add remarks for this asset…"
              className="mt-1 text-xs min-h-[60px]"
              rows={2}
            />
          </div>

          {/* Photos */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Inspection Photos (optional)</Label>
            <div className="flex gap-2 flex-wrap mt-1">
              {(item.photo_urls || []).map((url, pidx) => (
                <div key={pidx} className="relative h-14 w-14 rounded border group overflow-hidden">
                  <img
                    src={`${process.env.REACT_APP_BACKEND_URL}${url}`}
                    alt=""
                    className="h-full w-full object-cover cursor-zoom-in"
                    onClick={() => openLightbox(item.photo_urls, pidx)}
                    data-testid={`insp-photo-${asset._id}-${pidx}`}
                  />
                  <button
                    onClick={() => onPhotoDelete(asset._id, url)}
                    className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              <label className="h-14 w-14 rounded border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/30 gap-0.5">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">Camera</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoInput(e.target.files)} />
              </label>
              <label className="h-14 w-14 rounded border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/30 gap-0.5">
                <span className="text-lg leading-none text-muted-foreground">+</span>
                <span className="text-[9px] text-muted-foreground">Files</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoInput(e.target.files)} />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Location block — groups assets under a location header
// ────────────────────────────────────────────────────────────────
function LocationBlock({ location, assets, inspectionItems, onToggle, onBulkToggle, onUpdate, onPhotoUpload, onPhotoDelete, onHistory, openLightbox, locationRef, groupByType }) {
  const selectedInLocation = assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
  const allSelected = assets.length > 0 && selectedInLocation === assets.length;

  // Group assets by asset type when groupByType is true
  const assetGroups = useMemo(() => {
    if (!groupByType) return null;
    const groups = {};
    assets.forEach(a => {
      const key = a.asset_type_id || 'other';
      if (!groups[key]) groups[key] = { name: a.asset_type_name || 'Other', assets: [] };
      groups[key].assets.push(a);
    });
    return Object.values(groups);
  }, [assets, groupByType]);

  const renderAssets = (assetList) => (
    <div className="space-y-2">
      {assetList.map(asset => (
        <AssetInspectionRow
          key={asset._id}
          asset={asset}
          item={inspectionItems.find(i => i.asset_id === asset._id) || null}
          onToggle={onToggle}
          onUpdate={onUpdate}
          onPhotoUpload={onPhotoUpload}
          onPhotoDelete={onPhotoDelete}
          onHistory={onHistory}
          openLightbox={openLightbox}
        />
      ))}
    </div>
  );

  return (
    <div ref={locationRef} data-location-id={location._id} className="scroll-mt-24">
      {/* Location header */}
      <div className="sticky top-[120px] sm:top-[112px] z-10 flex items-center justify-between bg-background/95 backdrop-blur border-b py-2 px-1 mb-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-primary/60" />
          <span className="font-semibold text-sm">{location.name}</span>
          <Badge variant="outline" className="text-[10px]">{assets.length} assets</Badge>
          {selectedInLocation > 0 && (
            <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30">
              {selectedInLocation} selected
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => onBulkToggle(assets, !allSelected)}
          data-testid={`bulk-select-loc-${location._id}`}
        >
          {allSelected ? <><CheckSquare className="h-3.5 w-3.5" /> Deselect all</> : <><Square className="h-3.5 w-3.5" /> Select all</>}
        </Button>
      </div>

      {/* Asset rows — grouped by type or flat */}
      {assetGroups ? (
        <div className="space-y-4">
          {assetGroups.map(group => {
            const selInGroup = group.assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
            return (
              <div key={group.name}>
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.name}</span>
                  <span className="text-[10px] text-muted-foreground">{selInGroup}/{group.assets.length}</span>
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/40 transition-all"
                      style={{ width: group.assets.length ? `${(selInGroup / group.assets.length) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
                {renderAssets(group.assets)}
              </div>
            );
          })}
        </div>
      ) : (
        renderAssets(assets)
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────
export default function InspectionPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkAssetId = searchParams.get('asset_id');

  // Core state
  const [inspectionType, setInspectionType] = useState('individual');
  const [stations, setStations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assets, setAssets] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [inspectionItems, setInspectionItems] = useState([]);   // {asset_id, ...form fields}
  const [participants, setParticipants] = useState([]);
  const [overallRemarks, setOverallRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [assetHistory, setAssetHistory] = useState(null);
  const [inspectionDate, setInspectionDate] = useState(new Date());
  const [inspectionTime, setInspectionTime] = useState(format(new Date(), 'HH:mm'));
  const [activeLocId, setActiveLocId] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null); // null = all types
  const { open: openLightbox, lightbox } = useLightbox();

  // Refs for location scroll-spy
  const locationRefs = useRef({});

  useEffect(() => { loadStations(); loadUsers(); }, []);

  // Deep-link support
  useEffect(() => {
    if (!deepLinkAssetId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await assetsAPI.get(deepLinkAssetId);
        const a = res.data;
        if (cancelled) return;
        setSelectedStation(a.station_id);
        const [locRes, assetRes] = await Promise.all([
          locationsAPI.list(a.station_id),
          assetsAPI.list({ station_id: a.station_id }),
        ]);
        setLocations(locRes.data || []);
        let all = assetRes.data || [];
        if (user.role === 'supervisor') all = all.filter(x => x.department_id === user.department_id);
        setAssets(all);
        const target = all.find(x => x._id === a._id) || a;
        addItem(target);
      } catch (e) {
        toast.error('Could not load the requested asset');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [deepLinkAssetId]);

  const loadStations = async () => {
    const res = await stationsAPI.list();
    let list = res.data;
    if (user.role === 'approving_supervisor') list = list.filter(s => s.approving_supervisor_id === user._id);
    else if (user.role === 'supervisor' || user.role === 'reporting_officer') list = list.filter(s => user.assigned_stations?.includes(s._id));
    setStations(list);
  };

  const loadUsers = async () => {
    const res = await usersAPI.list({});
    setUsers(res.data);
  };

  const loadStationData = async (stationId) => {
    const [locRes, assetRes] = await Promise.all([
      locationsAPI.list(stationId),
      assetsAPI.list({ station_id: stationId }),
    ]);
    setLocations(locRes.data || []);
    let all = assetRes.data || [];
    if (user.role === 'supervisor') all = all.filter(a => a.department_id === user.department_id);
    setAssets(all);
  };

  const handleStationChange = (sid) => {
    setSelectedStation(sid);
    setInspectionItems([]);
    setLocations([]);
    setAssets([]);
    setActiveLocId(null);
    loadStationData(sid);
  };

  // ── Item management ──
  const makeItem = (asset) => ({
    asset_id: asset._id,
    asset_number: asset.asset_number,
    asset_status: asset.status,
    defective_since_existing: asset.defective_since,
    status: 'ok',
    checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
    remarks: '',
    remarks_by: user.name,
    photo_urls: [],
    defective_since_date: null,
    defective_since_time: '',
    rectified_on_date: null,
    rectified_on_time: '',
  });

  const addItem = useCallback((asset) => {
    setInspectionItems(prev => {
      if (prev.find(i => i.asset_id === asset._id)) return prev;
      return [...prev, makeItem(asset)];
    });
  }, []); // eslint-disable-line

  const removeItem = (assetId) => setInspectionItems(prev => prev.filter(i => i.asset_id !== assetId));

  const toggleAsset = (asset) => {
    if (inspectionItems.find(i => i.asset_id === asset._id)) removeItem(asset._id);
    else addItem(asset);
  };

  const bulkToggleLocation = (assets, selectAll) => {
    if (selectAll) {
      setInspectionItems(prev => {
        const existing = new Set(prev.map(i => i.asset_id));
        const toAdd = assets.filter(a => !existing.has(a._id)).map(makeItem);
        return [...prev, ...toAdd];
      });
    } else {
      const ids = new Set(assets.map(a => a._id));
      setInspectionItems(prev => prev.filter(i => !ids.has(i.asset_id)));
    }
  };

  const updateItem = (assetId, field, value) => {
    setInspectionItems(prev => prev.map(item => item.asset_id === assetId ? { ...item, [field]: value } : item));
  };

  const handlePhotoUpload = async (assetId, files) => {
    try {
      const uploaded = [];
      for (const file of files) {
        const res = await uploadAPI.single(file);
        uploaded.push(res.data.url);
      }
      setInspectionItems(prev => prev.map(item =>
        item.asset_id === assetId ? { ...item, photo_urls: [...item.photo_urls, ...uploaded] } : item
      ));
      toast.success(`${uploaded.length} photo(s) uploaded`);
    } catch (e) {
      toast.error('Photo upload failed');
    }
  };

  const handlePhotoDelete = (assetId, url) => {
    setInspectionItems(prev => prev.map(item =>
      item.asset_id === assetId ? { ...item, photo_urls: item.photo_urls.filter(u => u !== url) } : item
    ));
  };

  const toggleParticipant = (empId) => setParticipants(prev => prev.includes(empId) ? prev.filter(p => p !== empId) : [...prev, empId]);

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedStation) { toast.error('Please select a station'); return; }
    if (inspectionItems.length === 0) { toast.error('Please select at least one asset'); return; }
    if (inspectionType === 'sig' && participants.length === 0) { toast.error('Please select SIG participants'); return; }
    for (const item of inspectionItems) {
      if ((item.status === 'not_ok' || item.status === 'needs_repair') && !item.defective_since_date) {
        toast.error(`Set defective-since date for ${item.asset_number}`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const inspectionAtLiteral = toIstLiteral(inspectionDate, inspectionTime);
      const payload = {
        inspection_type: inspectionType,
        station_id: selectedStation,
        inspector_id: user._id,
        inspection_at: inspectionAtLiteral,
        items: inspectionItems.map(item => {
          let defective_since = null;
          if ((item.status === 'not_ok' || item.status === 'needs_repair') && item.defective_since_date) {
            defective_since = toIstLiteral(item.defective_since_date, item.defective_since_time);
          }
          let rectified_on = null;
          if (item.status === 'ok' && item.rectified_on_date) {
            rectified_on = toIstLiteral(item.rectified_on_date, item.rectified_on_time);
          }
          return { asset_id: item.asset_id, status: item.status, checklist_responses: item.checklist_responses, remarks: item.remarks, remarks_by: item.remarks_by, photo_urls: item.photo_urls, defective_since, rectified_on };
        }),
        participants: inspectionType === 'sig' ? participants : [],
        overall_remarks: overallRemarks,
      };
      const submitRes = await inspectionsAPI.create(payload);
      const created = submitRes.data;
      const autoRejections = created.auto_rejections || [];
      if (autoRejections.length > 0) {
        toast.warning(`Inspection submitted. ⚠ ${autoRejections.length} asset(s) re-reported defective — prior rectification claim auto-rejected.`, { duration: 7000 });
      } else {
        toast.success('Inspection submitted successfully!');
      }
      // Build lookup for PDF report
      const lookup = {};
      assets.forEach(a => {
        lookup[a._id] = { asset_number: a.asset_number, asset_type_name: a.asset_type_name, location_name: a.location_name, status: a.status, ol_defective_since: a.defective_since, defective_since: a.defective_since };
      });
      (created.items || []).forEach(it => {
        if (!lookup[it.asset_id]) return;
        if (it.status === 'not_ok' || it.status === 'needs_repair') {
          lookup[it.asset_id].status = 'defective';
          if (!lookup[it.asset_id].ol_defective_since && it.defective_since) {
            lookup[it.asset_id].ol_defective_since = it.defective_since;
            lookup[it.asset_id].defective_since = it.defective_since;
          }
        } else if (it.status === 'ok' && lookup[it.asset_id].status === 'defective') {
          lookup[it.asset_id].status = 'pending_approval';
        }
      });
      try {
        openInspectionReport({ inspection: created, asset_lookup: lookup, station_name: stations.find(s => s._id === selectedStation)?.name, app_name: 'Asset Track Rail' });
      } catch (_) {}
      // Reset form
      setInspectionItems([]);
      setParticipants([]);
      setOverallRemarks('');
      setInspectionDate(new Date());
      setInspectionTime(format(new Date(), 'HH:mm'));
      setSearchParams({});
      // Reload assets to get fresh status
      if (selectedStation) loadStationData(selectedStation);
    } catch (e) {
      toast.error(errString(e, 'Failed to submit inspection'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived data ──
  const locationsWithAssets = locations.map(loc => ({
    ...loc,
    assets: assets.filter(a => a.location_id === loc._id),
  })).filter(loc => loc.assets.length > 0);

  // Assets not matching any known location (fallback)
  const orphanAssets = assets.filter(a => !locations.find(l => l._id === a.location_id));

  const totalAssets = assets.length;
  const selectedCount = inspectionItems.length;
  const doneCount = inspectionItems.filter(i => i.status !== undefined).length;

  // Per-location type breakdown for the sidebar filter bars
  const typeBreakdown = useMemo(() => {
    const result = {};
    locationsWithAssets.forEach(loc => {
      const byType = {};
      loc.assets.forEach(asset => {
        const tid = asset.asset_type_id || 'other';
        const tname = asset.asset_type_name || 'Other';
        if (!byType[tid]) byType[tid] = { id: tid, name: tname, total: 0, inspected: 0 };
        byType[tid].total++;
        if (inspectionItems.find(i => i.asset_id === asset._id)) byType[tid].inspected++;
      });
      result[loc._id] = Object.values(byType);
    });
    return result;
  }, [locationsWithAssets, inspectionItems]);

  // Filtered locations based on active type filter
  const filteredLocationsWithAssets = useMemo(() => {
    if (!typeFilter) return locationsWithAssets;
    return locationsWithAssets.map(loc => ({
      ...loc,
      assets: loc.assets.filter(a => a.asset_type_id === typeFilter),
    })).filter(loc => loc.assets.length > 0);
  }, [locationsWithAssets, typeFilter]);

  // Defect count for banner
  const defectCount = useMemo(() =>
    inspectionItems.filter(i => i.status === 'not_ok' || i.status === 'needs_repair').length,
    [inspectionItems]
  );

  const scrollToLocation = (locId) => {
    setActiveLocId(locId);
    const el = locationRefs.current[locId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="inspection-page">

      {/* ── Page title ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New Inspection</h1>
          <p className="text-sm text-muted-foreground">Record asset inspection findings</p>
        </div>
        {deepLinkAssetId && (
          <Button variant="outline" size="sm" onClick={() => { setSearchParams({}); setInspectionItems([]); }}>
            <ClipboardCheck className="h-4 w-4 mr-2" /> Clear deep-link
          </Button>
        )}
      </div>

      {/* ── Top controls card ── */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Inspection type */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Type</Label>
              <Tabs value={inspectionType} onValueChange={(v) => { setInspectionType(v); setInspectionItems([]); }}>
                <TabsList className="h-9">
                  <TabsTrigger value="individual" data-testid="inspection-type-individual" className="text-xs">
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Individual
                  </TabsTrigger>
                  <TabsTrigger value="sig" data-testid="inspection-type-sig" className="text-xs">
                    <Users className="h-3.5 w-3.5 mr-1.5" /> SIG
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Station */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Station *</Label>
              <Select value={selectedStation} onValueChange={handleStationChange}>
                <SelectTrigger data-testid="station-select"><SelectValue placeholder="Select station…" /></SelectTrigger>
                <SelectContent>
                  {stations.map(s => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Date/time */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Inspection Date &amp; Time</Label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="flex-1 justify-start text-xs font-normal h-9">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {inspectionDate ? format(inspectionDate, 'dd MMM yy') : 'Date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={inspectionDate} onSelect={(d) => setInspectionDate(d || new Date())} initialFocus />
                  </PopoverContent>
                </Popover>
                <Input type="time" value={inspectionTime} onChange={(e) => setInspectionTime(e.target.value)} className="w-[100px] h-9 text-xs" />
              </div>
            </div>
          </div>

          {/* SIG participants (expandable) */}
          {inspectionType === 'sig' && (
            <div className="mt-3 pt-3 border-t" data-testid="sig-inspection-form">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">SIG Participants *</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {users.filter(u => u._id !== user._id).map(u => (
                  <label key={u._id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer text-xs">
                    <Checkbox checked={participants.includes(u.employee_id)} onCheckedChange={() => toggleParticipant(u.employee_id)} />
                    <span className="flex-1 min-w-0 truncate">{u.name}</span>
                    <Badge variant="outline" className="text-[9px]">{u.role?.replace('_', ' ')}</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Progress banner ── */}
      {selectedStation && totalAssets > 0 && (
        <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/20" data-testid="inspection-progress">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">
                {selectedCount} of {totalAssets} assets queued
                {defectCount > 0 && <span className="text-destructive ml-2">· {defectCount} defects</span>}
              </span>
              <span className="text-xs text-muted-foreground">{totalAssets - selectedCount} remaining</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: totalAssets > 0 ? `${(selectedCount / totalAssets) * 100}%` : '0%' }}
              />
            </div>
          </div>
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => setInspectionItems([])}>
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* ── No assets message ── */}
      {selectedStation && totalAssets === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No assets found for this station</p>
          </CardContent>
        </Card>
      )}

      {/* ── Main dual-pane area ── */}
      {selectedStation && totalAssets > 0 && (
        <div className="flex gap-4 items-start">

          {/* Left nav sidebar */}
          <div className="hidden lg:block w-56 flex-shrink-0 sticky top-20">
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Locations</p>
                {typeFilter && (
                  <button
                    onClick={() => setTypeFilter(null)}
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                    data-testid="clear-type-filter"
                  >
                    All ↺
                  </button>
                )}
              </div>
              <nav className="p-1.5 space-y-0.5 max-h-[calc(100vh-200px)] overflow-y-auto" data-testid="location-nav">
                {locationsWithAssets.map(loc => {
                  const selInLoc = loc.assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
                  const isActive = activeLocId === loc._id;
                  const types = typeBreakdown[loc._id] || [];
                  return (
                    <div key={loc._id}>
                      {/* Location row */}
                      <button
                        onClick={() => scrollToLocation(loc._id)}
                        data-testid={`nav-loc-${loc._id}`}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-all flex items-center justify-between gap-1
                          ${isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'}`}
                      >
                        <span className="truncate flex-1">{loc.name}</span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          {selInLoc > 0 && <span className="text-[9px] font-semibold text-primary">{selInLoc}/</span>}
                          <span className="text-[9px]">{loc.assets.length}</span>
                          <ChevronRight className="h-3 w-3 opacity-40" />
                        </span>
                      </button>
                      {/* Type breakdown bars */}
                      {types.length > 0 && (
                        <div className="ml-2 mb-1 space-y-0.5">
                          {types.map(t => {
                            const pct = t.total > 0 ? (t.inspected / t.total) * 100 : 0;
                            const isFiltered = typeFilter === t.id;
                            return (
                              <button
                                key={t.id}
                                onClick={() => setTypeFilter(isFiltered ? null : t.id)}
                                data-testid={`type-filter-${t.id}`}
                                className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] transition-all flex items-center gap-1.5
                                  ${isFiltered ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50 text-muted-foreground'}`}
                              >
                                <span className="truncate flex-1 min-w-0">{t.name}</span>
                                <span className="shrink-0 tabular-nums">{t.inspected}/{t.total}</span>
                                <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-primary' : 'bg-muted-foreground/20'
                                    }`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Right main area */}
          <div className="flex-1 min-w-0 space-y-6 pb-24" data-testid="inspection-main-area">

            {/* Active type filter banner */}
            {typeFilter && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-sm">
                <span className="text-xs font-medium text-primary">
                  Filtered by: {assets.find(a => a.asset_type_id === typeFilter)?.asset_type_name || typeFilter}
                </span>
                <button onClick={() => setTypeFilter(null)} className="ml-auto text-xs text-primary hover:underline" data-testid="clear-type-filter-banner">
                  Show All ↺
                </button>
              </div>
            )}

            {/* Mobile location quick-nav */}
            <div className="lg:hidden flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {locationsWithAssets.map(loc => {
                const selInLoc = loc.assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
                return (
                  <button
                    key={loc._id}
                    onClick={() => scrollToLocation(loc._id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full border text-xs transition-all
                      ${activeLocId === loc._id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted/50'}`}
                  >
                    {loc.name} <span className="opacity-60">({selInLoc > 0 ? `${selInLoc}/` : ''}{loc.assets.length})</span>
                  </button>
                );
              })}
            </div>

            {/* Location blocks */}
            {filteredLocationsWithAssets.map(loc => (
              <LocationBlock
                key={loc._id}
                location={loc}
                assets={loc.assets}
                inspectionItems={inspectionItems}
                onToggle={toggleAsset}
                onBulkToggle={bulkToggleLocation}
                onUpdate={updateItem}
                onPhotoUpload={handlePhotoUpload}
                onPhotoDelete={handlePhotoDelete}
                onHistory={setAssetHistory}
                openLightbox={openLightbox}
                locationRef={(el) => { if (el) locationRefs.current[loc._id] = el; }}
                groupByType={!typeFilter}
              />
            ))}

            {/* Orphan assets (no matching location) */}
            {orphanAssets.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-muted-foreground">Other Assets</span>
                  <Badge variant="outline" className="text-[10px]">{orphanAssets.length}</Badge>
                </div>
                <div className="space-y-2">
                  {orphanAssets.map(asset => (
                    <AssetInspectionRow
                      key={asset._id}
                      asset={asset}
                      item={inspectionItems.find(i => i.asset_id === asset._id) || null}
                      onToggle={toggleAsset}
                      onUpdate={updateItem}
                      onPhotoUpload={handlePhotoUpload}
                      onPhotoDelete={handlePhotoDelete}
                      onHistory={setAssetHistory}
                      openLightbox={openLightbox}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Overall remarks */}
            {selectedCount > 0 && (
              <div>
                <Label className="text-sm font-medium">Overall Remarks</Label>
                <Textarea
                  value={overallRemarks}
                  onChange={(e) => setOverallRemarks(e.target.value)}
                  placeholder="Overall inspection notes…"
                  className="mt-1"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sticky bottom submit bar ── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
          <div className="max-w-5xl mx-auto px-4 pb-4 pointer-events-auto" style={{ paddingLeft: 'calc(env(safe-area-inset-left) + 1rem)', paddingRight: 'calc(env(safe-area-inset-right) + 1rem)' }}>
            <div className="rounded-xl border shadow-2xl bg-background/90 backdrop-blur p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{selectedCount} asset{selectedCount !== 1 ? 's' : ''} queued</p>
                <p className="text-xs text-muted-foreground">
                  {inspectionItems.filter(i => i.status === 'ok').length} OK &middot;&nbsp;
                  {inspectionItems.filter(i => i.status === 'not_ok').length} Not OK &middot;&nbsp;
                  {inspectionItems.filter(i => i.status === 'needs_repair').length} Needs Repair
                </p>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                size="lg"
                className="shrink-0"
                data-testid="inspection-submit-button"
              >
                {submitting ? 'Submitting…' : `Submit Inspection`}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AssetHistoryDrawer
        assetId={assetHistory?.id}
        assetNumber={assetHistory?.number}
        open={!!assetHistory}
        onOpenChange={(open) => !open && setAssetHistory(null)}
      />
      {lightbox}
    </div>
  );
}
