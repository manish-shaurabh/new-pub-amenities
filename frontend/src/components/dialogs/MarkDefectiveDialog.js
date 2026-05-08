/**
 * Modal: "Mark Asset as Defective"
 *
 * Lets an Admin / Super Admin mark an asset defective without going through
 * the full inspection flow. The user provides:
 *   - status (Not OK / Needs Repair)
 *   - failure date & time (the orange/red clock anchors here)
 *   - remarks (≥ 10 chars)
 *   - optional photos (uploaded via existing /api/upload endpoint)
 *
 * On submit, calls assetsAPI.markDefective which:
 *   - creates a synthetic inspection (so it shows in Inspection History)
 *   - puts the asset on the Orange List (auto-classified red after 24 h)
 *   - notifies the full reporting chain (Supervisor + ASUP + RO + RO Commercial + Admins + SAs)
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { AlertTriangle, Image as ImageIcon, X, CalendarClock, Users } from 'lucide-react';
import { toast } from 'sonner';
import { toIstLiteral } from '../../lib/utils';
import { useAuth } from '../../lib/auth-context';
import { assetsAPI, uploadAPI, usersAPI, stationsAPI } from '../../lib/api';
import { errString } from '../../lib/err';
import { useLightbox } from '../PhotoLightbox';

// Build a value for <input type="datetime-local"> from a Date — local time, no seconds.
function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MarkDefectiveDialog({ open, onOpenChange, asset, onMarked }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('not_ok');
  const [defectiveAt, setDefectiveAt] = useState(toLocalInputValue(new Date()));
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState([]);  // [{ url, name }]
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { open: openLightbox, lightbox } = useLightbox();

  // Recipient preview
  const [recipients, setRecipients] = useState({ loading: true, items: [] });

  // Reset form whenever the dialog opens for a new asset
  useEffect(() => {
    if (open) {
      setStatus('not_ok');
      setDefectiveAt(toLocalInputValue(new Date()));
      setRemarks('');
      setPhotos([]);
    }
  }, [open, asset?._id]);

  // Build the recipients preview list
  useEffect(() => {
    if (!open || !asset?._id) return;
    let cancel = false;
    (async () => {
      setRecipients({ loading: true, items: [] });
      try {
        // Lightweight client-side compute: pull users + station to derive the cascade
        const [usersRes, stationsRes] = await Promise.all([
          usersAPI.list({}),
          stationsAPI.list(),
        ]);
        if (cancel) return;
        const allUsers = usersRes.data || [];
        const stations = stationsRes.data || [];
        const station = stations.find((s) => s._id === asset.station_id);
        const items = [];
        // 1. Supervisor on the asset
        if (asset.assigned_supervisor_id) {
          const sup = allUsers.find((u) => u._id === asset.assigned_supervisor_id);
          if (sup) items.push({ tag: 'Supervisor', name: sup.name, sub: sup.employee_id });
        }
        // 2. ASUP at the asset's station
        if (station?.approving_supervisor_id) {
          const asup = allUsers.find((u) => u._id === station.approving_supervisor_id);
          if (asup) items.push({ tag: 'Approving Sup.', name: asup.name, sub: station.name });
        }
        // 3. RO of the asset's department + station
        const dept = asset.department_id || asset.asset_type_department_id;
        const ros = allUsers.filter(
          (u) =>
            u.role === 'reporting_officer' &&
            (!dept || u.department_id === dept) &&
            (asset.station_id ? (u.assigned_stations || []).includes(asset.station_id) : true),
        );
        ros.forEach((ro) => items.push({ tag: 'RO – Dept', name: ro.name, sub: 'Department' }));
        // 4. RO Commercial (umbrella)
        const commercialROs = allUsers.filter(
          (u) =>
            u.role === 'reporting_officer' &&
            !ros.some((r) => r._id === u._id),
        );
        // We don't know the dept name client-side reliably without an extra fetch — keep a generic label
        commercialROs.slice(0, 2).forEach((ro) =>
          items.push({ tag: 'RO – Other', name: ro.name, sub: 'Umbrella' }),
        );
        // 5 + 6. Admins / Super Admins (count only)
        const adminCount = allUsers.filter((u) => u.role === 'admin').length;
        const saCount = allUsers.filter((u) => u.role === 'superadmin').length;
        if (adminCount > 0) items.push({ tag: 'Admins', name: `All ${adminCount} admin(s)`, sub: '' });
        if (saCount > 0) items.push({ tag: 'Super Admins', name: `All ${saCount} super admin(s)`, sub: '' });

        if (!cancel) setRecipients({ loading: false, items });
      } catch (e) {
        console.warn('preview recipients failed', e);
        if (!cancel) setRecipients({ loading: false, items: [] });
      }
    })();
    return () => { cancel = true; };
  }, [open, asset?._id, asset?.station_id, asset?.assigned_supervisor_id]);

  const remainsValid = useMemo(() => {
    const trimmed = (remarks || '').trim();
    return trimmed.length >= 10;
  }, [remarks]);

  const dtValid = useMemo(() => {
    if (!defectiveAt) return false;
    const t = new Date(defectiveAt);
    if (isNaN(t.getTime())) return false;
    if (t.getTime() > Date.now() + 60 * 1000) return false;  // not in future
    return true;
  }, [defectiveAt]);

  const canSubmit = remainsValid && dtValid && !submitting;

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const f of files) {
        const res = await uploadAPI.single(f);
        if (res.data?.url) setPhotos((prev) => [...prev, { url: res.data.url, name: f.name }]);
      }
      toast.success(`${files.length} photo(s) uploaded`);
    } catch (err) {
      toast.error(errString(err, 'Photo upload failed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const removePhoto = (idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!canSubmit || !asset) return;
    setSubmitting(true);
    try {
      // Treat the user-typed datetime-local string as a naive IST literal.
      // datetime-local inputs already give "YYYY-MM-DDTHH:mm" — append seconds
      // and pass through. Never use new Date(...).toISOString() — that shifts
      // by 5h30m for IST users.
      const isoDefectiveAt = defectiveAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(defectiveAt)
        ? (defectiveAt.length === 16 ? `${defectiveAt}:00` : defectiveAt)
        : toIstLiteral(defectiveAt);
      const r = await assetsAPI.markDefective(asset._id, {
        status,
        remarks: remarks.trim(),
        defective_at: isoDefectiveAt,
        performed_by: user?._id,
        photo_urls: photos.map((p) => p.url),
      });
      toast.success(
        `Asset marked ${status === 'not_ok' ? 'NOT OK' : 'NEEDS REPAIR'} — ${r.data?.notified_count ?? 0} people notified`,
      );
      onMarked && onMarked(r.data);
      onOpenChange(false);
    } catch (e) {
      toast.error(errString(e, 'Failed to mark asset defective'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="mark-defective-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" /> Mark Asset as Defective
          </DialogTitle>
          <DialogDescription>
            This puts the asset on the Orange / Red list and notifies the full reporting chain.
          </DialogDescription>
        </DialogHeader>

        {/* Asset summary */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{asset.asset_number}{asset.asset_type_name ? ` — ${asset.asset_type_name}` : ''}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {asset.station_name || '—'} / {asset.location_name || '—'}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge
              className={
                asset.status === 'working'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]'
                  : 'bg-orange-50 text-orange-700 border-orange-200 text-[10px]'
              }
            >
              {asset.status === 'working' ? 'CURRENTLY WORKING' : (asset.status || 'unknown').toUpperCase()}
            </Badge>
            {asset.assigned_supervisor_name && (
              <span className="text-xs text-muted-foreground">Sup: {asset.assigned_supervisor_name}</span>
            )}
          </div>
        </div>

        {/* Status radio */}
        <div className="space-y-1.5">
          <Label className="text-sm">Status *</Label>
          <RadioGroup value={status} onValueChange={setStatus} className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="not_ok" data-testid="mark-status-not-ok" />
              <span className="text-sm">Not OK</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="needs_repair" data-testid="mark-status-needs-repair" />
              <span className="text-sm">Needs Repair</span>
            </label>
          </RadioGroup>
        </div>

        {/* Date / time */}
        <div className="space-y-1.5">
          <Label className="text-sm flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Date & time of failure *
          </Label>
          <Input
            type="datetime-local"
            value={defectiveAt}
            max={toLocalInputValue(new Date())}
            onChange={(e) => setDefectiveAt(e.target.value)}
            data-testid="mark-defective-at"
          />
          <p className="text-[11px] text-muted-foreground">
            The orange / red list clock starts from this timestamp. Cannot be in the future.
          </p>
        </div>

        {/* Remarks */}
        <div className="space-y-1.5">
          <Label className="text-sm">Reason / remarks * <span className="text-muted-foreground font-normal">(min 10 characters)</span></Label>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Found broken blade during night patrol"
            rows={3}
            data-testid="mark-remarks-input"
          />
          <p className={`text-[11px] ${remainsValid ? 'text-muted-foreground' : 'text-destructive'}`}>
            {(remarks || '').trim().length} / 10
          </p>
        </div>

        {/* Photos */}
        <div className="space-y-1.5">
          <Label className="text-sm flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" /> Photos (optional)
          </Label>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 cursor-pointer text-xs text-primary font-medium" title="Take photo with camera">
              <ImageIcon className="h-3.5 w-3.5" /> Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                disabled={uploading}
                className="hidden"
                data-testid="mark-photo-camera"
              />
            </label>
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer text-xs font-medium" title="Choose from files">
              <span className="text-base leading-none">+</span> Files
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoUpload}
                disabled={uploading}
                className="hidden"
                data-testid="mark-photo-input"
              />
            </label>
          </div>
          {photos.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              {photos.map((p, i) => (
                <div key={i} className="relative group aspect-square rounded-md overflow-hidden border">
                  <img
                    src={`${process.env.REACT_APP_BACKEND_URL}${p.url}`}
                    alt={p.name}
                    className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => openLightbox(photos.map((x) => x.url), i)}
                    data-testid={`mark-photo-thumb-${i}`}
                  />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    onClick={() => removePhoto(i)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recipients preview */}
        <div className="rounded-lg border p-3 bg-muted/20">
          <p className="text-xs font-medium flex items-center gap-1.5 mb-2">
            <Users className="h-3.5 w-3.5" /> Notifications will be sent to:
          </p>
          {recipients.loading ? (
            <p className="text-[11px] text-muted-foreground">Resolving recipients...</p>
          ) : recipients.items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Will notify Admins and Super Admins.</p>
          ) : (
            <ul className="space-y-1">
              {recipients.items.map((r, i) => (
                <li key={i} className="text-[11px] flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{r.tag}</Badge>
                  <span className="truncate">{r.name}{r.sub ? ` · ${r.sub}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-orange-600 hover:bg-orange-700 text-white"
            data-testid="mark-defective-submit-button"
          >
            {submitting ? 'Marking...' : `Mark as ${status === 'not_ok' ? 'Not OK' : 'Needs Repair'}`}
          </Button>
        </div>
      </DialogContent>
      {lightbox}
    </Dialog>
  );
}
