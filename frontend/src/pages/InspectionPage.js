import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetsAPI, stationsAPI, locationsAPI, inspectionsAPI, usersAPI, uploadAPI, stationCanvasAPI } from '../lib/api';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { toast } from 'sonner';
import {
  ClipboardCheck, Camera, Users, CalendarIcon, AlertTriangle,
  ChevronDown, Trash2, MapPin, CheckCircle2, XCircle, Wrench,
  CheckSquare, Square, ChevronRight, ListChecks, Map as MapIcon, List
} from 'lucide-react';
import { format } from 'date-fns';
import AssetHistoryDrawer from '../components/AssetHistoryDrawer';
import { useLightbox } from '../components/PhotoLightbox';
import PlatformBlueprint from '../components/PlatformBlueprint';

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
  const isGrouped = (asset.tracking_mode || 'individual') === 'grouped';

  const handlePhotoInput = async (files) => {
    if (onPhotoUpload) onPhotoUpload(asset._id, Array.from(files));
  };

  // For grouped: derive a "live" status from counts for the badge.
  const liveGroupedStatus = (() => {
    if (!isGrouped || !item) return null;
    const nr = Number(item.needs_repair_count) || 0;
    const nw = Number(item.not_working_count) || 0;
    return (nr + nw) === 0 ? 'ok' : 'not_ok';
  })();
  const statusCfg = item ? STATUS_CONFIG[isGrouped ? liveGroupedStatus : item.status] : null;

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
            {isGrouped && (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] py-0 px-1.5" data-testid={`grouped-badge-${asset._id}`}>
                Group · {asset.total_count || 0}
              </Badge>
            )}
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
          {/* GROUPED ASSET — count-based inspection (replaces status radio) */}
          {isGrouped ? (() => {
            const nr = Number(item.needs_repair_count) || 0;
            const nw = Number(item.not_working_count) || 0;
            const total = Number(item.total_count) || 0;
            const defective = nr + nw;
            const working = Math.max(0, total - defective);
            const pctDef = total > 0 ? (defective / total) * 100 : 0;
            // Color thresholds from spec: 100% = green, any defect = yellow,
            // >30% = orange, >60% = red
            let bandColor = '#059669', bandLabel = 'All Working';
            if (pctDef > 60) { bandColor = '#dc2626'; bandLabel = 'Critical'; }
            else if (pctDef > 30) { bandColor = '#f97316'; bandLabel = 'High'; }
            else if (defective > 0) { bandColor = '#eab308'; bandLabel = 'Some defective'; }
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Group Counts · Total <strong className="text-foreground">{total}</strong>
                  </Label>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: bandColor + '22', color: bandColor }}
                    data-testid={`group-status-${asset._id}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: bandColor }} />
                    {bandLabel} · {pctDef.toFixed(1)}% defective
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                    <Label className="text-[10px] text-amber-700 uppercase tracking-wide">Needs Repair</Label>
                    <Input
                      type="number" min="0" max={total || undefined}
                      value={item.needs_repair_count}
                      onChange={(e) => onUpdate(asset._id, 'needs_repair_count', Math.max(0, Math.min(Number(e.target.value) || 0, total - nw)))}
                      className="h-9 mt-1 text-base font-semibold text-amber-700"
                      data-testid={`group-needs-repair-${asset._id}`}
                    />
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 p-2">
                    <Label className="text-[10px] text-red-700 uppercase tracking-wide">Not Working</Label>
                    <Input
                      type="number" min="0" max={total || undefined}
                      value={item.not_working_count}
                      onChange={(e) => onUpdate(asset._id, 'not_working_count', Math.max(0, Math.min(Number(e.target.value) || 0, total - nr)))}
                      className="h-9 mt-1 text-base font-semibold text-red-700"
                      data-testid={`group-not-working-${asset._id}`}
                    />
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 opacity-90">
                    <Label className="text-[10px] text-emerald-700 uppercase tracking-wide">Working (auto)</Label>
                    <Input
                      type="number"
                      value={working}
                      readOnly
                      className="h-9 mt-1 text-base font-semibold text-emerald-700 bg-emerald-50"
                      data-testid={`group-working-${asset._id}`}
                    />
                  </div>
                </div>
                {/* Visual stack bar */}
                {total > 0 && (
                  <div className="rounded-full overflow-hidden h-2 flex" data-testid={`group-stack-${asset._id}`}>
                    <div style={{ width: `${(working / total) * 100}%`, background: '#059669' }} />
                    <div style={{ width: `${(nr / total) * 100}%`, background: '#f59e0b' }} />
                    <div style={{ width: `${(nw / total) * 100}%`, background: '#dc2626' }} />
                  </div>
                )}
              </div>
            );
          })() : (
          <>
          {/* Status radio (individual mode only) */}
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
          </>)}

          {/* Defective since — only for individual mode + defective statuses */}
          {!isGrouped && (item.status === 'not_ok' || item.status === 'needs_repair') && (
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
          {!isGrouped && item.status === 'ok' && asset.status === 'defective' && (
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

  // Group assets by sub-zone first (only if at least one asset has a sub-zone
  // AND there is genuine variety — otherwise it's just visual noise).
  const subZoneBuckets = useMemo(() => {
    const hasAny = assets.some(a => a.sub_zone_id);
    if (!hasAny) return null;
    const buckets = new Map();
    assets.forEach(a => {
      const key = a.sub_zone_id || '__unassigned__';
      const name = a.sub_zone_id ? (a.sub_zone_name || 'Sub-Zone') : 'Unassigned';
      if (!buckets.has(key)) buckets.set(key, { id: key, name, assets: [] });
      buckets.get(key).assets.push(a);
    });
    // If only ONE bucket exists (everything in the same sub-zone OR everything
    // unassigned), there's no value in showing a bucket header — fall back to
    // the flat type-grouped layout.
    if (buckets.size <= 1) return null;
    return Array.from(buckets.values()).sort((a, b) => {
      if (a.id === '__unassigned__') return 1;
      if (b.id === '__unassigned__') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [assets]);

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

  // Helper: render a flat list of asset rows
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

  // Helper: render assets grouped by type (when groupByType is on)
  const renderGroupedByType = (assetList) => {
    const groups = {};
    assetList.forEach(a => {
      const key = a.asset_type_id || 'other';
      if (!groups[key]) groups[key] = { name: a.asset_type_name || 'Other', assets: [] };
      groups[key].assets.push(a);
    });
    return (
      <div className="space-y-3">
        {Object.values(groups).map(g => {
          const sel = g.assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
          return (
            <div key={g.name}>
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">{sel}/{g.assets.length}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary/40 transition-all"
                       style={{ width: g.assets.length ? `${(sel / g.assets.length) * 100}%` : '0%' }} />
                </div>
              </div>
              {renderAssets(g.assets)}
            </div>
          );
        })}
      </div>
    );
  };

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

      {/* Asset rows — Sub-Zone → (optional Type) → Asset hierarchy */}
      {subZoneBuckets ? (
        <div className="space-y-3">
          {subZoneBuckets.map(bucket => {
            const sel = bucket.assets.filter(a => inspectionItems.find(i => i.asset_id === a._id)).length;
            const all = bucket.assets.length;
            const allSel = all > 0 && sel === all;
            const isUnassigned = bucket.id === '__unassigned__';
            return (
              <div key={bucket.id} className="rounded-lg border border-slate-200 bg-slate-50/40 overflow-hidden" data-testid={`subzone-bucket-${bucket.id}`}>
                <div className={`flex items-center gap-2 px-3 py-2 border-b ${isUnassigned ? 'bg-slate-100/80 border-slate-200' : 'bg-teal-50/80 border-teal-100'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isUnassigned ? 'bg-slate-400' : 'bg-teal-500'}`} />
                  <span className={`text-[12px] font-semibold tracking-wide ${isUnassigned ? 'text-slate-600' : 'text-teal-800'}`}>
                    {bucket.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{sel}/{all}</span>
                  <button
                    className="ml-auto text-[11px] text-teal-700 hover:underline disabled:opacity-40"
                    onClick={() => onBulkToggle(bucket.assets, !allSel)}
                    data-testid={`subzone-bucket-select-${bucket.id}`}
                  >
                    {allSel ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="p-2.5">
                  {groupByType ? renderGroupedByType(bucket.assets) : renderAssets(bucket.assets)}
                </div>
              </div>
            );
          })}
        </div>
      ) : assetGroups ? (
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
  const [subZoneFilter, setSubZoneFilter] = useState(null); // null = all sub-zones (including unassigned)
  const [viewMode, setViewMode] = useState('list');   // 'list' | 'map'
  const [canvasData, setCanvasData] = useState(null); // location canvas data for map view
  const [blueprintAsset, setBlueprintAsset] = useState(null); // asset tapped in map view
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

  // Load canvas blueprint data for the current location (map view)
  const loadCanvasData = useCallback(async (locationId) => {
    if (!locationId) return;
    try {
      const res = await stationCanvasAPI.get({ location_id: locationId });
      const locs = res.data?.locations || [];
      setCanvasData(locs.find(l => l.id === locationId) || locs[0] || null);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (viewMode === 'map' && activeLocId) {
      loadCanvasData(activeLocId);
    }
  }, [viewMode, activeLocId, loadCanvasData]);

  const handleStationChange = (sid) => {
    setSelectedStation(sid);
    setInspectionItems([]);
    setLocations([]);
    setAssets([]);
    setActiveLocId(null);
    loadStationData(sid);
  };

  // ── Item management ──
  const makeItem = (asset) => {
    const isGrouped = (asset.tracking_mode || 'individual') === 'grouped';
    return {
      asset_id: asset._id,
      asset_number: asset.asset_number,
      asset_status: asset.status,
      defective_since_existing: asset.defective_since,
      tracking_mode: asset.tracking_mode || 'individual',
      total_count: asset.total_count || 0,
      // Pre-fill counts from current asset snapshot so editing feels natural
      needs_repair_count: isGrouped ? (asset.needs_repair_count || 0) : 0,
      not_working_count: isGrouped ? (asset.not_working_count || 0) : 0,
      status: 'ok',
      checklist_responses: (asset.checklist || []).map(c => ({ name: c.name, value: '', status: 'pass' })),
      remarks: '',
      remarks_by: user.name,
      photo_urls: [],
      defective_since_date: null,
      defective_since_time: '',
      rectified_on_date: null,
      rectified_on_time: '',
    };
  };

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
      if (item.tracking_mode === 'grouped') {
        const nr = Number(item.needs_repair_count) || 0;
        const nw = Number(item.not_working_count) || 0;
        if (nr < 0 || nw < 0) {
          toast.error(`Counts cannot be negative for ${item.asset_number}`); return;
        }
        if (item.total_count && (nr + nw) > item.total_count) {
          toast.error(`${item.asset_number}: defective (${nr + nw}) exceeds total (${item.total_count})`);
          return;
        }
      } else if ((item.status === 'not_ok' || item.status === 'needs_repair') && !item.defective_since_date) {
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
          // Grouped item — backend derives status from counts; we just send the counts.
          if (item.tracking_mode === 'grouped') {
            const nr = Number(item.needs_repair_count) || 0;
            const nw = Number(item.not_working_count) || 0;
            const defective = nr + nw;
            // If defective>0 and no defective_since chosen, default to inspection_at.
            let defective_since = null;
            if (defective > 0) {
              defective_since = item.defective_since_date
                ? toIstLiteral(item.defective_since_date, item.defective_since_time)
                : inspectionAtLiteral;
            }
            return {
              asset_id: item.asset_id,
              status: defective === 0 ? 'ok' : 'not_ok',
              checklist_responses: item.checklist_responses,
              remarks: item.remarks,
              remarks_by: item.remarks_by,
              photo_urls: item.photo_urls,
              defective_since,
              rectified_on: null,
              group_counts: { needs_repair: nr, not_working: nw },
            };
          }
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

  // Sub-zones present across the current station's assets, used by the chip dropdown
  const stationSubZones = useMemo(() => {
    const map = new Map();
    assets.forEach(a => {
      if (a.sub_zone_id && a.sub_zone_name) map.set(a.sub_zone_id, a.sub_zone_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assets]);

  // Filtered locations based on active type + sub-zone filters
  const filteredLocationsWithAssets = useMemo(() => {
    let out = locationsWithAssets;
    if (typeFilter) {
      out = out.map(loc => ({ ...loc, assets: loc.assets.filter(a => a.asset_type_id === typeFilter) }));
    }
    if (subZoneFilter !== null) {
      // subZoneFilter === 'unassigned' filters to assets with no sub_zone_id
      out = out.map(loc => ({
        ...loc,
        assets: loc.assets.filter(a =>
          subZoneFilter === 'unassigned' ? !a.sub_zone_id : a.sub_zone_id === subZoneFilter
        ),
      }));
    }
    return out.filter(loc => loc.assets.length > 0);
  }, [locationsWithAssets, typeFilter, subZoneFilter]);

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

            {/* View mode toggle — List vs Map */}
            {activeLocId && (
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-muted-foreground">View:</span>
                <div className="flex rounded-lg border overflow-hidden">
                  <button
                    onClick={() => setViewMode('list')}
                    data-testid="view-mode-list"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                  >
                    <List size={12} /> List
                  </button>
                  <button
                    onClick={() => { setViewMode('map'); loadCanvasData(activeLocId); }}
                    data-testid="view-mode-map"
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-l transition-colors ${viewMode === 'map' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                  >
                    <MapIcon size={12} /> Map
                  </button>
                </div>
              </div>
            )}

            {/* Map / Blueprint view */}
            {viewMode === 'map' && activeLocId && (
              <div>
                {canvasData ? (
                  <PlatformBlueprint
                    locationData={canvasData}
                    mode="inspection"
                    inspectionItems={inspectionItems}
                    onAssetClick={(asset) => {
                      // Add to inspection list if not already there
                      const rawAsset = assets.find(a => a._id === asset.id);
                      if (!rawAsset) return;
                      if (!inspectionItems.find(i => i.asset_id === asset.id)) {
                        addItem(rawAsset);
                      }
                      setBlueprintAsset(rawAsset || asset);
                    }}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    <MapIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    Loading blueprint…
                  </div>
                )}
              </div>
            )}

            {/* Active filter banners (type + sub-zone) — only in list mode */}
            {viewMode === 'list' && typeFilter && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-sm">
                <span className="text-xs font-medium text-primary">
                  Filtered by: {assets.find(a => a.asset_type_id === typeFilter)?.asset_type_name || typeFilter}
                </span>
                <button onClick={() => setTypeFilter(null)} className="ml-auto text-xs text-primary hover:underline" data-testid="clear-type-filter-banner">
                  Show All ↺
                </button>
              </div>
            )}

            {/* Sub-Zone filter chips — visible when station has sub-zone-tagged assets (list mode only) */}
            {viewMode === 'list' && stationSubZones.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap" data-testid="subzone-filter-row">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Sub-zone</span>
                <button
                  onClick={() => setSubZoneFilter(null)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] border transition-all ${subZoneFilter === null ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-card hover:bg-teal-50 border-border'}`}
                  data-testid="subzone-filter-all"
                >All</button>
                {stationSubZones.map(sz => (
                  <button
                    key={sz.id}
                    onClick={() => setSubZoneFilter(subZoneFilter === sz.id ? null : sz.id)}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] border transition-all ${subZoneFilter === sz.id ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-card hover:bg-teal-50 border-border'}`}
                    data-testid={`subzone-filter-${sz.id}`}
                  >{sz.name}</button>
                ))}
                {assets.some(a => !a.sub_zone_id) && (
                  <button
                    onClick={() => setSubZoneFilter(subZoneFilter === 'unassigned' ? null : 'unassigned')}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] border transition-all ${subZoneFilter === 'unassigned' ? 'bg-slate-700 text-white border-slate-700 shadow-sm' : 'bg-card hover:bg-slate-100 border-border text-muted-foreground'}`}
                    data-testid="subzone-filter-unassigned"
                  >Unassigned</button>
                )}
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

      {/* Blueprint tap-to-inspect sheet (mobile-friendly bottom sheet) */}
      <Sheet open={!!blueprintAsset} onOpenChange={(o) => !o && setBlueprintAsset(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader className="text-left pb-2">
            <SheetTitle className="text-base">{blueprintAsset?.asset_number}</SheetTitle>
            <p className="text-xs text-muted-foreground">{blueprintAsset?.asset_type_name} · {blueprintAsset?.location_name}</p>
          </SheetHeader>
          {blueprintAsset && (() => {
            const item = inspectionItems.find(i => i.asset_id === blueprintAsset._id);
            if (!item) return (
              <div className="py-4 text-center">
                <Button onClick={() => { addItem(blueprintAsset); }} className="w-full">
                  Add to Inspection
                </Button>
              </div>
            );
            return (
              <div className="space-y-3 pt-2">
                <RadioGroup
                  value={item.status || ''}
                  onValueChange={(v) => updateItem(item.asset_id, { status: v })}
                >
                  {[
                    { value: 'ok', label: 'Working OK', color: 'text-emerald-600' },
                    { value: 'not_ok', label: 'Defective / Not OK', color: 'text-red-600' },
                    { value: 'needs_repair', label: 'Needs Repair', color: 'text-orange-600' },
                  ].map(opt => (
                    <div key={opt.value} className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50 cursor-pointer">
                      <RadioGroupItem value={opt.value} id={`bp-${opt.value}`} />
                      <Label htmlFor={`bp-${opt.value}`} className={`cursor-pointer font-medium ${opt.color}`}>{opt.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
                <Textarea
                  value={item.remarks || ''}
                  onChange={(e) => updateItem(item.asset_id, { remarks: e.target.value })}
                  placeholder="Remarks (optional)…"
                  rows={2}
                  className="text-sm"
                />
                <Button className="w-full" onClick={() => setBlueprintAsset(null)}>Done</Button>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
