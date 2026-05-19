/**
 * IconPicker — searchable grid over the full Lucide library (3,590 icons)
 * plus the 18 "Recommended" presets pinned at the top, and a custom icon
 * upload section for SVG/PNG files.
 *
 * Props:
 *   value      — current icon_key (legacy short key OR PascalCase Lucide name)
 *   onChange   — fn(newKey) called when user picks. Pass '' to reset to auto.
 *   autoHint   — optional fallback key shown as "auto-detected" (amber halo)
 *   maxVisible — cap on rendered results (default 120) so big libs stay fast.
 *   customIconUrl — currently uploaded custom icon URL (if any)
 *   onUploadIcon  — fn(file) called when user uploads a custom icon file
 *   onDeleteIcon  — fn() called to remove the custom icon
 *   assetTypeId   — asset type ID (needed for upload endpoint)
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, X, RotateCcw, Upload, ImageIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ICON_MAP, ICON_PRESETS, LUCIDE_ICON_NAMES, resolveIcon,
} from '../lib/assetIcons';

const API = process.env.REACT_APP_BACKEND_URL || '';
const DEFAULT_MAX_VISIBLE = 120;

export default function IconPicker({
  value = '',
  onChange,
  autoHint = '',
  maxVisible = DEFAULT_MAX_VISIBLE,
  customIconUrl = '',
  onUploadIcon,
  onDeleteIcon,
  assetTypeId,
}) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(maxVisible);
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'upload'
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  // When the user types, reset the visible window
  useEffect(() => { setVisibleCount(maxVisible); }, [search, maxVisible]);

  const recommended = ICON_PRESETS;

  const filteredLucide = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return LUCIDE_ICON_NAMES;
    return LUCIDE_ICON_NAMES.filter(name => name.toLowerCase().includes(q));
  }, [search]);

  const visibleLucide = filteredLucide.slice(0, visibleCount);
  const remaining = filteredLucide.length - visibleLucide.length;

  const isCurrent = (key) => value === key;
  const isAuto = (key) => !value && autoHint === key;

  const handlePick = (key) => onChange?.(isCurrent(key) ? '' : key);

  const handleFileUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ['svg', 'png', 'jpg', 'jpeg', 'webp'];
    if (!allowed.includes(ext)) {
      toast.error(`Unsupported format. Allowed: ${allowed.join(', ')}`);
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error('Icon must be under 512 KB');
      return;
    }
    if (onUploadIcon) {
      setUploading(true);
      try {
        await onUploadIcon(file);
      } finally {
        setUploading(false);
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Tab switcher */}
      <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab('library')}
          data-testid="icon-tab-library"
          className={`flex-1 text-[10px] font-medium py-1.5 px-3 rounded-md transition-all ${
            activeTab === 'library'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Icon Library
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          data-testid="icon-tab-upload"
          className={`flex-1 text-[10px] font-medium py-1.5 px-3 rounded-md transition-all flex items-center justify-center gap-1 ${
            activeTab === 'upload'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Upload size={10} /> Custom Upload
          {customIconUrl && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
        </button>
      </div>

      {/* UPLOAD TAB */}
      {activeTab === 'upload' && (
        <div className="space-y-3">
          {/* Current custom icon preview */}
          {customIconUrl && (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg" data-testid="custom-icon-preview">
              <div className="w-12 h-12 rounded-lg border-2 border-emerald-300 bg-white flex items-center justify-center overflow-hidden shadow-sm">
                <img
                  src={customIconUrl.startsWith('/') ? `${API}${customIconUrl}` : customIconUrl}
                  alt="Custom icon"
                  className="w-9 h-9 object-contain"
                />
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-emerald-800">Custom icon active</div>
                <div className="text-[10px] text-emerald-600 mt-0.5 truncate max-w-[200px]">
                  {customIconUrl.startsWith('data:') ? 'Embedded icon (SVG/PNG)' : customIconUrl.split('/').pop()}
                </div>
              </div>
              {onDeleteIcon && (
                <button
                  type="button"
                  onClick={onDeleteIcon}
                  data-testid="custom-icon-delete"
                  className="p-1.5 rounded-md hover:bg-red-100 text-red-500 transition"
                  title="Remove custom icon"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}

          {/* Upload area */}
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
              uploading ? 'border-blue-300 bg-blue-50' : 'border-slate-300 hover:border-teal-400 hover:bg-teal-50/30'
            }`}
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const file = e.dataTransfer.files[0];
              if (file) handleFileUpload(file);
            }}
            data-testid="custom-icon-dropzone"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files[0])}
            />
            {uploading ? (
              <div className="text-xs text-blue-600 font-medium">Uploading...</div>
            ) : (
              <>
                <ImageIcon size={24} className="mx-auto mb-2 text-slate-400" />
                <div className="text-xs font-medium text-slate-600">
                  Drop an icon file here or click to browse
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  SVG (recommended), PNG, JPG, WebP — max 512 KB
                </div>
              </>
            )}
          </div>

          {/* Format tips */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Format Guide</div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-600">
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500" />
                <span><strong>SVG</strong> — best quality, scalable</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-blue-500" />
                <span><strong>PNG</strong> — use 64x64 or 128x128</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-500" />
                <span>Transparent background preferred</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-slate-400" />
                <span>Max 512 KB file size</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIBRARY TAB */}
      {activeTab === 'library' && (
        <>
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              data-testid="icon-picker-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search 3,590+ icons (e.g. train, fan, signal, hammer)..."
              className="w-full pl-8 pr-8 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:border-teal-600 bg-slate-50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                data-testid="icon-picker-clear-search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                type="button"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Reset to auto */}
          {value && (
            <button
              type="button"
              data-testid="icon-picker-reset"
              onClick={() => onChange?.('')}
              className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-teal-700"
            >
              <RotateCcw size={10} /> Reset (auto-detect from name)
            </button>
          )}

          {/* Recommended presets — only when not actively searching */}
          {!search.trim() && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
                Recommended (18)
              </div>
              <div className="grid grid-cols-6 gap-1.5 max-h-32 overflow-y-auto p-1 border border-slate-200 rounded-md bg-white">
                {recommended.map(preset => {
                  const Icon = ICON_MAP[preset.key];
                  const current = isCurrent(preset.key);
                  const auto = isAuto(preset.key);
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      data-testid={`icon-picker-preset-${preset.key}`}
                      onClick={() => handlePick(preset.key)}
                      title={preset.label + (auto ? ' (auto-detected)' : '')}
                      className={`flex flex-col items-center gap-0.5 p-1.5 rounded border transition
                        ${current
                          ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600'
                          : auto
                          ? 'border-amber-300 bg-amber-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <Icon className="h-4 w-4 text-slate-700" />
                      <span className="text-[8px] text-slate-500 truncate w-full text-center">{preset.key}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lucide library */}
          <div>
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
              <span>
                {search.trim() ? `Results (${filteredLucide.length})` : 'All Lucide Icons'}
              </span>
              {filteredLucide.length === 0 && (
                <span className="text-slate-400 normal-case">No matches</span>
              )}
            </div>
            <div
              data-testid="icon-picker-grid"
              className="grid grid-cols-8 gap-1.5 max-h-72 overflow-y-auto p-1 border border-slate-200 rounded-md bg-white"
            >
              {visibleLucide.map(name => {
                const Icon = resolveIcon(name);
                const current = isCurrent(name);
                return (
                  <button
                    key={name}
                    type="button"
                    data-testid={`icon-picker-lucide-${name}`}
                    onClick={() => handlePick(name)}
                    title={name}
                    className={`flex items-center justify-center p-1.5 rounded border transition
                      ${current
                        ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600'
                        : 'border-slate-200 hover:bg-slate-50 hover:border-teal-300'
                      }`}
                  >
                    <Icon className="h-4 w-4 text-slate-700" />
                  </button>
                );
              })}
            </div>
            {remaining > 0 && (
              <button
                type="button"
                data-testid="icon-picker-load-more"
                onClick={() => setVisibleCount(c => c + maxVisible)}
                className="w-full mt-1 py-1 text-[10px] text-teal-700 hover:bg-teal-50 rounded border border-dashed border-teal-300"
              >
                Show {Math.min(remaining, maxVisible)} more (of {remaining} remaining)
              </button>
            )}
          </div>

          {/* Current selection caption */}
          {value && (
            <div
              data-testid="icon-picker-current"
              className="flex items-center gap-2 text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5"
            >
              <span className="font-semibold text-slate-700">Selected:</span>
              <code className="font-mono text-teal-700">{value}</code>
            </div>
          )}
        </>
      )}
    </div>
  );
}
