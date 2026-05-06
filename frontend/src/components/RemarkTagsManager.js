/**
 * RemarkTagsManager — Admin UI for the dynamic remark tag master list.
 * Used inside AdminPage as the "Tags" tab.
 */
import { useState, useEffect, useCallback } from 'react';
import { remarksAPI } from '../lib/api';
import { errString } from '../lib/err';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { toast } from 'sonner';
import { Plus, Pencil, Archive, Tag } from 'lucide-react';

export default function RemarkTagsManager() {
  const { user } = useAuth();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState('create');
  const [form, setForm] = useState({ _id: '', slug: '', label: '', requires_ref: false });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await remarksAPI.listTags(true);
      setTags(res.data || []);
    } catch (e) {
      toast.error(errString(e, 'Failed to load tags'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setMode('create');
    setForm({ _id: '', slug: '', label: '', requires_ref: false });
    setDialogOpen(true);
  };

  const openEdit = (tag) => {
    setMode('edit');
    setForm({ _id: tag._id, slug: tag.slug, label: tag.label, requires_ref: !!tag.requires_ref });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await remarksAPI.createTag(
          { slug: form.slug.trim(), label: form.label.trim(), requires_ref: form.requires_ref },
          user._id
        );
        toast.success('Tag created');
      } else {
        await remarksAPI.updateTag(
          form._id,
          { label: form.label.trim(), requires_ref: form.requires_ref },
          user._id
        );
        toast.success('Tag updated');
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(errString(e, 'Failed to save tag'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (tag) => {
    if (!window.confirm(`Archive tag "${tag.label}"? It will no longer be selectable.`)) return;
    try {
      await remarksAPI.deleteTag(tag._id, user._id);
      toast.success('Tag archived');
      load();
    } catch (e) {
      toast.error(errString(e, 'Failed to archive tag'));
    }
  };

  const active = tags.filter(t => !t.archived);
  const archived = tags.filter(t => t.archived);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" /> Remark Tags
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Tags appear in the dropdown when posting remarks against defects. Required-ref tags
            (like Work Order) prompt for a reference number.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="add-tag-button">
          <Plus className="h-4 w-4 mr-1" /> Add Tag
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">Active ({active.length})</p>
              {active.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No active tags.</p>
              ) : (
                <div className="divide-y border rounded-md">
                  {active.map(t => (
                    <div key={t._id} className="flex items-center justify-between p-2.5" data-testid={`tag-row-${t.slug}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-xs">{t.slug}</Badge>
                        <span className="text-sm truncate">{t.label}</span>
                        {t.requires_ref && (
                          <Badge className="bg-blue-100 text-blue-800 border-0 text-[10px]">requires ref</Badge>
                        )}
                        {t.is_default && (
                          <Badge variant="secondary" className="text-[10px]">default</Badge>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(t)} data-testid={`edit-tag-${t.slug}`}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleArchive(t)} data-testid={`archive-tag-${t.slug}`}>
                          <Archive className="h-3 w-3 mr-1" /> Archive
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {archived.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">Archived ({archived.length})</p>
                <div className="divide-y border rounded-md opacity-60">
                  {archived.map(t => (
                    <div key={t._id} className="flex items-center gap-2 p-2.5">
                      <Badge variant="outline" className="text-xs">{t.slug}</Badge>
                      <span className="text-sm truncate">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Add Tag' : 'Edit Tag'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Slug *</Label>
              <Input
                value={form.slug}
                disabled={mode === 'edit'}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                placeholder="e.g. spare_pending"
                data-testid="tag-slug-input"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Lowercase, no spaces. Cannot be changed after creation.</p>
            </div>
            <div>
              <Label className="text-xs">Label *</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Spare Pending"
                data-testid="tag-label-input"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="requires_ref"
                checked={form.requires_ref}
                onCheckedChange={(v) => setForm({ ...form, requires_ref: !!v })}
                data-testid="tag-requires-ref"
              />
              <Label htmlFor="requires_ref" className="text-xs cursor-pointer">
                Requires reference (e.g. WO number)
              </Label>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !form.slug.trim() || !form.label.trim()}
              className="w-full"
              data-testid="tag-submit"
            >
              {submitting ? 'Saving…' : mode === 'create' ? 'Create Tag' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
