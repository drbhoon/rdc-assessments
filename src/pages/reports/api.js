import { useCallback, useEffect, useState } from 'react';
import { withBase } from '../../basePath';

/** fetch + JSON, throwing the server's own error message on failure. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(withBase(path), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

/**
 * GET a JSON endpoint and keep it in state. `reload()` fetches again; the
 * last good data stays on screen while it does, and through an error.
 */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    api(path)
      .then((data) => { if (!off) setState({ data, error: null }); })
      .catch((err) => { if (!off) setState((s) => ({ data: s.data, error: err.message })); });
    return () => { off = true; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const STATUS = {
  collecting: { label: 'Collecting reports', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  evaluating: { label: 'AI evaluating…', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/30' },
  reviewing: { label: 'With supervisors', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
};

/** A File as { fileName, mime, data } — data is a base64 data URL. */
export function fileToUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, mime: file.type, data: reader.result });
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export const ACCEPT = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp';
export const MAX_MB = 15;

const IST = 'Asia/Kolkata';
export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** The calendar date (YYYY-MM-DD) of a timestamp, in IST — for date inputs. */
export function istYmd(v) {
  if (!v) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(v));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today + n days as YYYY-MM-DD in IST. */
export const istYmdIn = (days) => istYmd(Date.now() + days * 86400000);

export const RATING_LABEL = { 5: 'Excellent', 4: 'Good', 3: 'Average', 2: 'Weak', 1: 'Poor' };

/** "Copy HIGH: 62% matches Ravi Kumar" — one line per flag. */
export function flagLine(f) {
  const who = f.kind === 'repeat'
    ? `repeats own ${f.other.period_label} report`
    : `matches ${f.other.trainee_name} (${f.other.trainee_code})${f.other.same_cycle ? '' : `, ${f.other.period_label}`}`;
  return `${f.share}% ${who}`;
}
