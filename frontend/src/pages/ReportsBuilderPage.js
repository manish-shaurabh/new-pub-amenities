/**
 * Reports Builder — Superadmin-only dynamic report composer (full Layer 1-6).
 *
 * Tabs:
 *   • Single Report  — compose & run a single config (Layers 1-4)
 *   • Dossier        — multi-section report (Layer 5)
 *   • History        — recent runs (Layer 6)
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Loader2, FileDown, FileSpreadsheet, Save, Trash2, Star, Sparkles,
  BarChart3, Play, FileType, History, BookText, Plus, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useAuth } from '../lib/auth-context';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

// ─── Helpers ───────────────────────────────────────────────────────────────
async function _download(url, body, filename) {
  try {
    const r = await axios.post(url, body, { responseType: 'blob' });
    const u = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = u; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(u);
  } catch (e) {
    toast.error('Export failed');
  }
}

const DEFAULT_CFG = {
  metric: 'pct_working',
  dim_x: 'station',
  dim_y: '',
  window: 'last_30d',
  filters: {
    station_ids: [], dept_ids: [], asset_type_ids: [],
    asset_statuses: [], list_types: [],
    repair_cap_hours: null, recurrence_within_days: 30,
    include_rejected_in_mttr: false,
    hour_from: null, hour_to: null,
  },
  output: {
    sort_by: 'value', sort_dir: 'desc', top_n: null,
    bucket_other_after: null, totals_row: false, n_threshold: 0,
  },
  viz: 'bar',
  annotations: { title: '', subtitle: '', note: '' },
  compare_to_previous: false,
};

const COLOR_PALETTE = ['#0e7c6b', '#0891b2', '#7c3aed', '#dc2626', '#f59e0b',
                       '#10b981', '#3b82f6', '#ec4899', '#84cc16', '#f97316'];

function fmtVal(metricKind, value) {
  if (value == null) return '—';
  if (metricKind === 'pct') return `${value}%`;
  if (metricKind === 'hrs') return `${value} hrs`;
  return value.toLocaleString();
}

function heatColor(value, max) {
  if (value == null || max <= 0) return '#f8fafc';
  const t = Math.min(1, value / max);
  const r = Math.round(254 - (254 - 220) * t);
  const g = Math.round(243 - (243 - 38) * t);
  const b = Math.round(199 - (199 - 38) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── BarRow / DonutChart / LineChart / Table renderers ────────────────────
function BarRow({ label, value, max, kind, color, isTotal, isOther }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`grid grid-cols-[160px_1fr_80px] items-center gap-3 text-sm ${isTotal ? 'font-bold border-t pt-1.5 mt-1' : ''} ${isOther ? 'italic text-slate-500' : ''}`}>
      <div className="truncate" title={label}>{label}</div>
      <div className="h-5 bg-slate-100 rounded overflow-hidden">
        <div className="h-full transition-all"
             style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-right tabular-nums">{fmtVal(kind, value)}</div>
    </div>
  );
}

function StackedBarRow({ label, segments, total }) {
  return (
    <div className="grid grid-cols-[160px_1fr_60px] items-center gap-3 text-sm">
      <div className="truncate font-medium text-slate-700" title={label}>{label}</div>
      <div className="h-6 flex rounded overflow-hidden border">
        {segments.map((s, i) => s.value > 0 && (
          <div key={i} title={`${s.label}: ${s.value}`}
               style={{ width: `${(s.value / total) * 100}%`, background: COLOR_PALETTE[i % COLOR_PALETTE.length] }}
               className="h-full flex items-center justify-center text-[9px] text-white font-semibold">
            {(s.value / total) > 0.08 ? Math.round(s.value) : ''}
          </div>
        ))}
      </div>
      <div className="text-right text-slate-500 tabular-nums">{total}</div>
    </div>
  );
}

function DonutChart({ rows, kind }) {
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  if (total === 0) return <div className="text-sm text-slate-500 p-8 text-center">No data.</div>;
  let acc = 0;
  return (
    <div className="flex items-center gap-6 justify-center py-4">
      <svg viewBox="0 0 200 200" width="220" height="220">
        {rows.map((r, i) => {
          const v = r.value || 0;
          const start = (acc / total) * 360;
          acc += v;
          const end = (acc / total) * 360;
          const large = end - start > 180 ? 1 : 0;
          const x1 = 100 + 80 * Math.cos((start - 90) * Math.PI / 180);
          const y1 = 100 + 80 * Math.sin((start - 90) * Math.PI / 180);
          const x2 = 100 + 80 * Math.cos((end - 90) * Math.PI / 180);
          const y2 = 100 + 80 * Math.sin((end - 90) * Math.PI / 180);
          return (
            <path key={i}
                  d={`M 100 100 L ${x1} ${y1} A 80 80 0 ${large} 1 ${x2} ${y2} Z`}
                  fill={COLOR_PALETTE[i % COLOR_PALETTE.length]}
                  stroke="#fff" strokeWidth="1" />
          );
        })}
        <circle cx="100" cy="100" r="42" fill="#fff" />
      </svg>
      <div className="space-y-1 text-xs">
        {rows.map((r, i) => (
          <div key={r.key_x} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: COLOR_PALETTE[i % COLOR_PALETTE.length] }} />
            <span className="truncate max-w-[180px]">{r.label_x}</span>
            <span className="ml-auto tabular-nums text-slate-600">{fmtVal(kind, r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ rows, kind }) {
  if (rows.length < 2) return <div className="text-sm text-slate-500 p-8 text-center">Line chart requires at least 2 points.</div>;
  const W = 600, H = 220, PAD = 32;
  const max = Math.max(...rows.map(r => r.value || 0));
  const min = 0;
  const xFor = (i) => PAD + (i / (rows.length - 1)) * (W - PAD * 2);
  const yFor = (v) => H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);
  const points = rows.map((r, i) => `${xFor(i)},${yFor(r.value || 0)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="border rounded-md bg-white">
      <polyline fill="none" stroke="#0e7c6b" strokeWidth="2" points={points.join(' ')} />
      {rows.map((r, i) => (
        <g key={r.key_x}>
          <circle cx={xFor(i)} cy={yFor(r.value || 0)} r="3" fill="#0e7c6b" />
          <text x={xFor(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="#64748b">
            {String(r.label_x).slice(0, 8)}
          </text>
          <text x={xFor(i)} y={yFor(r.value || 0) - 8} fontSize="9" textAnchor="middle" fill="#0f172a">
            {fmtVal(kind, r.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Single-dim renderer with viz picker
function ResultPanel({ result, viz, metricKind, deltaByKey }) {
  const cfg = result.config;
  const rows = (result.rows || []).filter(r => !r._is_total);
  const totalRow = (result.rows || []).find(r => r._is_total);
  if (rows.length === 0) return <div className="text-sm text-slate-500 p-8 text-center">No data for this configuration.</div>;
  const max = Math.max(...rows.map(r => r.value || 0));
  const showExtras = ['mttr', 'backlog_age', 'avg_approval_lag'].includes(cfg.metric);

  let chart = null;
  if (viz === 'bar') {
    chart = (
      <div className="space-y-2">
        {rows.slice(0, 12).map((r, i) => (
          <BarRow key={r.key_x} label={r.label_x} value={r.value} max={max}
                  kind={metricKind} color={COLOR_PALETTE[i % COLOR_PALETTE.length]}
                  isOther={r._is_other} />
        ))}
        {totalRow && <BarRow label={totalRow.label_x} value={totalRow.value} max={max}
                              kind={metricKind} color="#0f172a" isTotal />}
      </div>
    );
  } else if (viz === 'donut') {
    chart = <DonutChart rows={rows.slice(0, 10)} kind={metricKind} />;
  } else if (viz === 'line') {
    chart = <LineChart rows={rows} kind={metricKind} />;
  }

  return (
    <div className="space-y-4">
      {chart}
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Group</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
              <th className="px-3 py-2 text-right font-semibold">n</th>
              {deltaByKey && <th className="px-3 py-2 text-right font-semibold">Δ vs prev</th>}
              {showExtras && <>
                <th className="px-3 py-2 text-right font-semibold">p25</th>
                <th className="px-3 py-2 text-right font-semibold">p75</th>
                <th className="px-3 py-2 text-right font-semibold">p90</th>
                <th className="px-3 py-2 text-right font-semibold">p99</th>
                <th className="px-3 py-2 text-right font-semibold">Mean</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = deltaByKey ? deltaByKey[r.key_x] : null;
              const delta = (prev != null && r.value != null) ? +(r.value - prev).toFixed(1) : null;
              return (
                <tr key={r.key_x}
                    className={`${i % 2 ? 'bg-slate-50/40' : ''} ${r._is_other ? 'italic text-slate-500' : ''}`}
                    data-testid={`builder-row-${i}`}>
                  <td className="px-3 py-2">{r.label_x}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtVal(metricKind, r.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.n}</td>
                  {deltaByKey && <td className={`px-3 py-2 text-right tabular-nums ${delta == null ? 'text-slate-300' : delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-slate-500'}`}>
                    {delta == null ? '—' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} ${Math.abs(delta)}`}
                  </td>}
                  {showExtras && <>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, r.p25)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, r.p75)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, r.p90)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, r.p99)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, r.mean)}</td>
                  </>}
                </tr>
              );
            })}
            {totalRow && <tr className="border-t-2 font-semibold bg-slate-50">
              <td className="px-3 py-2">{totalRow.label_x}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtVal(metricKind, totalRow.value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totalRow.n}</td>
              {deltaByKey && <td />}
              {showExtras && <td colSpan={5} />}
            </tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HeatmapTable({ result, metricKind }) {
  const { row_keys = [], row_labels = [], col_keys = [], col_labels = [], matrix = [] } = result;
  if (row_keys.length === 0 || col_keys.length === 0) {
    return <div className="text-sm text-slate-500 p-8 text-center">No data for this configuration.</div>;
  }
  const allValues = matrix.flat().map(c => c.value).filter(v => v != null);
  const max = Math.max(0, ...allValues);
  return (
    <div className="overflow-auto rounded-lg border">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 z-10">
          <tr>
            <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-slate-50 z-20">↘</th>
            {col_labels.map((cl, i) => (
              <th key={col_keys[i]} className="px-3 py-2 text-center font-semibold whitespace-nowrap">{cl}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row_keys.map((rk, ridx) => (
            <tr key={rk} data-testid={`builder-heatmap-row-${ridx}`}>
              <td className="px-3 py-2 font-medium sticky left-0 bg-white z-10 border-r">{row_labels[ridx]}</td>
              {matrix[ridx].map((cell, cidx) => (
                <td key={col_keys[cidx]}
                    className="px-3 py-2 text-center tabular-nums"
                    style={{ background: heatColor(cell.value, max) }}
                    title={`n=${cell.n}${cell._n_below_threshold ? ' (below threshold)' : ''}`}>
                  {cell.value == null ? (cell._n_below_threshold ? '–' : '·') : fmtVal(metricKind, cell.value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Composer (the big form) ──────────────────────────────────────────────
function Composer({ meta, cfg, setCfg, running, onRun, onSave, saveName, setSaveName, viz }) {
  const isCrossTab = Boolean(cfg.dim_y);
  const setF = (k, v) => setCfg({ ...cfg, filters: { ...cfg.filters, [k]: v } });
  const setO = (k, v) => setCfg({ ...cfg, output: { ...cfg.output, [k]: v } });
  const setA = (k, v) => setCfg({ ...cfg, annotations: { ...cfg.annotations, [k]: v } });
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-teal-700" /> Compose Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Row 1: Metric / Dim X / Dim Y / Window */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Metric"><Select value={cfg.metric} onValueChange={(v) => setCfg({ ...cfg, metric: v })}>
            <SelectTrigger data-testid="builder-metric-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{meta.metrics.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select></Field>
          <Field label="Group by (X)"><Select value={cfg.dim_x} onValueChange={(v) => setCfg({ ...cfg, dim_x: v })}>
            <SelectTrigger data-testid="builder-dimx-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{meta.dimensions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select></Field>
          <Field label="Cross by (Y)"><Select value={cfg.dim_y || '__none__'} onValueChange={(v) => setCfg({ ...cfg, dim_y: v === '__none__' ? '' : v })}>
            <SelectTrigger data-testid="builder-dimy-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {meta.dimensions.filter(d => d.id !== cfg.dim_x).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select></Field>
          <Field label="Window"><Select value={cfg.window} onValueChange={(v) => setCfg({ ...cfg, window: v })}>
            <SelectTrigger data-testid="builder-window-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{meta.windows.filter(w => w.id !== 'custom').map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select></Field>
        </div>

        {/* Filters (always visible) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-md border">
          <FilterMulti label="Stations" options={meta.stations} selected={cfg.filters.station_ids}
                       onChange={(ids) => setF('station_ids', ids)} testid="filter-stations" />
          <FilterMulti label="Departments" options={meta.departments} selected={cfg.filters.dept_ids}
                       onChange={(ids) => setF('dept_ids', ids)} testid="filter-depts" />
          <FilterMulti label="Asset Types" options={meta.asset_types} selected={cfg.filters.asset_type_ids}
                       onChange={(ids) => setF('asset_type_ids', ids)} testid="filter-asset-types" />
        </div>

        {/* Toggle for advanced controls */}
        <button type="button" onClick={() => setShowAdvanced(s => !s)}
                className="text-xs text-teal-700 font-medium flex items-center gap-1 hover:underline"
                data-testid="builder-toggle-advanced">
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAdvanced ? 'Hide' : 'Show'} advanced options (filters · output · viz · annotations)
        </button>

        {showAdvanced && (
          <div className="space-y-4 p-3 border-2 border-dashed border-slate-200 rounded-md">
            {/* Layer 3: more filters */}
            <div>
              <div className="text-xs font-bold text-slate-700 uppercase mb-2">Filters</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FilterMulti label="Asset Status" options={(meta.asset_statuses || []).map(s => ({ id: s, name: s }))}
                             selected={cfg.filters.asset_statuses} onChange={(ids) => setF('asset_statuses', ids)} testid="filter-statuses" />
                <FilterMulti label="List Types" options={(meta.list_types || []).map(s => ({ id: s, name: s.toUpperCase() }))}
                             selected={cfg.filters.list_types} onChange={(ids) => setF('list_types', ids)} testid="filter-list-types" />
                <Field label="Repair cap (hrs)">
                  <Input type="number" min="0" placeholder="No cap"
                         value={cfg.filters.repair_cap_hours ?? ''}
                         onChange={(e) => setF('repair_cap_hours', e.target.value ? Number(e.target.value) : null)}
                         data-testid="filter-repair-cap" />
                </Field>
                <Field label="Recurrence within (days)">
                  <Input type="number" min="1"
                         value={cfg.filters.recurrence_within_days ?? 30}
                         onChange={(e) => setF('recurrence_within_days', Number(e.target.value))} />
                </Field>
                <Field label="Hour from (0-23)">
                  <Input type="number" min="0" max="23" placeholder="—"
                         value={cfg.filters.hour_from ?? ''}
                         onChange={(e) => setF('hour_from', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
                <Field label="Hour to (0-23)">
                  <Input type="number" min="0" max="23" placeholder="—"
                         value={cfg.filters.hour_to ?? ''}
                         onChange={(e) => setF('hour_to', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
                <Field label="Include rejected in MTTR">
                  <div className="flex items-center h-10"><Switch checked={cfg.filters.include_rejected_in_mttr}
                                  onCheckedChange={(v) => setF('include_rejected_in_mttr', v)} /></div>
                </Field>
                <Field label="Compare to previous period">
                  <div className="flex items-center h-10"><Switch checked={cfg.compare_to_previous}
                                  onCheckedChange={(v) => setCfg({ ...cfg, compare_to_previous: v })}
                                  data-testid="filter-compare-toggle" /></div>
                </Field>
              </div>
            </div>

            {/* Layer 4: output controls */}
            <div>
              <div className="text-xs font-bold text-slate-700 uppercase mb-2">Output controls</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Sort by">
                  <Select value={cfg.output.sort_by || 'value'} onValueChange={(v) => setO('sort_by', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">Value</SelectItem>
                      <SelectItem value="label">Label (alphabetical)</SelectItem>
                      <SelectItem value="n">Sample size (n)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Direction">
                  <Select value={cfg.output.sort_dir || 'desc'} onValueChange={(v) => setO('sort_dir', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desc">Descending</SelectItem>
                      <SelectItem value="asc">Ascending</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Top N (rows)">
                  <Input type="number" min="1" placeholder="All"
                         value={cfg.output.top_n ?? ''}
                         onChange={(e) => setO('top_n', e.target.value ? Number(e.target.value) : null)} />
                </Field>
                <Field label="Bucket 'Other' after">
                  <Input type="number" min="2" placeholder="—"
                         value={cfg.output.bucket_other_after ?? ''}
                         onChange={(e) => setO('bucket_other_after', e.target.value ? Number(e.target.value) : null)} />
                </Field>
                <Field label="Min n (grey out below)">
                  <Input type="number" min="0" value={cfg.output.n_threshold ?? 0}
                         onChange={(e) => setO('n_threshold', Number(e.target.value || 0))} />
                </Field>
                <Field label="Show totals row">
                  <div className="flex items-center h-10"><Switch checked={cfg.output.totals_row || false}
                                  onCheckedChange={(v) => setO('totals_row', v)} /></div>
                </Field>
                <Field label="Visualisation">
                  <Select value={cfg.viz || 'bar'} onValueChange={(v) => setCfg({ ...cfg, viz: v })}>
                    <SelectTrigger data-testid="builder-viz-trigger"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bar">Bar chart</SelectItem>
                      <SelectItem value="donut">Donut</SelectItem>
                      <SelectItem value="line">Line</SelectItem>
                      <SelectItem value="table">Table only</SelectItem>
                      {isCrossTab && <SelectItem value="heatmap">Heatmap</SelectItem>}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            {/* Layer 4: annotations */}
            <div>
              <div className="text-xs font-bold text-slate-700 uppercase mb-2">Annotations (carried into PDF)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Title (overrides metric label)">
                  <Input value={cfg.annotations?.title || ''} onChange={(e) => setA('title', e.target.value)} />
                </Field>
                <Field label="Subtitle">
                  <Input value={cfg.annotations?.subtitle || ''} onChange={(e) => setA('subtitle', e.target.value)} />
                </Field>
                <div className="md:col-span-2"><Field label="Note (sticky observation)">
                  <Textarea rows={2} value={cfg.annotations?.note || ''}
                            onChange={(e) => setA('note', e.target.value)}
                            placeholder="e.g. Spike here was the AC vendor strike (14 Mar)" />
                </Field></div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            <Input placeholder="Save as name…" value={saveName} className="inline-block w-44 mr-1 text-xs h-8"
                   onChange={(e) => setSaveName(e.target.value)} data-testid="builder-save-name" />
            <Button size="sm" variant="outline" onClick={onSave} data-testid="builder-save-btn"
                    className="h-8"><Save className="h-3 w-3 mr-1" /> Save</Button>
          </div>
          <Button onClick={onRun} disabled={running} data-testid="builder-run-btn">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }) {
  return <div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>;
}

function FilterMulti({ label, options, selected = [], onChange, testid }) {
  const [openMenu, setOpenMenu] = useState(false);
  const sel = new Set(selected || []);
  const summary = sel.size === 0 ? 'All' :
                  sel.size === 1 ? options.find(o => sel.has(o.id))?.name :
                  `${sel.size} selected`;
  return (
    <div className="relative">
      <Label className="text-xs">{label}</Label>
      <button type="button" data-testid={`${testid}-trigger`}
              onClick={() => setOpenMenu(o => !o)}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-white text-left text-sm flex justify-between items-center">
        <span className="truncate">{summary}</span>
        <span className="text-slate-400 text-xs">{sel.size > 0 ? `${sel.size}/${options.length}` : 'All'}</span>
      </button>
      {openMenu && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-64 overflow-y-auto bg-white border rounded-md shadow-lg p-2">
          <button className="w-full text-left text-xs text-teal-700 px-2 py-1 hover:bg-slate-50 rounded"
                  onClick={() => onChange([])}>Clear all</button>
          {options.map((o) => {
            const on = sel.has(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => {
                  const next = new Set(selected || []);
                  if (on) next.delete(o.id); else next.add(o.id);
                  onChange(Array.from(next));
                }} />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main Builder
// ════════════════════════════════════════════════════════════════════════════
export default function ReportsBuilder() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [saved, setSaved] = useState([]);
  const [history, setHistory] = useState([]);
  const [savedDossiers, setSavedDossiers] = useState([]);

  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [saveName, setSaveName] = useState('');

  // Dossier mode state
  const [dossier, setDossier] = useState({ title: 'Custom Dossier', subtitle: '',
    cover: { prepared_for: '', prepared_by: '', footer: '' }, sections: [] });
  const [dossierSaveName, setDossierSaveName] = useState('');

  const isCrossTab = useMemo(() => Boolean(cfg.dim_y), [cfg.dim_y]);
  const isSA = user?.role === 'superadmin';
  const metricKind = useMemo(() => {
    if (!meta) return 'count';
    return meta.metrics.find(m => m.id === cfg.metric)?.kind || 'count';
  }, [meta, cfg.metric]);

  useEffect(() => {
    if (!isSA) return;
    Promise.all([
      axios.get(`${BACKEND}/api/reports/builder/dimensions/${user._id}`),
      axios.get(`${BACKEND}/api/reports/builder/featured`),
      axios.get(`${BACKEND}/api/reports/builder/saved/${user._id}`),
      axios.get(`${BACKEND}/api/reports/builder/runs/${user._id}?limit=20`),
      axios.get(`${BACKEND}/api/reports/builder/dossier/saved/${user._id}`),
    ]).then(([m, f, s, h, sd]) => {
      setMeta(m.data); setFeatured(f.data); setSaved(s.data); setHistory(h.data); setSavedDossiers(sd.data);
    }).catch(() => toast.error('Failed to load builder metadata'));
  }, [isSA, user]);

  useEffect(() => {
    if (meta && !result) runConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const runConfig = async (override = null) => {
    const body = override || cfg;
    setRunning(true);
    try {
      const r = await axios.post(`${BACKEND}/api/reports/builder/run/${user._id}`, body);
      setResult(r.data);
      // Refresh history
      const h = await axios.get(`${BACKEND}/api/reports/builder/runs/${user._id}?limit=20`);
      setHistory(h.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const applyCfg = (newCfg) => {
    const merged = { ...DEFAULT_CFG, ...newCfg,
      filters: { ...DEFAULT_CFG.filters, ...(newCfg.filters || {}) },
      output:  { ...DEFAULT_CFG.output,  ...(newCfg.output  || {}) },
      annotations: { ...DEFAULT_CFG.annotations, ...(newCfg.annotations || {}) } };
    setCfg(merged);
    runConfig(merged);
  };

  const saveCurrent = async () => {
    if (!saveName.trim()) { toast.error('Enter a name'); return; }
    try {
      const r = await axios.post(`${BACKEND}/api/reports/builder/save/${user._id}`,
                                 { name: saveName.trim(), config: cfg });
      setSaved((s) => [r.data, ...s]); setSaveName('');
      toast.success('Saved');
    } catch { toast.error('Save failed'); }
  };

  const deleteSaved = async (id) => {
    try {
      await axios.delete(`${BACKEND}/api/reports/builder/saved/${id}/${user._id}`);
      setSaved((s) => s.filter((x) => x._id !== id));
    } catch { toast.error('Delete failed'); }
  };

  const exportNow = (fmt) => {
    const ts = Date.now();
    _download(`${BACKEND}/api/reports/builder/export/${fmt}/${user._id}`, cfg,
              `builder-${cfg.metric}-${ts}.${fmt === 'excel' ? 'xlsx' : fmt}`);
  };

  // Build delta-by-key from compare_to.result.rows
  const deltaByKey = useMemo(() => {
    if (!result?.compare_to?.result?.rows) return null;
    const map = {};
    result.compare_to.result.rows.forEach(r => { map[r.key_x] = r.value; });
    return map;
  }, [result]);

  // ─── Dossier handlers ───────────────────────────────────────────────────
  const addCurrentToDossier = () => {
    setDossier(d => ({ ...d, sections: [...d.sections,
      { title: cfg.annotations?.title || `Section ${d.sections.length + 1}`, config: { ...cfg } }] }));
    toast.success('Added section to dossier');
  };
  const removeSection = (idx) => setDossier(d => ({ ...d, sections: d.sections.filter((_, i) => i !== idx) }));
  const moveSection = (idx, dir) => {
    setDossier(d => {
      const arr = [...d.sections];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...d, sections: arr };
    });
  };
  const exportDossier = (fmt) => {
    if (dossier.sections.length === 0) { toast.error('Add at least one section'); return; }
    _download(`${BACKEND}/api/reports/builder/dossier/export/${fmt}/${user._id}`, dossier,
              `dossier-${Date.now()}.${fmt === 'excel' ? 'xlsx' : fmt}`);
  };
  const saveDossier = async () => {
    if (!dossierSaveName.trim()) { toast.error('Enter dossier name'); return; }
    try {
      const r = await axios.post(`${BACKEND}/api/reports/builder/dossier/save/${user._id}`,
                                 { name: dossierSaveName.trim(), dossier });
      setSavedDossiers(s => [r.data, ...s]); setDossierSaveName('');
      toast.success('Dossier saved');
    } catch { toast.error('Save failed'); }
  };
  const deleteDossier = async (id) => {
    try {
      await axios.delete(`${BACKEND}/api/reports/builder/dossier/saved/${id}/${user._id}`);
      setSavedDossiers(s => s.filter(x => x._id !== id));
    } catch { toast.error('Delete failed'); }
  };

  if (!isSA) return <div className="p-8 text-center text-slate-500">Builder is available to Super Admin only.</div>;
  if (!meta) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-teal-700" /></div>;

  return (
    <div data-testid="reports-builder-root" className="space-y-4">
      <Tabs defaultValue="single" className="space-y-4">
        <TabsList>
          <TabsTrigger value="single" data-testid="tab-single"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />Single Report</TabsTrigger>
          <TabsTrigger value="dossier" data-testid="tab-dossier"><BookText className="h-3.5 w-3.5 mr-1.5" />Dossier ({dossier.sections.length})</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="h-3.5 w-3.5 mr-1.5" />History</TabsTrigger>
        </TabsList>

        {/* ── Single Report ── */}
        <TabsContent value="single">
          <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr_230px] gap-4">
            {/* Featured */}
            <Card className="self-start">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" /> Featured
              </CardTitle></CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {featured.map(f => (
                  <button key={f.id} onClick={() => applyCfg(f.config)} data-testid={`featured-${f.id}`}
                          className="w-full text-left p-2 rounded-md border border-slate-200 hover:border-teal-400 hover:bg-teal-50 transition text-xs">
                    <div className="font-semibold text-slate-800">{f.name}</div>
                    <div className="text-slate-500 text-[10px] mt-0.5 line-clamp-2">{f.description}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Centre */}
            <div className="space-y-4">
              <Composer meta={meta} cfg={cfg} setCfg={setCfg} running={running}
                        onRun={() => runConfig()} onSave={saveCurrent}
                        saveName={saveName} setSaveName={setSaveName}
                        viz={cfg.viz || 'bar'} />
              <Card data-testid="builder-result">
                <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {result?.config?.annotations?.title || (isCrossTab ? 'Cross-tab Heatmap' : 'Result')}
                    {result?.compare_to && <span className="text-[10px] font-normal text-slate-500 ml-2">vs prev period</span>}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={addCurrentToDossier} data-testid="builder-add-to-dossier">
                      <Plus className="h-4 w-4 mr-1" /> Add to Dossier
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportNow('csv')} data-testid="builder-export-csv">
                      <FileType className="h-4 w-4 mr-1" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportNow('excel')} data-testid="builder-export-excel">
                      <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => exportNow('pdf')} data-testid="builder-export-pdf">
                      <FileDown className="h-4 w-4 mr-1" /> PDF
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {result?.config?.annotations?.subtitle && <p className="text-xs text-slate-500 mb-3">{result.config.annotations.subtitle}</p>}
                  {result?.config?.annotations?.note && <p className="text-xs italic bg-amber-50 border-l-2 border-amber-400 p-2 mb-3">{result.config.annotations.note}</p>}
                  {running && <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-teal-700" /></div>}
                  {!running && result && (
                    isCrossTab
                      ? <HeatmapTable result={result} metricKind={metricKind} />
                      : <ResultPanel result={result} viz={cfg.viz || 'bar'} metricKind={metricKind} deltaByKey={deltaByKey} />
                  )}
                  {result && <div className="text-[10px] text-slate-400 mt-3 text-right">
                    Asset pool: {result.asset_pool_size} · Events: {result.event_count} · Generated {new Date(result.generated_at).toLocaleString()}
                  </div>}
                </CardContent>
              </Card>
            </div>

            {/* Saved */}
            <Card className="self-start">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" /> Saved
              </CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-0">
                {saved.length === 0 && <div className="text-[11px] text-slate-400 text-center py-4">None saved</div>}
                {saved.map(s => (
                  <div key={s._id} data-testid={`saved-${s._id}`}
                       className="p-2 rounded-md border border-slate-200 hover:border-teal-400 transition text-xs flex items-start gap-1">
                    <button onClick={() => applyCfg(s.config)} className="flex-1 text-left">
                      <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                      <div className="text-slate-500 text-[10px] mt-0.5 truncate">
                        {s.config.metric} · {s.config.dim_x}{s.config.dim_y ? ` × ${s.config.dim_y}` : ''} · {s.config.window}
                      </div>
                    </button>
                    <button onClick={() => deleteSaved(s._id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Dossier mode ── */}
        <TabsContent value="dossier">
          <DossierEditor dossier={dossier} setDossier={setDossier}
                         removeSection={removeSection} moveSection={moveSection}
                         exportDossier={exportDossier} saveDossier={saveDossier}
                         dossierSaveName={dossierSaveName} setDossierSaveName={setDossierSaveName}
                         savedDossiers={savedDossiers}
                         loadDossier={(d) => setDossier(d)}
                         deleteDossier={deleteDossier} />
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent runs (last 20)</CardTitle></CardHeader>
            <CardContent>
              {history.length === 0 && <p className="text-sm text-slate-500">No runs yet.</p>}
              <div className="space-y-1.5">
                {history.map(h => (
                  <button key={h._id} onClick={() => applyCfg(h.config)}
                          className="w-full p-3 text-left rounded-md border hover:border-teal-400 hover:bg-teal-50 transition text-xs flex items-center gap-3"
                          data-testid={`history-${h._id}`}>
                    <div className="text-[10px] text-slate-400 tabular-nums w-32">{h.created_at?.slice(0, 19).replace('T', ' ')}</div>
                    <div className="flex-1">
                      <div className="font-semibold">{h.config.metric} · {h.config.dim_x}{h.config.dim_y ? ` × ${h.config.dim_y}` : ''}</div>
                      <div className="text-slate-500">{h.config.window} · {h.row_count} row(s) · {h.event_count} event(s)</div>
                    </div>
                    <Play className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Dossier editor ──────────────────────────────────────────────────────
function DossierEditor({ dossier, setDossier, removeSection, moveSection,
                         exportDossier, saveDossier, dossierSaveName, setDossierSaveName,
                         savedDossiers, loadDossier, deleteDossier }) {
  const setMeta = (k, v) => setDossier(d => ({ ...d, [k]: v }));
  const setCover = (k, v) => setDossier(d => ({ ...d, cover: { ...(d.cover || {}), [k]: v } }));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2">
            <BookText className="h-4 w-4 text-teal-700" /> Dossier · cover
          </CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Title"><Input value={dossier.title} onChange={(e) => setMeta('title', e.target.value)} data-testid="dossier-title" /></Field>
            <Field label="Subtitle"><Input value={dossier.subtitle || ''} onChange={(e) => setMeta('subtitle', e.target.value)} /></Field>
            <Field label="Prepared for"><Input value={dossier.cover?.prepared_for || ''} onChange={(e) => setCover('prepared_for', e.target.value)} /></Field>
            <Field label="Prepared by"><Input value={dossier.cover?.prepared_by || ''} onChange={(e) => setCover('prepared_by', e.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Footer">
              <Textarea rows={2} value={dossier.cover?.footer || ''} onChange={(e) => setCover('footer', e.target.value)} />
            </Field></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Sections ({dossier.sections.length})</CardTitle>
            <div className="flex gap-2">
              <Input placeholder="Save as…" value={dossierSaveName} className="text-xs h-8 w-40"
                     onChange={(e) => setDossierSaveName(e.target.value)} />
              <Button size="sm" variant="outline" onClick={saveDossier} data-testid="dossier-save-btn">
                <Save className="h-3.5 w-3.5 mr-1" />Save dossier
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportDossier('pdf')} data-testid="dossier-export-pdf">
                <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportDossier('excel')} data-testid="dossier-export-excel">
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {dossier.sections.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">
                Build a single report (Single Report tab) and click <b>"Add to Dossier"</b> to grow this list.
              </p>
            )}
            <div className="space-y-2">
              {dossier.sections.map((s, idx) => (
                <div key={idx} className="p-3 border rounded-md flex items-center gap-2"
                     data-testid={`dossier-section-${idx}`}>
                  <span className="text-xs font-semibold text-slate-400 w-6">{idx + 1}.</span>
                  <Input value={s.title} onChange={(e) => {
                    const arr = [...dossier.sections]; arr[idx].title = e.target.value;
                    setDossier(d => ({ ...d, sections: arr }));
                  }} className="text-sm h-8 flex-1" />
                  <span className="text-[10px] text-slate-500 truncate max-w-[260px]">
                    {s.config.metric} · {s.config.dim_x}{s.config.dim_y ? ` × ${s.config.dim_y}` : ''} · {s.config.window}
                  </span>
                  <Button size="icon" variant="ghost" onClick={() => moveSection(idx, -1)} className="h-7 w-7"><ChevronUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => moveSection(idx, 1)} className="h-7 w-7"><ChevronDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => removeSection(idx)} className="h-7 w-7 text-red-600"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" /> Saved dossiers
        </CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {savedDossiers.length === 0 && <div className="text-[11px] text-slate-400 text-center py-4">None saved</div>}
          {savedDossiers.map(d => (
            <div key={d._id} className="p-2 rounded-md border border-slate-200 hover:border-teal-400 transition text-xs flex items-start gap-1"
                 data-testid={`saved-dossier-${d._id}`}>
              <button onClick={() => loadDossier(d.dossier)} className="flex-1 text-left">
                <div className="font-semibold text-slate-800 truncate">{d.name}</div>
                <div className="text-slate-500 text-[10px] mt-0.5 truncate">
                  {d.dossier.sections?.length || 0} section(s)
                </div>
              </button>
              <button onClick={() => deleteDossier(d._id)} className="text-slate-400 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
