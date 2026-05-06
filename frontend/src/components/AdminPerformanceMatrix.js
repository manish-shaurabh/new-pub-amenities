/**
 * AdminPerformanceMatrix — Phase 4 Extension
 *
 * Tier 1 (rollup):
 *   Stations as rows × Departments as columns. Each cell is an aggregated
 *   summary across active SUPs at that intersection. Empty (orphan) cells
 *   render in muted style. Click a cell, row, or column header to expand
 *   Tier 2 (SUP comparison) inline below.
 *
 * Tier 2 (inline expand):
 *   Re-uses the comparison summary endpoints. For Admin we build the SUP list
 *   from the cell.sup_ids and just fetch /performance for each on-demand.
 *
 * Includes:
 *   - Orphan coverage banner (RED for missing SUP, AMBER for missing ASUP/RO)
 *   - Date range filter (from / to)
 *   - FY benchmark column shown in Tier 2 expansion
 *   - ★ zero-defect celebration on cells & rows
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { analyticsAPI, usersAPI } from '../lib/api';
import { errString } from '../lib/err';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { toast } from 'sonner';
import {
  TrendingUp, AlertOctagon, AlertTriangle, ChevronDown, ChevronRight,
  ArrowLeft, Star, X,
} from 'lucide-react';
import SupervisorAnalyticsView from './SupervisorAnalyticsView';

const fmtH = (h) => {
  if (!h && h !== 0) return '—';
  if (h === 0) return '—';
  return h < 1 ? `${Math.round(h * 60)} m` : `${h.toFixed(1)} h`;
};

const pctClass = (p) =>
  p === null || p === undefined
    ? 'text-muted-foreground'
    : p >= 95
      ? 'text-emerald-600'
      : p >= 85
        ? 'text-orange-500'
        : 'text-red-600';

const toDateInput = (d) => d.toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Coverage Gaps Banner
// ─────────────────────────────────────────────────────────────────────────────
function CoverageGapsBanner() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await analyticsAPI.adminCoverageGaps();
        setData(res.data);
      } catch (e) {
        // soft-fail; banner is optional
        console.error('coverage-gaps fetch', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !data) return null;
  const { totals } = data;
  const total = totals.missing_sup + totals.missing_asup + totals.missing_ro;
  if (total === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-3 flex items-center gap-2">
          <Star className="h-4 w-4 text-emerald-600 fill-emerald-600" />
          <p className="text-sm text-emerald-700">All Station × Department combinations have SUP, ASUP, and RO coverage.</p>
        </CardContent>
      </Card>
    );
  }

  const isRed = totals.missing_sup > 0;
  const tone = isRed
    ? 'border-red-300 bg-red-50/60'
    : 'border-amber-300 bg-amber-50/60';

  return (
    <Card className={tone} data-testid="coverage-gaps-banner">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-3 hover:bg-black/5 transition" data-testid="coverage-gaps-toggle">
            <div className="flex items-center gap-2">
              {isRed
                ? <AlertOctagon className="h-4 w-4 text-red-600" />
                : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              <p className="text-sm font-medium">
                Personnel coverage gaps detected
              </p>
              {totals.missing_sup > 0 && (
                <Badge className="bg-red-600 text-white border-0 text-[10px]">
                  {totals.missing_sup} SUP
                </Badge>
              )}
              {totals.missing_asup > 0 && (
                <Badge className="bg-amber-500 text-white border-0 text-[10px]">
                  {totals.missing_asup} ASUP
                </Badge>
              )}
              {totals.missing_ro > 0 && (
                <Badge className="bg-amber-500 text-white border-0 text-[10px]">
                  {totals.missing_ro} RO
                </Badge>
              )}
            </div>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3 max-h-72 overflow-y-auto">
            {data.missing_sup.length > 0 && (
              <GapList title="Missing Supervisor (urgent)" rows={data.missing_sup} severity="red" testId="gaps-sup" />
            )}
            {data.missing_asup.length > 0 && (
              <GapList title="Missing Approving Supervisor" rows={data.missing_asup} severity="amber" testId="gaps-asup" />
            )}
            {data.missing_ro.length > 0 && (
              <GapList title="Missing Reporting Officer" rows={data.missing_ro} severity="amber" testId="gaps-ro" />
            )}
            <p className="text-[11px] text-muted-foreground italic">
              Fix these in Admin Panel → Users.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function GapList({ title, rows, severity, testId }) {
  const tone = severity === 'red' ? 'text-red-700' : 'text-amber-700';
  return (
    <div data-testid={testId}>
      <p className={`text-xs font-semibold ${tone} mb-1`}>{title} ({rows.length})</p>
      <div className="text-xs space-y-0.5 pl-2 border-l-2 border-muted">
        {rows.slice(0, 12).map((r, i) => (
          <p key={i}>
            • {r.station_name}{r.department_name ? ` · ${r.department_name}` : ''}
          </p>
        ))}
        {rows.length > 12 && (
          <p className="text-muted-foreground">…and {rows.length - 12} more</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUP comparison list (Tier 2) — inline expand
// ─────────────────────────────────────────────────────────────────────────────
function SupComparisonInline({ supIds, fromDate, toDate, onPick }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const allUsers = (await usersAPI.list({})).data || [];
        const target = allUsers.filter(u => supIds.includes(u._id));
        // For each SUP, fetch /performance with the date range
        const results = await Promise.all(
          target.map(async (u) => {
            try {
              const r = await analyticsAPI.supervisorPerformance(u._id, { fromDate, toDate });
              return {
                _id: u._id,
                name: u.name,
                employee_id: u.employee_id,
                department_name: r.data?.department_name,
                summary: r.data?.summary,
              };
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) setRows(results.filter(Boolean));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supIds, fromDate, toDate]);

  if (loading) {
    return <div className="space-y-1">{[1,2].map(i => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}</div>;
  }
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2 px-1">No supervisors at this scope.</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map(r => {
        const sum = r.summary || {};
        const zero = sum.total_defects === 0 && sum.total_assets > 0;
        return (
          <button
            key={r._id}
            onClick={() => onPick(r)}
            className={`w-full grid grid-cols-[1fr_72px_64px_56px_48px_20px] gap-2 items-center px-3 py-2 rounded text-left hover:bg-muted/50 ${zero ? 'bg-emerald-50/50' : ''}`}
            data-testid={`admin-sup-row-${r._id}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {zero && <Star className="h-3 w-3 text-amber-500 fill-amber-400" />}
                <p className="text-xs font-medium truncate">{r.name}</p>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{r.employee_id} · {r.department_name}</p>
            </div>
            <p className="text-xs tabular-nums">{fmtH(sum.avg_repair_hours)}</p>
            <p className={`text-xs tabular-nums font-semibold ${pctClass(sum.pct_functional)}`}>
              {sum.pct_functional ?? '—'}%
            </p>
            <p className="text-xs tabular-nums">{sum.total_defects ?? 0}</p>
            <p className="text-xs tabular-nums">{sum.rejection_count ?? 0}</p>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminPerformanceMatrix({ onClose }) {
  const now = new Date();
  const [fromDate, setFromDate] = useState(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toDateInput(now));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tier 2 selection: { kind: 'cell'|'row'|'col', supIds, label }
  const [selection, setSelection] = useState(null);
  // Tier 3 SUP drilldown
  const [pickedSup, setPickedSup] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await analyticsAPI.adminRollup({ fromDate, toDate });
      setData(res.data);
    } catch (e) {
      toast.error(errString(e, 'Failed to load admin rollup'));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // Aggregate department totals (column footer) and station totals (row trailing)
  const colTotals = useMemo(() => {
    if (!data) return {};
    const out = {};
    for (const dept of data.departments) {
      let supSet = new Set();
      let totalDefects = 0;
      const avgs = [];
      const pcts = [];
      let rej = 0;
      let assets = 0;
      for (const row of data.matrix) {
        const cell = row.cells.find(c => c.department_id === dept._id);
        if (!cell || cell.sup_count === 0) continue;
        (cell.sup_ids || []).forEach(id => supSet.add(id));
        totalDefects += cell.total_defects;
        if (cell.avg_repair_hours > 0) avgs.push(cell.avg_repair_hours);
        if (cell.pct_functional !== null) pcts.push(cell.pct_functional);
        rej += cell.rejection_count;
        assets += cell.asset_count;
      }
      out[dept._id] = {
        sup_ids: Array.from(supSet),
        sup_count: supSet.size,
        asset_count: assets,
        total_defects: totalDefects,
        avg_repair_hours: avgs.length ? +(avgs.reduce((a, b) => a + b) / avgs.length).toFixed(2) : 0,
        pct_functional: pcts.length ? +(pcts.reduce((a, b) => a + b) / pcts.length).toFixed(2) : null,
        rejection_count: rej,
      };
    }
    return out;
  }, [data]);

  const rowTotals = useMemo(() => {
    if (!data) return {};
    const out = {};
    for (const row of data.matrix) {
      let supSet = new Set();
      let totalDefects = 0;
      const avgs = [];
      const pcts = [];
      let rej = 0;
      let assets = 0;
      for (const cell of row.cells) {
        if (cell.sup_count === 0) continue;
        (cell.sup_ids || []).forEach(id => supSet.add(id));
        totalDefects += cell.total_defects;
        if (cell.avg_repair_hours > 0) avgs.push(cell.avg_repair_hours);
        if (cell.pct_functional !== null) pcts.push(cell.pct_functional);
        rej += cell.rejection_count;
        assets += cell.asset_count;
      }
      out[row.station_id] = {
        sup_ids: Array.from(supSet),
        sup_count: supSet.size,
        asset_count: assets,
        total_defects: totalDefects,
        avg_repair_hours: avgs.length ? +(avgs.reduce((a, b) => a + b) / avgs.length).toFixed(2) : 0,
        pct_functional: pcts.length ? +(pcts.reduce((a, b) => a + b) / pcts.length).toFixed(2) : null,
        rejection_count: rej,
      };
    }
    return out;
  }, [data]);

  if (pickedSup) {
    return (
      <Card className="border-primary/30">
        <CardContent className="p-4 space-y-3">
          <button
            onClick={() => setPickedSup(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="admin-back-from-sup"
          >
            <ArrowLeft className="h-4 w-4" /> Back to comparison
          </button>
          <SupervisorAnalyticsView supervisorId={pickedSup._id} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CoverageGapsBanner />

      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Performance Matrix · Stations × Departments
            </CardTitle>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date filter */}
          <div className="flex items-end gap-3 flex-wrap p-3 bg-muted/30 rounded-lg">
            <div>
              <Label className="text-xs mb-1">From</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-xs w-[140px]" data-testid="matrix-from" />
            </div>
            <div>
              <Label className="text-xs mb-1">To</Label>
              <Input type="date" value={toDate} max={toDateInput(now)} onChange={e => setToDate(e.target.value)} className="h-8 text-xs w-[140px]" data-testid="matrix-to" />
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={load} disabled={loading} data-testid="matrix-apply">Apply</Button>
            {data && (
              <p className="text-[11px] text-muted-foreground ml-auto">
                Benchmark: <span className="font-medium">{data.fy.label}</span> dept avg
              </p>
            )}
          </div>

          {loading || !data ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}</div>
          ) : data.matrix.length === 0 || data.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No stations/departments found.</p>
          ) : (
            <div className="overflow-x-auto" data-testid="rollup-matrix">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left p-2 sticky left-0 bg-background z-10 min-w-[140px]">Station</th>
                    {data.departments.map(d => (
                      <th key={d._id} className="text-left p-2 align-bottom">
                        <button
                          onClick={() => {
                            const t = colTotals[d._id];
                            if (t && t.sup_count > 0) {
                              setSelection({ kind: 'col', supIds: t.sup_ids, label: `${d.name} · all stations` });
                            }
                          }}
                          className="font-semibold text-foreground hover:text-primary text-left whitespace-nowrap"
                          data-testid={`matrix-col-${d._id}`}
                        >
                          {d.name}
                        </button>
                        <p className="text-[10px] text-muted-foreground font-normal">
                          {data.dept_benchmarks?.[d._id]?.fy_avg_repair_hours
                            ? `${data.fy.label} avg ${fmtH(data.dept_benchmarks[d._id].fy_avg_repair_hours)}`
                            : `${data.fy.label} avg —`}
                        </p>
                      </th>
                    ))}
                    <th className="text-left p-2 align-bottom bg-muted/30">Row Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map(row => {
                    const rt = rowTotals[row.station_id];
                    return (
                      <tr key={row.station_id} className="border-t hover:bg-muted/20">
                        <td className="p-2 sticky left-0 bg-background z-10">
                          <button
                            onClick={() => {
                              if (rt && rt.sup_count > 0) {
                                setSelection({ kind: 'row', supIds: rt.sup_ids, label: `${row.station_name} · all departments` });
                              }
                            }}
                            className="font-medium hover:text-primary whitespace-nowrap text-left"
                            data-testid={`matrix-row-${row.station_id}`}
                          >
                            {row.station_name}
                          </button>
                        </td>
                        {row.cells.map((cell, i) => {
                          const benchmark = data.dept_benchmarks?.[cell.department_id]?.fy_avg_repair_hours || 0;
                          const delta = (cell.avg_repair_hours && benchmark) ? cell.avg_repair_hours - benchmark : 0;
                          return (
                            <td
                              key={i}
                              className={`p-2 ${cell.is_orphan ? 'opacity-50' : ''}`}
                            >
                              {cell.is_orphan ? (
                                <span className="text-[10px] text-muted-foreground italic">—</span>
                              ) : (
                                <button
                                  onClick={() => setSelection({
                                    kind: 'cell', supIds: cell.sup_ids,
                                    label: `${row.station_name} · ${data.departments.find(dd => dd._id === cell.department_id)?.name || ''}`
                                  })}
                                  className="text-left w-full hover:bg-muted/30 rounded p-1"
                                  data-testid={`matrix-cell-${row.station_id}-${cell.department_id}`}
                                >
                                  <div className="flex items-center gap-1">
                                    {cell.zero_defect && <Star className="h-3 w-3 text-amber-500 fill-amber-400 flex-shrink-0" />}
                                    <span className="font-semibold tabular-nums">{fmtH(cell.avg_repair_hours)}</span>
                                    {benchmark > 0 && cell.avg_repair_hours > 0 && (
                                      <span className={`text-[9px] ${delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {delta > 0 ? '▲' : '▼'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5 text-[10px] text-muted-foreground tabular-nums mt-0.5">
                                    <span className={pctClass(cell.pct_functional)}>{cell.pct_functional}%</span>
                                    <span>· {cell.total_defects}d</span>
                                    {cell.rejection_count > 0 && <span>· {cell.rejection_count}r</span>}
                                  </div>
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="p-2 bg-muted/20">
                          {rt && rt.sup_count > 0 ? (
                            <div>
                              <span className="font-semibold tabular-nums">{fmtH(rt.avg_repair_hours)}</span>
                              <p className={`text-[10px] ${pctClass(rt.pct_functional)}`}>{rt.pct_functional}%</p>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selection && (
            <Card className="border-primary/40">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{selection.label}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setSelection(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{selection.supIds.length} supervisor(s)</p>
              </CardHeader>
              <CardContent>
                {/* Header */}
                <div className="grid grid-cols-[1fr_72px_64px_56px_48px_20px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  <span>Supervisor</span>
                  <span>Avg Repair</span>
                  <span>% Up</span>
                  <span>Defects</span>
                  <span>Rej.</span>
                  <span />
                </div>
                <SupComparisonInline
                  supIds={selection.supIds}
                  fromDate={fromDate}
                  toDate={toDate}
                  onPick={(r) => setPickedSup(r)}
                />
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
