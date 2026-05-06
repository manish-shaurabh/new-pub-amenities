/**
 * Convert anything an API might throw into a plain user-readable string
 * so it can be safely rendered into JSX or passed to toast.error().
 *
 * In particular: FastAPI/Pydantic v2 returns `detail` as an array of
 * { type, loc, msg, input, url } objects on validation failures — passing
 * that directly into React or sonner crashes with "Objects are not valid as a
 * React child".
 */
export function errString(err, fallback = 'Something went wrong') {
  // Plain string already
  if (typeof err === 'string') return err;
  // Axios error with response payload
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object') {
          const where = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '';
          const msg = e.msg || e.message || JSON.stringify(e);
          return where ? `${where}: ${msg}` : msg;
        }
        return String(e);
      })
      .filter(Boolean)
      .join(' · ') || fallback;
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail) || fallback;
  }
  // Plain Error
  if (err?.message) return err.message;
  return fallback;
}
