/**
 * Reports Builder — Superadmin-only dynamic report composer.
 *
 * Layout (single page, three columns on desktop, stacked on mobile):
 *   ┌─ left ────┐  ┌─ centre ─────────────────────────┐  ┌─ right ───┐
 *   │ Featured  │  │ Metric · Dim X · Dim Y · Window  │  │ Saved     │
 *   │ library   │  │ ───────────────────────────────  │  │ reports   │
 *   │ (8 cards) │  │ Filters: stations / depts / ...  │  │           │
 *   │           │  │ [Run]                            │  │ Save btn  │
 *   │           │  │ ───────────────────────────────  │  │           │
 *   │           │  │ <Result table or matrix>         │  │           │
 *   │           │  │ <Bar / Heatmap chart>            │  │           │
 *   │           │  │ [Export CSV / Excel / PDF]       │  │           │
 *   └───────────┘  └──────────────────────────────────┘  └───────────┘
 */
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Loader2, FileDown, FileSpreadsheet, Save, Trash2, Star, Sparkles,
  BarChart3, Play, FileType,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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

const DIM_X_NONE = 'station';
const DEFAULT_CFG = {
  metric: 'pct_working',
  dim_x: DIM_X_NONE,
  dim_y: '',
  window: 'last_30d',
  filters: { station_ids: [], dept_ids: [], asset_type_ids: [] },
};

const COLOR_PALETTE = ['#0e7c6b', '#0891b2', '#7c3aed', '#dc2626', '#f59e0b',
                       '#10b981', '#3b82f6', '#ec4899', '#84cc16', '#f97316'];

function fmtVal(metric, value) {
  if (value == null) return '—';
  if (metric === 'pct_working' || metric === 'rejection_rate') return `${value}%`;
  if (metric === 'mttr') return `${value} hrs`;
  return value.toLocaleString();
}

// Heatmap cell color: scale 0 → 1 → red intensity
function heatColor(value, max) {
  if (value == null || max <= 0) return '#f8fafc';
  const t = Math.min(1, value / max);
  const r = Math.round(254 - (254 - 220) * t);
  const g = Math.round(243 - (243 - 38) * t);
  const b = Math.round(199 - (199 - 38) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── BarRow ─ horizontal bar with label ───────────────────────────────────
function BarRow({ label, value, max, metric, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[160px_1fr_80px] items-center gap-3 text-sm">
      <div className="truncate font-medium text-slate-700" title={label}>{label}</div>
      <div className="h-5 bg-slate-100 rounded overflow-hidden">
        <div className="h-full transition-all"
             style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-right text-slate-600 tabular-nums">{fmtVal(metric, value)}</div>
    </div>
  );
}

// ─── ResultTable (single dim) ─────────────────────────────────────────────
function ResultTable({ result }) {
  const cfg = result.config;
  const rows = result.rows || [];
  if (rows.length === 0) return <div className="text-sm text-slate-500 p-8 text-center">No data for this configuration.</div>;
  const max = Math.max(...rows.map(r => r.value || 0));
  const showExtras = cfg.metric === 'mttr';
  return (
    <div className="space-y-4">
      {/* Bar chart */}
      <div className="space-y-2">
        {rows.slice(0, 12).map((r, i) => (
          <BarRow key={r.key_x} label={r.label_x} value={r.value} max={max}
                  metric={cfg.metric} color={COLOR_PALETTE[i % COLOR_PALETTE.length]} />
        ))}
      </div>
      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Group</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
              <th className="px-3 py-2 text-right font-semibold">n</th>
              {showExtras && <>
                <th className="px-3 py-2 text-right font-semibold">p75</th>
                <th className="px-3 py-2 text-right font-semibold">p90</th>
                <th className="px-3 py-2 text-right font-semibold">Mean</th>
                <th className="px-3 py-2 text-right font-semibold">Min</th>
                <th className="px-3 py-2 text-right font-semibold">Max</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key_x} className={i % 2 ? 'bg-slate-50/40' : ''} data-testid={`builder-row-${i}`}>
                <td className="px-3 py-2">{r.label_x}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtVal(cfg.metric, r.value)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.n}</td>
                {showExtras && <>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(cfg.metric, r.p75)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(cfg.metric, r.p90)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(cfg.metric, r.mean)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(cfg.metric, r.min)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(cfg.metric, r.max)}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Heatmap (cross-tab) ──────────────────────────────────────────────────
function HeatmapTable({ result }) {
  const { row_keys = [], row_labels = [], col_keys = [], col_labels = [], matrix = [] } = result;
  if (row_keys.length === 0 || col_keys.length === 0) {
    return <div className="text-sm text-slate-500 p-8 text-center">No data for this configuration.</div>;
  }
  const allValues = matrix.flat().map(c => c.value).filter(v => v != null);
  const max = Math.max(0, ...allValues);
  const metric = result.config.metric;
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
                    title={`n=${cell.n}`}>
                  {cell.value == null ? '·' : fmtVal(metric, cell.value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Builder component ───────────────────────────────────────────────
export default function ReportsBuilder() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [featured, setFeatured] = useState([]);
  const [saved, setSaved] = useState([]);

  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const [saveName, setSaveName] = useState('');

  const isCrossTab = useMemo(() => Boolean(cfg.dim_y), [cfg.dim_y]);
  const isSA = user?.role === 'superadmin';

  // Load metadata + featured + saved
  useEffect(() => {
    if (!isSA) return;
    Promise.all([
      axios.get(`${BACKEND}/api/reports/builder/dimensions/${user._id}`),
      axios.get(`${BACKEND}/api/reports/builder/featured`),
      axios.get(`${BACKEND}/api/reports/builder/saved/${user._id}`),
    ]).then(([m, f, s]) => {
      setMeta(m.data); setFeatured(f.data); setSaved(s.data);
    }).catch(() => toast.error('Failed to load builder metadata'));
  }, [isSA, user]);

  // Auto-run on first load with the default config
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const applyFeatured = (f) => {
    const newCfg = { ...DEFAULT_CFG, ...f.config,
                     filters: { ...DEFAULT_CFG.filters, ...(f.config.filters || {}) } };
    setCfg(newCfg);
    runConfig(newCfg);
  };

  const applySaved = (s) => {
    const newCfg = { ...DEFAULT_CFG, ...s.config,
                     filters: { ...DEFAULT_CFG.filters, ...(s.config.filters || {}) } };
    setCfg(newCfg);
    runConfig(newCfg);
  };

  const saveCurrent = async () => {
    if (!saveName.trim()) { toast.error('Enter a name'); return; }
    try {
      const r = await axios.post(`${BACKEND}/api/reports/builder/save/${user._id}`,
                                 { name: saveName.trim(), config: cfg });
      setSaved((s) => [r.data, ...s]);
      setSaveName('');
      toast.success('Saved');
    } catch (e) {
      toast.error('Save failed');
    }
  };

  const deleteSaved = async (id) => {
    try {
      await axios.delete(`${BACKEND}/api/reports/builder/saved/${id}/${user._id}`);
      setSaved((s) => s.filter((x) => x._id !== id));
      toast.success('Deleted');
    } catch (e) { toast.error('Delete failed'); }
  };

  const exportNow = (fmt) => {
    const ts = Date.now();
    _download(`${BACKEND}/api/reports/builder/export/${fmt}/${user._id}`, cfg,
              `builder-${cfg.metric}-${ts}.${fmt === 'excel' ? 'xlsx' : fmt}`);
  };

  if (!isSA) {
    return <div className="p-8 text-center text-slate-500">Builder is available to Super Admin only.</div>;
  }
  if (!meta) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-teal-700" /></div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_260px] gap-4" data-testid="reports-builder-root">
      {/* ── Left: Featured library ── */}
      <Card className="self-start">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> Featured
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0">
          {featured.map((f) => (
            <button
              key={f.id}
              onClick={() => applyFeatured(f)}
              data-testid={`featured-${f.id}`}
              className="w-full text-left p-2 rounded-md border border-slate-200 hover:border-teal-400 hover:bg-teal-50 transition text-xs"
            >
              <div className="font-semibold text-slate-800">{f.name}</div>
              <div className="text-slate-500 text-[10px] mt-0.5 line-clamp-2">{f.description}</div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* ── Centre: Composer + Result ── */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-teal-700" /> Compose Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Row 1: Metric / Dim X / Dim Y / Window */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Metric</Label>
                <Select value={cfg.metric} onValueChange={(v) => setCfg({ ...cfg, metric: v })}>
                  <SelectTrigger data-testid="builder-metric-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.metrics.map(m => <SelectItem key={m.id} value={m.id} data-testid={`builder-metric-${m.id}`}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Group by (X)</Label>
                <Select value={cfg.dim_x} onValueChange={(v) => setCfg({ ...cfg, dim_x: v })}>
                  <SelectTrigger data-testid="builder-dimx-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.dimensions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Cross by (Y)</Label>
                <Select value={cfg.dim_y || '__none__'}
                        onValueChange={(v) => setCfg({ ...cfg, dim_y: v === '__none__' ? '' : v })}>
                  <SelectTrigger data-testid="builder-dimy-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {meta.dimensions.filter(d => d.id !== cfg.dim_x).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Window</Label>
                <Select value={cfg.window} onValueChange={(v) => setCfg({ ...cfg, window: v })}>
                  <SelectTrigger data-testid="builder-window-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.windows.filter(w => w.id !== 'custom').map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: filters as multi-select chips (collapsed by default) */}
            <FilterChips meta={meta} cfg={cfg} setCfg={setCfg} />

            {/* Run button */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {result && <>
                  <span className="font-medium">Asset pool:</span> {result.asset_pool_size} ·
                  <span className="font-medium ml-2">Events:</span> {result.event_count} ·
                  <span className="ml-2">Generated {new Date(result.generated_at).toLocaleString()}</span>
                </>}
              </div>
              <Button onClick={() => runConfig()} disabled={running} data-testid="builder-run-btn">
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        <Card data-testid="builder-result">
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              {isCrossTab ? 'Cross-tab Heatmap' : 'Result'}
            </CardTitle>
            <div className="flex gap-2">
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
            {running && <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-teal-700" /></div>}
            {!running && result && (isCrossTab ? <HeatmapTable result={result} /> : <ResultTable result={result} />)}
          </CardContent>
        </Card>
      </div>

      {/* ── Right: Saved reports ── */}
      <Card className="self-start">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" /> Saved
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {/* Save current */}
          <div className="space-y-1.5 pb-2 border-b">
            <Input
              placeholder="Name this report…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              data-testid="builder-save-name"
              className="text-xs"
            />
            <Button size="sm" className="w-full" onClick={saveCurrent} data-testid="builder-save-btn">
              <Save className="h-3.5 w-3.5 mr-1" /> Save current
            </Button>
          </div>
          {saved.length === 0 && <div className="text-[11px] text-slate-400 text-center py-4">No saved reports</div>}
          {saved.map((s) => (
            <div key={s._id}
                 className="p-2 rounded-md border border-slate-200 hover:border-teal-400 transition text-xs flex items-start gap-1"
                 data-testid={`saved-${s._id}`}>
              <button onClick={() => applySaved(s)} className="flex-1 text-left">
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
  );
}

// ─── Filter chips block (collapsed multi-selects) ─────────────────────────
function FilterChips({ meta, cfg, setCfg }) {
  const setFilter = (key, ids) => setCfg({ ...cfg, filters: { ...cfg.filters, [key]: ids } });
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-md border">
      <FilterMulti label="Stations" options={meta.stations}
                   selected={cfg.filters.station_ids}
                   onChange={(ids) => setFilter('station_ids', ids)} testid="filter-stations" />
      <FilterMulti label="Departments" options={meta.departments}
                   selected={cfg.filters.dept_ids}
                   onChange={(ids) => setFilter('dept_ids', ids)} testid="filter-depts" />
      <FilterMulti label="Asset Types" options={meta.asset_types}
                   selected={cfg.filters.asset_type_ids}
                   onChange={(ids) => setFilter('asset_type_ids', ids)} testid="filter-asset-types" />
    </div>
  );
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
      <button
        type="button"
        data-testid={`${testid}-trigger`}
        onClick={() => setOpenMenu(o => !o)}
        className="w-full mt-1 px-3 py-2 rounded-md border bg-white text-left text-sm flex justify-between items-center"
      >
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
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = new Set(selected || []);
                    if (on) next.delete(o.id); else next.add(o.id);
                    onChange(Array.from(next));
                  }}
                />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
