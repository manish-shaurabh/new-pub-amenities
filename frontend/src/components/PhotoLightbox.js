/**
 * PhotoLightbox — click a thumbnail to enlarge it in a centered modal.
 *
 * Usage:
 *   const [lb, setLb] = useState({ open: false, urls: [], idx: 0 });
 *   <img onClick={() => setLb({ open: true, urls: photos, idx: i })} />
 *   <PhotoLightbox state={lb} onClose={() => setLb({ ...lb, open: false })} />
 *
 * Or use the convenience hook:
 *   const { open, lightbox } = useLightbox();
 *   <img onClick={() => open(photoUrls, idx)} />
 *   {lightbox}
 */
import { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

function _resolveUrl(u) {
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u;
  return `${BACKEND}${u}`;
}

export function PhotoLightbox({ state, onClose }) {
  const { open, urls = [], idx = 0 } = state || {};
  const [cursor, setCursor] = useState(idx);

  useEffect(() => {
    setCursor(idx || 0);
  }, [idx, open]);

  const next = useCallback(() => {
    if (urls.length <= 1) return;
    setCursor((c) => (c + 1) % urls.length);
  }, [urls.length]);
  const prev = useCallback(() => {
    if (urls.length <= 1) return;
    setCursor((c) => (c - 1 + urls.length) % urls.length);
  }, [urls.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, next, prev]);

  if (!open || urls.length === 0) return null;
  const cur = _resolveUrl(urls[cursor]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="photo-lightbox"
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        type="button"
        aria-label="Close"
        data-testid="lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      {urls.length > 1 && (
        <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-medium">
          {cursor + 1} / {urls.length}
        </div>
      )}

      {/* Download */}
      <a
        href={cur}
        download
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 right-4 h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center gap-2 text-xs"
        data-testid="lightbox-download"
      >
        <Download className="h-4 w-4" /> Download
      </a>

      {/* Prev */}
      {urls.length > 1 && (
        <button
          type="button"
          aria-label="Previous"
          data-testid="lightbox-prev"
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-4 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Image (clicking image does NOT close — only outer backdrop does) */}
      <img
        src={cur}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-md shadow-2xl"
        data-testid="lightbox-image"
      />

      {/* Next */}
      {urls.length > 1 && (
        <button
          type="button"
          aria-label="Next"
          data-testid="lightbox-next"
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="absolute right-4 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}

/** Convenience hook — encapsulates state + the lightbox JSX. */
export function useLightbox() {
  const [state, setState] = useState({ open: false, urls: [], idx: 0 });
  const open = useCallback((urls, idx = 0) => {
    setState({ open: true, urls: Array.isArray(urls) ? urls : [urls], idx });
  }, []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const lightbox = <PhotoLightbox state={state} onClose={close} />;
  return { open, close, lightbox, state };
}

export default PhotoLightbox;
