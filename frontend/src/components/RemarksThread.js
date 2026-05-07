/**
 * RemarksThread — Phase 5 immutable threaded log for orange-list defects.
 *
 * Props:
 *   - orangeListId: string (required)
 *   - readOnlyHint?: boolean — when caller already knows the asset is resolved
 *
 * Renders an expandable feed of system + user remarks with role-aware compose.
 * Posts are immutable and confirmed via a one-time prompt before submission.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { remarksAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { formatDateTime } from '../lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog';
import { toast } from 'sonner';
import {
  MessageSquare, ShieldAlert, Eye, ClipboardCheck, AlertTriangle,
  CheckCircle2, XCircle, Wrench, Bot,
} from 'lucide-react';

const TYPE_OPTIONS = [
  {
    value: 'note', label: 'Note',
    desc: 'Progress / general note (notifies ASUP + RO)',
    roles: ['supervisor', 'approving_supervisor', 'reporting_officer', 'admin', 'superadmin'],
    icon: MessageSquare,
  },
  {
    value: 'observation', label: 'Observation',
    desc: 'Field observation (notifies SUP + ASUP)',
    roles: ['approving_supervisor', 'reporting_officer', 'admin', 'superadmin'],
    icon: Eye,
  },
  {
    value: 'escalation', label: 'Escalation',
    desc: 'Escalate (notifies SUP + ASUP + RO)',
    roles: ['supervisor', 'approving_supervisor', 'reporting_officer', 'admin', 'superadmin'],
    icon: ShieldAlert,
  },
];

const TYPE_META = {
  defect_report: { label: 'Defect Reported', icon: AlertTriangle, tone: 'text-orange-600 bg-orange-50' },
  rectification: { label: 'Marked Working', icon: Wrench,         tone: 'text-emerald-600 bg-emerald-50' },
  approval:      { label: 'Approved',        icon: CheckCircle2,  tone: 'text-emerald-700 bg-emerald-50' },
  rejection:     { label: 'Rejected',        icon: XCircle,       tone: 'text-red-600 bg-red-50' },
  note:          { label: 'Note',            icon: MessageSquare, tone: 'text-slate-700 bg-slate-50' },
  observation:   { label: 'Observation',     icon: Eye,           tone: 'text-blue-700 bg-blue-50' },
  escalation:    { label: 'Escalation',      icon: ShieldAlert,   tone: 'text-amber-700 bg-amber-50' },
};

const TEXT_MAX = 300;

export default function RemarksThread({ orangeListId, readOnlyHint = false }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [readOnly, setReadOnly] = useState(readOnlyHint);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState([]);

  // compose state
  const [type, setType] = useState('note');
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [tagRef, setTagRef] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const role = user?.role;
  const allowedTypes = useMemo(
    () => TYPE_OPTIONS.filter(t => t.roles.includes(role)),
    [role]
  );

  const load = useCallback(async () => {
    if (!orangeListId) return;
    try {
      const [threadRes, tagsRes] = await Promise.all([
        remarksAPI.listThread(orangeListId),
        remarksAPI.listTags(false),
      ]);
      setItems(threadRes.data.items || []);
      setReadOnly(!!threadRes.data.read_only);
      setArchived(!!threadRes.data.archived);
      setTags(tagsRes.data || []);
    } catch (e) {
      toast.error(errString(e, 'Failed to load remarks'));
    } finally {
      setLoading(false);
    }
  }, [orangeListId]);

  useEffect(() => { load(); }, [load]);

  const selectedTagMeta = useMemo(
    () => tags.find(t => t.slug === tag) || null,
    [tags, tag]
  );

  const charCount = text.length;
  const overLimit = charCount > TEXT_MAX;
  const tagNeedsRef = !!selectedTagMeta?.requires_ref;
  const submitDisabled =
    submitting || !text.trim() || overLimit || (tagNeedsRef && !tagRef.trim());

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        type,
        text: text.trim(),
        tag: tag || null,
        tag_ref: tagRef.trim() || null,
      };
      await remarksAPI.postRemark(orangeListId, payload, user._id);
      toast.success('Remark posted');
      setText('');
      setTag('');
      setTagRef('');
      load();
    } catch (e) {
      toast.error(errString(e, 'Failed to post remark'));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  if (archived) {
    return (
      <div className="rounded-md bg-muted/40 border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        This remarks thread has been archived (60 days after approval).
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="remarks-thread">
      {/* Thread feed */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-12 bg-muted/40 animate-pulse rounded-md" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-2">
            No remarks yet.
          </p>
        ) : (
          items.map(r => {
            const meta = TYPE_META[r.type] || TYPE_META.note;
            const Icon = meta.icon;
            return (
              <div
                key={r._id}
                className="flex gap-2.5 p-2.5 rounded-md border bg-card"
                data-testid={`remark-${r._id}`}
              >
                <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-medium">{r.author_name || 'User'}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 uppercase tracking-wide">
                      {meta.label}
                    </Badge>
                    {r.is_auto && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                        <Bot className="h-2.5 w-2.5 mr-0.5" /> auto
                      </Badge>
                    )}
                    {r.tag && (
                      <Badge className="text-[9px] px-1 py-0 h-4 bg-slate-200 text-slate-800 hover:bg-slate-200 border-0">
                        {(tags.find(t => t.slug === r.tag)?.label) || r.tag}
                        {r.tag_ref ? ` · ${r.tag_ref}` : ''}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {r.created_at ? formatDateTime(r.created_at) : ''}
                    </span>
                  </div>
                  <p className="text-xs text-foreground break-words whitespace-pre-wrap">{r.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose */}
      {readOnly ? (
        <div className="rounded-md bg-muted/30 border border-dashed px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5" />
          Defect resolved — thread is read-only.
        </div>
      ) : allowedTypes.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          Your role cannot post remarks here.
        </div>
      ) : (
        <div className="space-y-2 border rounded-md p-3 bg-muted/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-xs" data-testid="remark-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTypes.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">
                      <div className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">Tag (optional)</Label>
              <Select value={tag || '__none__'} onValueChange={(v) => { setTag(v === '__none__' ? '' : v); setTagRef(''); }}>
                <SelectTrigger className="h-8 text-xs" data-testid="remark-tag-select">
                  <SelectValue placeholder="No tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">No tag</SelectItem>
                  {tags.map(t => (
                    <SelectItem key={t.slug} value={t.slug} className="text-xs">
                      {t.label}{t.requires_ref ? ' · needs ref' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tagNeedsRef && (
            <div>
              <Label className="text-[11px]">{selectedTagMeta?.label} reference *</Label>
              <Input
                value={tagRef}
                onChange={(e) => setTagRef(e.target.value)}
                placeholder="e.g. WO-12345"
                className="h-8 text-xs"
                data-testid="remark-tag-ref"
              />
            </div>
          )}

          <div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX + 50))}
              placeholder="Write a remark... (immutable once posted)"
              rows={2}
              className="text-xs resize-none"
              data-testid="remark-text"
              maxLength={TEXT_MAX + 50}
            />
            <div className="flex items-center justify-between mt-1">
              <span className={`text-[10px] ${overLimit ? 'text-red-600' : 'text-muted-foreground'}`}>
                {charCount}/{TEXT_MAX}
              </span>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => setConfirming(true)}
                disabled={submitDisabled}
                data-testid="remark-submit"
              >
                Post Remark
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* One-time confirmation before posting */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post this remark?</AlertDialogTitle>
            <AlertDialogDescription>
              Remarks are immutable — they cannot be edited or deleted once posted.
              Recipients will be notified based on the type chosen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
            {text}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="remark-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} data-testid="remark-confirm-post">
              Post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
