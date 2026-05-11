/**
 * DataHealthPanel — Admin → Data Health tab.
 *
 * Surfaces categories of suspicious DB records, lets superadmin preview the
 * cascade-delete impact of any individual record, and execute bulk or
 * single-record cleanups. Admin can view; only Superadmin can execute.
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Loader2, AlertTriangle, ShieldAlert, RefreshCw, Eye, Trash2, History,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const CATEGORY_META = {
  orphan_inspection_items: { color: '#dc2626', icon: '🧱', perRecord: false },
  orphan_ol_entries:       { color: '#dc2626', icon: '🟠', perRecord: false },
  orphan_remarks:          { color: '#dc2626', icon: '💬', perRecord: false },
  test_users:              { color: '#7c3aed', icon: '🧪', perRecord: true },
  test_stations:           { color: '#7c3aed', icon: '🚧', perRecord: true },
  unnamed_asset_types:     { color: '#f59e0b', icon: '⁉️', perRecord: true },
  zero_activity_stations:  { color: '#0891b2', icon: '💤', perRecord: true },
  zero_activity_users:     { color: '#0891b2', icon: '👤', perRecord: true },
  stale_records:           { color: '#64748b', icon: '🗓️', perRecord: false },
  duplicates:              { color: '#f97316', icon: '👯', perRecord: true },
};

export default function DataHealthPanel({ currentUser }) {
  const isSuperadmin = currentUser?.role === 'superadmin';
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState([]);
  const [previewing, setPreviewing] = useState(null); // {category, target_id?, data}
  const [confirming, setConfirming] = useState(null); // {category, target_ids?, bulk}
  const [executing, setExecuting] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const refreshScan = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${BACKEND}/api/data-health/scan/${currentUser._id}`);
      setScan(r.data);
    } catch (e) {
      toast.error('Failed to scan');
    } finally { setLoading(false); }
  };
  const refreshAudit = async () => {
    try {
      const r = await axios.get(`${BACKEND}/api/data-health/audit/${currentUser._id}?limit=20`);
      setAudit(r.data.rows || []);
    } catch (e) {}
  };

  useEffect(() => { refreshScan(); refreshAudit(); }, [currentUser._id]);

  const openPreview = async (category, target_id) => {
    setPreviewing({ category, target_id, data: null, loading: true });
    try {
      const params = { category };
      if (target_id) params.target_id = target_id;
      const r = await axios.get(`${BACKEND}/api/data-health/preview/${currentUser._id}`, { params });
      setPreviewing({ category, target_id, data: r.data, loading: false });
    } catch (e) {
      toast.error(`Preview failed: ${e.response?.data?.detail || e.message}`);
      setPreviewing(null);
    }
  };

  const requestConfirm = (category, target_ids = null, bulk = false) => {
    setUnderstood(false);
    setConfirming({ category, target_ids, bulk });
  };

  const doClean = async () => {
    if (!confirming) return;
    setExecuting(true);
    try {
      const body = {
        category: confirming.category,
        target_ids: confirming.target_ids,
        bulk: confirming.bulk,
      };
      const r = await axios.post(`${BACKEND}/api/data-health/clean/${currentUser._id}`, body);
      toast.success(`Cleaned: ${JSON.stringify(r.data.summary)}`);
      setConfirming(null);
      setPreviewing(null);
      await refreshScan();
      await refreshAudit();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Cleanup failed');
    } finally {
      setExecuting(false);
    }
  };

  const totalIssues = useMemo(() => {
    if (!scan) return 0;
    return Object.values(scan.categories).reduce((a, c) => a + (c.count || 0), 0);
  }, [scan]);

  return (
    <div className="space-y-4" data-testid="data-health-panel">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Data Health
          </h2>
          <p className="text-xs text-slate-500">
            Scan for orphans, test residue, and duplicates. Cleanup is{' '}
            <strong>permanent</strong> — preview the cascade impact before confirming.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalIssues > 0 && (
            <Badge variant="destructive" data-testid="dh-total-issues">
              {totalIssues} issue{totalIssues !== 1 ? 's' : ''} found
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={refreshScan}
                  disabled={loading} data-testid="dh-rescan" className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Rescan
          </Button>
        </div>
      </div>

      {!isSuperadmin && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          <div>You can view this panel but only a <strong>Superadmin</strong> can execute cleanup actions.</div>
        </div>
      )}

      {/* Category cards */}
      {loading && !scan ? <Loader2 className="h-8 w-8 animate-spin text-teal-700 mx-auto py-12" /> :
        scan && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(scan.categories).map(([key, cat]) => {
              const meta = CATEGORY_META[key] || {};
              const dim = cat.count === 0;
              return (
                <Card key={key} className={dim ? 'opacity-60' : ''} data-testid={`dh-card-${key}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-lg">{meta.icon}</span>
                        <span>{cat.label}</span>
                      </span>
                      <span className="text-xl font-extrabold"
                            style={{ color: dim ? '#94a3b8' : meta.color }}>
                        {cat.count}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-1 pb-3">
                    {cat.count === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">All clean</p>
                    ) : (
                      <>
                        {/* Sample rows */}
                        <div className="text-[11px] space-y-0.5 mb-2 max-h-36 overflow-y-auto">
                          {(cat.sample || []).map((s, i) => (
                            <SampleRow key={i} sample={s} category={key}
                                       perRecord={meta.perRecord}
                                       onPreview={(tid) => openPreview(key, tid)}
                                       onDeleteOne={(tid) => requestConfirm(key, [tid], false)}
                                       isSuperadmin={isSuperadmin} />
                          ))}
                        </div>
                        <div className="flex gap-1 mt-2">
                          {!meta.perRecord && (
                            <Button size="sm" variant="outline"
                                    className="gap-1 h-7 text-xs flex-1"
                                    onClick={() => openPreview(key, null)}
                                    data-testid={`dh-preview-${key}`}>
                              <Eye className="h-3 w-3" /> Preview
                            </Button>
                          )}
                          {isSuperadmin && (
                            <Button size="sm" variant="destructive"
                                    className="gap-1 h-7 text-xs flex-1"
                                    onClick={() => requestConfirm(key, null, true)}
                                    data-testid={`dh-clean-${key}`}>
                              <Trash2 className="h-3 w-3" /> Clean all {cat.count}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      {/* Audit log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" />
            Cleanup Audit Log (last 20)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No cleanups recorded yet.</p>
          ) : (
            <div className="text-xs">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-1">When</th>
                    <th>By</th>
                    <th>Category</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody data-testid="dh-audit-rows">
                  {audit.map(a => (
                    <tr key={a._id} className="border-b last:border-0">
                      <td className="py-1 text-slate-500">{(a.performed_at || '').slice(0, 16)}</td>
                      <td>{a.performed_by_name || '—'}</td>
                      <td><Badge variant="outline" className="font-mono text-[10px]">{a.category}</Badge></td>
                      <td className="font-mono text-[10px] text-slate-600">{JSON.stringify(a.summary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={!!previewing} onOpenChange={() => setPreviewing(null)}>
        <DialogContent className="max-w-lg" data-testid="dh-preview-dialog">
          <DialogHeader>
            <DialogTitle>Cascade Preview</DialogTitle>
            <DialogDescription>
              Records that will be permanently deleted if you proceed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {previewing?.loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-teal-700 mx-auto" />
            ) : previewing?.data ? (
              <CascadeImpact data={previewing.data} />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewing(null)} data-testid="dh-preview-close">
              Close
            </Button>
            {isSuperadmin && previewing?.data && (
              <Button variant="destructive"
                      onClick={() => requestConfirm(previewing.category,
                                                    previewing.target_id ? [previewing.target_id] : null,
                                                    !previewing.target_id)}
                      data-testid="dh-preview-confirm" className="gap-1">
                <Trash2 className="h-4 w-4" /> Permanently delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final confirmation dialog */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="max-w-md" data-testid="dh-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" /> Confirm Permanent Cleanup
            </DialogTitle>
            <DialogDescription>
              This action <strong>cannot be undone</strong>. The records and their
              dependents will be removed from the database immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded bg-red-50 border border-red-200 p-3 text-xs">
              <div><strong>Category:</strong> <code>{confirming?.category}</code></div>
              <div>
                <strong>Scope:</strong>{' '}
                {confirming?.bulk
                  ? `ALL records in this category`
                  : `${confirming?.target_ids?.length || 0} record(s)`}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={understood} onCheckedChange={setUnderstood}
                        data-testid="dh-confirm-checkbox" />
              <span>I understand this is permanent and cannot be undone.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={executing}
                    data-testid="dh-confirm-cancel">
              Cancel
            </Button>
            <Button variant="destructive" disabled={!understood || executing}
                    onClick={doClean} data-testid="dh-confirm-execute" className="gap-1">
              {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Execute Cleanup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SampleRow({ sample, category, perRecord, onPreview, onDeleteOne, isSuperadmin }) {
  // sample can be a string, an object (user/station/type), or duplicate descriptor
  if (typeof sample === 'string') {
    return <div className="font-mono text-slate-500 truncate">{sample}</div>;
  }
  const label = sample.name || sample.asset_number || sample.employee_id || sample.id || '—';
  const subParts = [];
  if (sample.employee_id) subParts.push(sample.employee_id);
  if (sample.code) subParts.push(sample.code);
  if (sample.role) subParts.push(sample.role);
  if (sample.kind) subParts.push(sample.kind);
  return (
    <div className="flex items-center justify-between gap-1.5 group">
      <div className="truncate flex-1">
        <span className="text-slate-700">{label}</span>
        {subParts.length > 0 && (
          <span className="text-slate-400 ml-1">· {subParts.join(' · ')}</span>
        )}
      </div>
      {perRecord && sample.id && (
        <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition">
          <button onClick={() => onPreview(sample.id)}
                  className="text-teal-700 hover:bg-teal-50 px-1 rounded"
                  title="Preview cascade">
            <Eye className="h-3 w-3" />
          </button>
          {isSuperadmin && (
            <button onClick={() => onDeleteOne(sample.id)}
                    className="text-red-700 hover:bg-red-50 px-1 rounded"
                    title="Delete this record (cascade)">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CascadeImpact({ data }) {
  if (data.bulk) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          Bulk cleanup of <strong>{data.label}</strong>. {data.total}{' '}
          record(s) will be processed.
        </p>
        <p className="text-xs text-slate-500">
          Per-record impact varies — orphan items are simply removed; OL entries also delete their attached remarks.
        </p>
      </div>
    );
  }
  if (data.kind === 'station') {
    return (
      <div className="space-y-2 text-sm">
        <p>
          Deleting station <strong>{data.target.name}</strong>{' '}
          {data.target.code && <span className="text-slate-400">[{data.target.code}]</span>} will cascade-delete:
        </p>
        <ul className="text-xs space-y-0.5 pl-4 list-disc text-slate-700">
          <li>{data.cascade.locations} location(s)</li>
          <li>{data.cascade.assets} asset(s)</li>
          <li>{data.cascade.orange_list_entries} orange-list entries</li>
          <li>{data.cascade.remarks} remarks</li>
          <li>{data.cascade.inspections} inspection record(s) at this station</li>
          <li>{data.cascade.inspection_items_in_other_inspections} inspection items elsewhere referencing these assets</li>
          <li>{data.cascade.schedules} schedule(s)</li>
        </ul>
        <div className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1">
          <strong>{data.total_dependents}</strong> dependent record(s) + 1 station
        </div>
      </div>
    );
  }
  if (data.kind === 'user') {
    return (
      <div className="space-y-2 text-sm">
        <p>
          Deleting user <strong>{data.target.name}</strong>{' '}
          <span className="text-slate-400">({data.target.employee_id} · {data.target.role})</span>.
        </p>
        <ul className="text-xs space-y-0.5 pl-4 list-disc text-slate-700">
          <li>{data.cascade.ol_entries_marked_working_by_user} OL entries — refs nulled (kept for audit)</li>
          <li>{data.cascade.ol_entries_approved_by_user} OL entries approved — refs nulled</li>
          <li>{data.cascade.inspections_by_user} inspections — kept with deletion marker</li>
          <li>{data.cascade.remarks_by_user} remark(s) — kept</li>
        </ul>
        <div className="text-xs text-slate-500 italic">{data.cascade.note}</div>
      </div>
    );
  }
  if (data.cascade?.note || data.cascade?.assets_using_this_type != null) {
    return (
      <div className="space-y-2 text-sm">
        {Object.entries(data.cascade).map(([k, v]) => (
          <div key={k}><strong>{k.replaceAll('_', ' ')}:</strong> {String(v)}</div>
        ))}
      </div>
    );
  }
  return <pre className="text-[10px] bg-slate-50 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>;
}
