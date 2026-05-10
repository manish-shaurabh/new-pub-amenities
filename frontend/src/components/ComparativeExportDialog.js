/**
 * ComparativeExportDialog — configure & download Comparative Reports as PDF or Excel.
 *
 * Triggered from the Comparative tab via gear-icon. Quick-download buttons
 * (PDF/Excel) bypass this dialog and use defaults.
 */
import { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2, FileDown, FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

const DEFAULT_SECTIONS = {
  card_a: true,
  card_b: true,
  card_c_current: true,
  card_c_full: false,
  defective: true,
  remarks: true,
  last_inspection: true,
};

export default function ComparativeExportDialog({
  open, onOpenChange, user, windowDays, stat, deptId, assetTypeIds, drillState,
}) {
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [style, setStyle] = useState('detailed');
  const [downloading, setDownloading] = useState(null);

  const toggle = (k) => setSections(prev => ({ ...prev, [k]: !prev[k] }));

  const buildBody = () => ({
    window_days: windowDays,
    stat,
    dept_id: deptId || null,
    asset_type_ids: assetTypeIds && assetTypeIds.length ? assetTypeIds : null,
    drill_state: drillState || { level: 'station', parent_id: null, parent_asset_type_id: null },
    sections,
    style,
  });

  const download = async (format) => {
    setDownloading(format);
    try {
      const url = `${BACKEND}/api/reports/comparative/export/${format}/${user._id}`;
      const res = await axios.post(url, buildBody(), { responseType: 'blob' });
      const ct = res.headers['content-type'];
      const blob = new Blob([res.data], { type: ct });
      const link = document.createElement('a');
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="([^"]+)"/);
      link.href = URL.createObjectURL(blob);
      link.download = match ? match[1] : `comparative.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast.success(`${format.toUpperCase()} downloaded`);
      onOpenChange?.(false);
    } catch (e) {
      console.error(e);
      toast.error(`Failed to generate ${format.toUpperCase()}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="comp-export-dialog">
        <DialogHeader>
          <DialogTitle>Configure & Download Report</DialogTitle>
          <DialogDescription>
            Pick which sections to include. Filters are inherited from the page (window, stat, department, asset-types).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Sections */}
          <div>
            <Label className="text-xs text-slate-500 uppercase tracking-wide">Sections</Label>
            <div className="grid grid-cols-1 gap-2 mt-2">
              <SectionToggle id="card_a" label="A · MTTR by Asset Type" sub="Single-bar table"
                             checked={sections.card_a} onChange={() => toggle('card_a')} />
              <SectionToggle id="card_b" label="B · Peer Comparison Matrix" sub="Radar + supervisor table"
                             checked={sections.card_b} onChange={() => toggle('card_b')} />
              <SectionToggle id="card_c_current" label="C · Drilldown — Current view"
                             sub="Whatever level you're on now"
                             checked={sections.card_c_current} onChange={() => toggle('card_c_current')} />
              <SectionToggle id="card_c_full" label="C · Drilldown — Full hierarchy"
                             sub="Every station × location × asset-type. Heavier output."
                             checked={sections.card_c_full} onChange={() => toggle('card_c_full')} />
              <div className="border-t my-1" />
              <SectionToggle id="defective" label="Defective-only Appendix"
                             sub="Currently-open Orange/Red list assets in scope"
                             checked={sections.defective} onChange={() => toggle('defective')} />
              <SectionToggle id="last_inspection" label="Last Inspection Appendix"
                             sub="Last inspection date · inspector · result per asset"
                             checked={sections.last_inspection} onChange={() => toggle('last_inspection')} />
              <SectionToggle id="remarks" label="Remarks Appendix"
                             sub="Last 5 remarks per defective asset"
                             checked={sections.remarks} onChange={() => toggle('remarks')} />
            </div>
          </div>

          {/* PDF style */}
          <div>
            <Label className="text-xs text-slate-500 uppercase tracking-wide">PDF Style</Label>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setStyle('detailed')}
                      data-testid="comp-export-style-detailed"
                      className={`flex-1 px-3 py-2 rounded border text-sm ${style === 'detailed' ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-300 text-slate-700'}`}>
                Detailed (boardroom)
              </button>
              <button onClick={() => setStyle('compact')}
                      data-testid="comp-export-style-compact"
                      className={`flex-1 px-3 py-2 rounded border text-sm ${style === 'compact' ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-300 text-slate-700'}`}>
                Compact
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange?.(false)} data-testid="comp-export-cancel">
            Cancel
          </Button>
          <Button variant="outline" onClick={() => download('excel')}
                  disabled={downloading != null}
                  data-testid="comp-export-download-xlsx"
                  className="gap-2">
            {downloading === 'excel'
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </Button>
          <Button onClick={() => download('pdf')}
                  disabled={downloading != null}
                  data-testid="comp-export-download-pdf"
                  className="gap-2 bg-teal-700 hover:bg-teal-800">
            {downloading === 'pdf'
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileDown className="h-4 w-4" />}
            PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionToggle({ id, label, sub, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 px-3 py-2 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={onChange} data-testid={`comp-export-${id}`} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </div>
    </label>
  );
}

/**
 * Quick download buttons (no dialog) — used inline on the Comparative page.
 */
export function ComparativeQuickDownload({ user, windowDays, stat, deptId, assetTypeIds, drillState, onOpenSettings }) {
  const [downloading, setDownloading] = useState(null);

  const quickDownload = async (format) => {
    setDownloading(format);
    try {
      const body = {
        window_days: windowDays,
        stat,
        dept_id: deptId || null,
        asset_type_ids: assetTypeIds && assetTypeIds.length ? assetTypeIds : null,
        drill_state: drillState || { level: 'station', parent_id: null, parent_asset_type_id: null },
        sections: DEFAULT_SECTIONS,
        style: 'detailed',
      };
      const url = `${BACKEND}/api/reports/comparative/export/${format}/${user._id}`;
      const res = await axios.post(url, body, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: res.headers['content-type'] });
      const link = document.createElement('a');
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="([^"]+)"/);
      link.href = URL.createObjectURL(blob);
      link.download = match ? match[1] : `comparative.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch (e) {
      console.error(e);
      toast.error(`Failed to generate ${format.toUpperCase()}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => quickDownload('pdf')}
              disabled={downloading != null}
              data-testid="comp-quick-pdf"
              className="gap-1.5 h-8">
        {downloading === 'pdf'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <FileDown className="h-3.5 w-3.5" />}
        PDF
      </Button>
      <Button size="sm" variant="outline" onClick={() => quickDownload('excel')}
              disabled={downloading != null}
              data-testid="comp-quick-xlsx"
              className="gap-1.5 h-8">
        {downloading === 'excel'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <FileSpreadsheet className="h-3.5 w-3.5" />}
        Excel
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenSettings}
              data-testid="comp-export-settings"
              className="h-8 px-2 text-slate-600">
        Configure…
      </Button>
    </div>
  );
}
