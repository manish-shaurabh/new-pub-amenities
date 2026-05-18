/**
 * DataReconcilePanel — Admin → Data Health → Data Reconciliation card.
 *
 * Heals two known production data drifts:
 *   1. Orange List ⇄ Asset Status (two-way reconcile + back-fill)
 *   2. Divisions whose zone_id no longer matches any zone (relink to ECR)
 *
 * Flow: Preview (dry-run) → review counts in modal → Execute → audit history.
 *
 * Only Superadmin can preview/execute.
 */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, Wrench, AlertTriangle, History, ListChecks } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export default function DataReconcilePanel({ currentUser }) {
  const isSuperadmin = currentUser?.role === 'superadmin';
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [audit, setAudit] = useState([]);

  const refreshAudit = async () => {
    try {
      const r = await axios.get(
        `${BACKEND}/api/data-heal/audit/${currentUser._id}?limit=10`);
      setAudit(r.data.rows || []);
    } catch (e) { /* viewer-role users get 403; fine to ignore */ }
  };

  useEffect(() => { if (isSuperadmin) refreshAudit(); }, [currentUser._id]);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const r = await axios.post(
        `${BACKEND}/api/data-heal/preview/${currentUser._id}`);
      setPreview(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Preview failed');
    } finally { setPreviewing(false); }
  };

  const runExecute = async () => {
    setExecuting(true);
    try {
      const r = await axios.post(
        `${BACKEND}/api/data-heal/execute/${currentUser._id}`);
      const s = r.data;
      toast.success(
        `Reconcile complete — ${s.orange_list.forward_create_count} OL rows back-filled, `
        + `${s.orange_list.backward_fix_count} assets re-flagged, `
        + `${s.divisions.relink_count} division(s) relinked.`
      );
      setConfirming(false);
      setUnderstood(false);
      setPreview(null);
      await refreshAudit();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Reconcile failed');
    } finally { setExecuting(false); }
  };

  const totalCount = preview
    ? (preview.orange_list.forward_create_count
       + preview.orange_list.backward_fix_count
       + preview.divisions.orphan_count)
    : 0;

  return (
    <Card data-testid="data-reconcile-panel" className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4 text-amber-600" />
          Data Reconciliation
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          One-click heal for two known production drifts: missing Orange List rows
          for defective assets, and Divisions pointing at deleted Zones.
          <strong> Idempotent</strong> — safe to re-run.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isSuperadmin && (
          <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <div>Only <strong>Superadmin</strong> can preview or execute reconciliation.</div>
          </div>
        )}

        {isSuperadmin && (
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" size="sm" onClick={runPreview}
                    disabled={previewing}
                    data-testid="reconcile-preview-btn" className="gap-1.5">
              {previewing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <ListChecks className="h-3.5 w-3.5" />}
              Preview (Dry Run)
            </Button>
            {preview && (
              <Badge variant={totalCount > 0 ? 'destructive' : 'secondary'}
                     data-testid="reconcile-total">
                {totalCount} discrepanc{totalCount === 1 ? 'y' : 'ies'} found
              </Badge>
            )}
          </div>
        )}

        {preview && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <DriftStat
              label="OL rows to back-fill"
              hint="Defective assets without an active OL"
              count={preview.orange_list.forward_create_count}
              testId="reconcile-forward-count"
            />
            <DriftStat
              label="Assets to re-flag"
              hint="Open OL whose asset is 'working'"
              count={preview.orange_list.backward_fix_count}
              testId="reconcile-backward-count"
            />
            <DriftStat
              label="Divisions to relink"
              hint={preview.divisions.target_zone
                ? `Will relink to ${preview.divisions.target_zone.code}`
                : 'No target zone available'}
              count={preview.divisions.orphan_count}
              testId="reconcile-divisions-count"
            />
          </div>
        )}

        {preview && totalCount > 0 && isSuperadmin && (
          <div className="pt-1">
            <Button variant="destructive" size="sm"
                    onClick={() => { setUnderstood(false); setConfirming(true); }}
                    data-testid="reconcile-execute-btn" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" />
              Execute Reconciliation
            </Button>
          </div>
        )}

        {/* Sample rows (collapsed by default-ish: shown only when present) */}
        {preview && totalCount > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
              View sample records ({Math.min(
                10,
                preview.orange_list.forward_sample.length
                + preview.orange_list.backward_sample.length
                + preview.divisions.sample.length
              )} shown)
            </summary>
            <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
              {preview.orange_list.forward_sample.length > 0 && (
                <SampleBlock title="Forward (asset → missing OL)"
                             rows={preview.orange_list.forward_sample.map(s =>
                               `${s.asset_number || s.asset_id} · ${s.status} · since ${(s.defective_since || '').slice(0, 10)}`)} />
              )}
              {preview.orange_list.backward_sample.length > 0 && (
                <SampleBlock title="Backward (OL → asset says working)"
                             rows={preview.orange_list.backward_sample.map(s =>
                               `${s.asset_number || s.asset_id} · OL=${s.ol_status} · asset=${s.current_asset_status}`)} />
              )}
              {preview.divisions.sample.length > 0 && (
                <SampleBlock title="Orphan divisions"
                             rows={preview.divisions.sample.map(s =>
                               `${s.name} [${s.code}] · bad zone_id=${s.bad_zone_id.slice(0, 8)}…`)} />
              )}
            </div>
          </details>
        )}

        {/* Audit history */}
        {isSuperadmin && audit.length > 0 && (
          <div className="pt-2 border-t mt-2">
            <div className="text-xs font-medium text-slate-600 flex items-center gap-1.5 mb-1">
              <History className="h-3 w-3" /> Recent reconciliations
            </div>
            <div className="text-[11px] space-y-0.5 max-h-32 overflow-y-auto"
                 data-testid="reconcile-audit-rows">
              {audit.map(a => (
                <div key={a._id} className="flex justify-between gap-2 text-slate-600">
                  <span className="text-slate-400">{(a.performed_at || '').slice(0, 16)}</span>
                  <span className="font-mono text-slate-500 truncate">
                    OL+{a.summary?.ol_forward_created || 0}/-{a.summary?.ol_backward_fixed || 0}
                    {' '}· Div⇒{a.summary?.divisions_relinked || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Confirmation dialog */}
        <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
          <DialogContent className="max-w-md" data-testid="reconcile-confirm-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" /> Confirm Reconciliation
              </DialogTitle>
              <DialogDescription>
                This will modify the database to align Orange List rows with asset
                statuses and relink orphan divisions. Changes are recorded in the
                audit log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-xs">
              <ul className="rounded bg-amber-50 border border-amber-200 p-3 space-y-1">
                <li>• Create <strong>{preview?.orange_list.forward_create_count || 0}</strong> orange-list rows</li>
                <li>• Re-flag <strong>{preview?.orange_list.backward_fix_count || 0}</strong> asset(s) as defective</li>
                <li>• Relink <strong>{preview?.divisions.relink_count || 0}</strong> division(s)
                  {preview?.divisions.target_zone &&
                    <> to <strong>{preview.divisions.target_zone.name}</strong> [{preview.divisions.target_zone.code}]</>}
                </li>
              </ul>
              <label className="flex items-center gap-2">
                <Checkbox checked={understood} onCheckedChange={setUnderstood}
                          data-testid="reconcile-confirm-checkbox" />
                <span>I reviewed the dry-run and want to apply these changes.</span>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}
                      disabled={executing} data-testid="reconcile-confirm-cancel">
                Cancel
              </Button>
              <Button variant="destructive" disabled={!understood || executing}
                      onClick={runExecute} data-testid="reconcile-confirm-execute"
                      className="gap-1.5">
                {executing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Wrench className="h-4 w-4" />}
                Apply Reconciliation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function DriftStat({ label, hint, count, testId }) {
  const color = count > 0 ? 'text-amber-700' : 'text-slate-400';
  return (
    <div className="rounded border border-slate-200 p-2" data-testid={testId}>
      <div className="text-slate-600">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-[10px] text-slate-400">{hint}</div>
    </div>
  );
}

function SampleBlock({ title, rows }) {
  return (
    <div>
      <div className="font-medium text-slate-600">{title}</div>
      <ul className="pl-3 list-disc space-y-0.5 text-slate-500 font-mono text-[10px]">
        {rows.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  );
}
