import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ─── Date / Time Formatters (IST naive) ───────────────────────────────────────
// All backend timestamps are naive Indian Standard Time literals, e.g.
// "2026-05-07T14:51:19" (no Z, no offset). We never apply timezone math
// because the entire system runs in IST. The formatters below parse the
// literal string parts and format them directly so the displayed value is
// always identical to what was stored, regardless of the browser's timezone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _parseLiteral(ts) {
  if (!ts) return null;
  // Accept legacy "...Z" or "...+05:30" forms but always treat as naive IST.
  const s = String(ts).replace('Z', '').replace(/[+-]\d{2}:?\d{2}$/, '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3],
    hh: m[4] != null ? +m[4] : 0,
    mm: m[5] != null ? +m[5] : 0,
    ss: m[6] != null ? +m[6] : 0,
  };
}

function _ampm(hh, mm) {
  const h12 = ((hh + 11) % 12) + 1;
  const ap = hh < 12 ? 'AM' : 'PM';
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ap}`;
}

/** "07 May 2026, 02:51 PM" — used on OL pages, remarks, history drawers */
export function formatDateTime(ts) {
  const p = _parseLiteral(ts);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1]} ${p.y}, ${_ampm(p.hh, p.mm)}`;
}

/** "07 May 2026" — used on compact dashboard cards */
export function formatDateOnly(ts) {
  const p = _parseLiteral(ts);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1]} ${p.y}`;
}

/** "07 May, 02:51 PM" — used on sidebar panel item rows */
export function formatDateTimeCompact(ts) {
  const p = _parseLiteral(ts);
  if (!p) return '—';
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1]}, ${_ampm(p.hh, p.mm)}`;
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

// ─── IST naive literal builders ───────────────────────────────────────────────
// The backend stores all datetimes as naive Indian Standard Time literals
// (no timezone conversion). When the user types "20 Feb 2026, 23:30" we must
// send "2026-02-20T23:30:00" verbatim — NEVER use .toISOString() because that
// shifts to UTC and silently subtracts 5h30m.
//
// `dateInput` may be a Date object OR an ISO string (e.g. from shadcn Calendar).
// Either way, we read the LOCAL Y/M/D since the user lives in IST.

const _pad = (n) => String(n).padStart(2, '0');

/**
 * Build "YYYY-MM-DDTHH:mm:00" from a Date|ISO and an optional "HH:mm" time string.
 * Returns null if dateInput is missing.
 */
export function toIstLiteral(dateInput, timeStr) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = _pad(d.getMonth() + 1);
  const dd = _pad(d.getDate());
  let hh = _pad(d.getHours());
  let mi = _pad(d.getMinutes());
  if (typeof timeStr === 'string' && /^\d{1,2}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':');
    hh = _pad(parseInt(h, 10));
    mi = _pad(parseInt(m, 10));
  }
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
}

/** Build "YYYY-MM-DDTHH:mm:00" from "now" — the user's current IST wall clock. */
export function nowIstLiteral() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
}
