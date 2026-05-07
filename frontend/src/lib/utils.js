import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ─── Date / Time Formatters ───────────────────────────────────────────────────
// All backend timestamps are UTC ISO strings (e.g. "2026-05-07T09:21:19Z").
// JavaScript parses strings with "Z" or "+00:00" as UTC and converts to local
// time via toLocaleString, so these formatters produce the correct local time
// for the user's timezone (IST, UTC, etc.).

const LOCALE = 'en-IN';

/** "07 May 2026, 09:21 AM" — used on OL pages, remarks, history drawers */
export function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** "07 May 2026" — used on compact dashboard cards */
export function formatDateOnly(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** "07 May, 09:21 AM" — used on sidebar panel item rows */
export function formatDateTimeCompact(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(LOCALE, {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Human-readable duration from a count of hours.
 * formatDuration(1.5)  → "1h 30m"
 * formatDuration(25.3) → "1d 1h"
 */
export function formatDuration(hours) {
  if (hours == null || isNaN(hours)) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
