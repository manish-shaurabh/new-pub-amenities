/**
 * IconPicker — searchable grid over the full Lucide library (3,590 icons)
 * plus the 18 "Recommended" presets pinned at the top.
 *
 * Props:
 *   value      — current icon_key (legacy short key OR PascalCase Lucide name)
 *   onChange   — fn(newKey) called when user picks. Pass '' to reset to auto.
 *   autoHint   — optional fallback key shown as "auto-detected" (amber halo)
 *   maxVisible — cap on rendered results (default 120) so big libs stay fast.
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, X, RotateCcw } from 'lucide-react';
import {
  ICON_MAP, ICON_PRESETS, LUCIDE_ICON_NAMES, resolveIcon,
} from '../lib/assetIcons';

const DEFAULT_MAX_VISIBLE = 120;

export default function IconPicker({
  value = '',
  onChange,
  autoHint = '',
  maxVisible = DEFAULT_MAX_VISIBLE,
}) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(maxVisible);
  const inputRef = useRef(null);

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

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          data-testid="icon-picker-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search 3,590+ icons (e.g. train, fan, signal, hammer)…"
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
    </div>
  );
}
