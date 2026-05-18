/**
 * SubZoneHealthCard — collapsible per-sub-zone "shed health" questionnaire.
 *
 * Captures 4 fixed questions per sub-zone during an inspection:
 *   1. shed_roof_condition  — Is the shed roof in good condition?
 *   2. cleanliness          — Is the area clean?
 *   3. lighting             — Is the lighting adequate?
 *   4. water_seepage        — Is the area free of water seepage?
 *
 * Each answer is OK / Not OK. Photo + remarks are *mandatory* when any answer
 * is "not_ok"; the parent surfaces this requirement via the `incomplete` prop.
 */
import { useState, useRef } from 'react';
import { ChevronDown, AlertTriangle, CheckCircle2, Camera, X, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { uploadAPI } from '../lib/api';
import { toast } from 'sonner';

export const SHED_HEALTH_QUESTIONS = [
  { key: 'shed_roof_condition', label: 'Shed roof condition', okLabel: 'Good', notOkLabel: 'Damaged' },
  { key: 'cleanliness',         label: 'Cleanliness',         okLabel: 'Clean', notOkLabel: 'Dirty' },
  { key: 'lighting',             label: 'Lighting',           okLabel: 'Adequate', notOkLabel: 'Inadequate' },
  { key: 'water_seepage',        label: 'Water seepage',      okLabel: 'No seepage', notOkLabel: 'Seepage observed' },
];

/**
 * Validate that a sub-zone health entry has photos+remarks for every "not_ok"
 * answer. Returns the first violating question key, or null if valid.
 */
export function validateSubZoneHealth(entry) {
  if (!entry) return null;
  for (const q of SHED_HEALTH_QUESTIONS) {
    const ans = entry.responses?.[q.key];
    if (ans === 'not_ok') {
      const photos = entry.photos?.[q.key] || [];
      if (photos.length === 0) return q.key;
    }
  }
  return null;
}

export default function SubZoneHealthCard({ subZoneId, subZoneName, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  const fileInputRefs = useRef({});

  const entry = value || { sub_zone_id: subZoneId, responses: {}, photos: {}, remarks: '' };
  const responses = entry.responses || {};
  const photos = entry.photos || {};

  const answeredCount = SHED_HEALTH_QUESTIONS.filter(q => responses[q.key]).length;
  const notOkCount = SHED_HEALTH_QUESTIONS.filter(q => responses[q.key] === 'not_ok').length;
  const missingPhotoKey = validateSubZoneHealth(entry);

  const setResponse = (key, val) => {
    onChange({
      ...entry,
      sub_zone_id: subZoneId,
      responses: { ...responses, [key]: val },
    });
  };

  const setRemarks = (val) => {
    onChange({ ...entry, sub_zone_id: subZoneId, remarks: val });
  };

  const handlePhotos = async (key, files) => {
    if (!files || files.length === 0) return;
    setUploadingKey(key);
    try {
      const urls = [];
      for (const f of Array.from(files)) {
        const r = await uploadAPI.single(f);
        if (r.data?.url) urls.push(r.data.url);
      }
      onChange({
        ...entry,
        sub_zone_id: subZoneId,
        photos: { ...photos, [key]: [...(photos[key] || []), ...urls] },
      });
      toast.success(`${urls.length} photo${urls.length !== 1 ? 's' : ''} added`);
    } catch (e) {
      toast.error('Photo upload failed');
    } finally {
      setUploadingKey(null);
    }
  };

  const removePhoto = (key, idx) => {
    const next = [...(photos[key] || [])];
    next.splice(idx, 1);
    onChange({ ...entry, sub_zone_id: subZoneId, photos: { ...photos, [key]: next } });
  };

  // Visual state for the collapsed header
  const statusColor = answeredCount === 0
    ? 'border-border bg-card'
    : missingPhotoKey
    ? 'border-amber-300 bg-amber-50/50'
    : notOkCount > 0
    ? 'border-orange-300 bg-orange-50/40'
    : 'border-emerald-300 bg-emerald-50/40';

  return (
    <div
      data-testid={`subzone-health-card-${subZoneId}`}
      className={`rounded-lg border ${statusColor} transition-colors`}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        data-testid={`subzone-health-toggle-${subZoneId}`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground/80 truncate">
            Shed Health — {subZoneName}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {answeredCount}/{SHED_HEALTH_QUESTIONS.length} answered
            {notOkCount > 0 && <span className="text-orange-700 ml-1.5">· {notOkCount} issue{notOkCount !== 1 ? 's' : ''}</span>}
            {missingPhotoKey && <span className="text-amber-700 ml-1.5">· photo required</span>}
          </div>
        </div>
        {answeredCount === SHED_HEALTH_QUESTIONS.length && !missingPhotoKey && notOkCount === 0 && (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
        )}
        {missingPhotoKey && <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t pt-2.5">
          {SHED_HEALTH_QUESTIONS.map(q => {
            const ans = responses[q.key];
            const photoList = photos[q.key] || [];
            const needsPhoto = ans === 'not_ok' && photoList.length === 0;
            return (
              <div key={q.key} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium flex-1">{q.label}</span>
                  <div className="flex rounded-md border overflow-hidden text-[10px]">
                    <button
                      type="button"
                      onClick={() => setResponse(q.key, 'ok')}
                      data-testid={`shed-${q.key}-ok-${subZoneId}`}
                      className={`px-2.5 py-1 transition-colors ${ans === 'ok' ? 'bg-emerald-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}
                    >
                      {q.okLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setResponse(q.key, 'not_ok')}
                      data-testid={`shed-${q.key}-notok-${subZoneId}`}
                      className={`px-2.5 py-1 border-l transition-colors ${ans === 'not_ok' ? 'bg-red-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}
                    >
                      {q.notOkLabel}
                    </button>
                  </div>
                </div>
                {/* Photos appear only when "not_ok" — mandatory */}
                {ans === 'not_ok' && (
                  <div className={`rounded-md border border-dashed p-2 ${needsPhoto ? 'border-amber-400 bg-amber-50/60' : 'border-border bg-muted/30'}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {photoList.map((url, i) => (
                        <div key={i} className="relative">
                          <img src={url} alt="" className="h-12 w-12 rounded object-cover border" />
                          <button
                            type="button"
                            onClick={() => removePhoto(q.key, i)}
                            className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full h-4 w-4 flex items-center justify-center"
                          >
                            <X size={9} />
                          </button>
                        </div>
                      ))}
                      <input
                        ref={(el) => { fileInputRefs.current[q.key] = el; }}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => handlePhotos(q.key, e.target.files)}
                        data-testid={`shed-${q.key}-photo-input-${subZoneId}`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-[10px] gap-1"
                        onClick={() => fileInputRefs.current[q.key]?.click()}
                        disabled={uploadingKey === q.key}
                        data-testid={`shed-${q.key}-photo-btn-${subZoneId}`}
                      >
                        {uploadingKey === q.key
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Camera size={11} />}
                        Photo {needsPhoto && '*'}
                      </Button>
                    </div>
                    {needsPhoto && (
                      <p className="text-[10px] text-amber-700 mt-1">Photo is required when "{q.notOkLabel}"</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <Textarea
            value={entry.remarks || ''}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks for this sub-zone (optional)…"
            rows={2}
            className="text-xs"
            data-testid={`shed-remarks-${subZoneId}`}
          />
          {notOkCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700">
              {notOkCount} issue{notOkCount !== 1 ? 's' : ''} logged
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
