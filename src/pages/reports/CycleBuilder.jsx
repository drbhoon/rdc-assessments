import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Send, AlertCircle } from 'lucide-react';
import { api, istYmdIn } from './api';

// ── The /master filter panel, as on hr.rdcc.ai/master and PARAKH ──────────

const NO_FILTERS = {
  source: '', q: '',
  location: [], designation: [], company: [], cost_centre: [],
  doj_from: '', doj_to: '', dob_from: '', dob_to: '',
};

const FACETS = [
  { name: 'location', label: 'Location', from: 'locations' },
  { name: 'designation', label: 'Designation', from: 'designations' },
  { name: 'company', label: 'Company', from: 'companies' },
  { name: 'cost_centre', label: 'Cost centre', from: 'costCentres' },
];

function countFilters(f) {
  return FACETS.reduce((n, { name }) => n + f[name].length, 0)
    + (f.q.trim() ? 1 : 0) + (f.source ? 1 : 0)
    + ['doj_from', 'doj_to', 'dob_from', 'dob_to'].filter((k) => f[k]).length;
}

function filterQuery(f) {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.source) params.set('source', f.source);
  for (const { name } of FACETS) for (const v of f[name]) params.append(name, v);
  for (const k of ['doj_from', 'doj_to', 'dob_from', 'dob_to']) if (f[k]) params.set(k, f[k]);
  return params.toString();
}

const box = 'flex flex-col rounded-xl border border-slate-700 bg-slate-900';
const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none';

function FacetFilter({ label, options, selected, onChange }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    // Ticked values stay visible even when the search would hide them.
    const pinned = options.filter((o) => selected.includes(o) && !matches.includes(o));
    return [...pinned, ...matches];
  }, [query, options, selected]);

  const toggle = (o) => onChange(selected.includes(o) ? selected.filter((v) => v !== o) : [...selected, o]);

  return (
    <div className={box}>
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">{label}</span>
        {selected.length > 0 ? (
          <button type="button" onClick={() => onChange([])} title="Clear this filter"
                  className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30">
            {selected.length} selected ✕
          </button>
        ) : <span className="text-xs text-slate-500">{options.length}</span>}
      </div>
      <div className="px-3 pt-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder={`Search ${label.toLowerCase()}…`}
               className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none" />
      </div>
      <ul className="mt-1 max-h-52 overflow-y-auto px-1 py-1 text-sm">
        {shown.length === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-slate-500">No match</li>
        ) : shown.map((o) => {
          const on = selected.includes(o);
          return (
            <li key={o}>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 ${on ? 'bg-brand-500/15 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(o)} aria-label={`${label}: ${o}`} className="mt-0.5 accent-emerald-500" />
                <span className="leading-snug">{o}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterPanel({ draft, setDraft, options, appliedCount, resultCount, applying, onApply, onClear }) {
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(); }} className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <fieldset className="w-full">
          <legend className="mb-1 block text-sm font-semibold text-slate-200">Employees</legend>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-600 bg-slate-900">
            {[{ value: '', label: 'All' }, { value: 'onroll', label: 'On roll' }, { value: 'offroll', label: 'Off roll / third party' }].map((o) => (
              <label key={o.value || 'all'} className="cursor-pointer">
                <input type="radio" name="source" value={o.value} checked={draft.source === o.value}
                       onChange={() => set('source', o.value)} className="peer sr-only" />
                <span className="block px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 peer-checked:bg-brand-600 peer-checked:text-white">
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="min-w-[260px] flex-1 text-sm">
          <span className="mb-1 block font-semibold text-slate-200">Search name or code</span>
          <input value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder="e.g. Gurumurthy or G00064" className={input} />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" disabled={applying}
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
            {applying ? 'Applying…' : 'Apply filters'}
          </button>
          {(appliedCount > 0 || countFilters(draft) > 0) && (
            <button type="button" onClick={onClear}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {FACETS.map(({ name, label, from }) => (
          <FacetFilter key={name} label={label} options={options[from] || []}
                       selected={draft[name]} onChange={(v) => set(name, v)} />
        ))}
        <div className={`${box} gap-3 p-3`}>
          {[['doj', 'Date of joining', 'Tenure — e.g. the 2025 intake'], ['dob', 'Date of birth', 'Age band']].map(([prefix, label, hint]) => (
            <fieldset key={prefix}>
              <legend className="text-sm font-semibold text-slate-200">{label}</legend>
              <div className="mt-1 flex flex-col gap-1">
                <input type="date" value={draft[`${prefix}_from`]} aria-label={`${label} from`}
                       onChange={(e) => set(`${prefix}_from`, e.target.value)}
                       className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white [color-scheme:dark] focus:border-brand-500 focus:outline-none" />
                <input type="date" value={draft[`${prefix}_to`]} aria-label={`${label} to`}
                       onChange={(e) => set(`${prefix}_to`, e.target.value)}
                       className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white [color-scheme:dark] focus:border-brand-500 focus:outline-none" />
              </div>
              <p className="mt-1 text-xs text-slate-500">{hint}</p>
            </fieldset>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        {appliedCount > 0
          ? `${appliedCount} filter${appliedCount === 1 ? '' : 's'} applied — ${resultCount} matching. Leave a box untouched to include everyone.`
          : 'Leave a box untouched to include everyone. Employees with no recorded date fall outside a date range.'}
      </p>
    </form>
  );
}

// ── Supervisor chooser ─────────────────────────────────────────────────────

/** Type a name or code; pick from the master. `people` is the whole master. */
export function PersonPicker({ people, value, onChange, exclude, placeholder = 'Type name or code…', needsEmail = true }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = value ? people.find((p) => p.employee_code === value) : null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return people
      .filter((p) => p.employee_code !== exclude)
      .filter((p) => p.employee_name?.toLowerCase().includes(q) || p.employee_code?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, people, exclude]);

  if (chosen && !open) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-200">{chosen.employee_name} <span className="text-slate-500">({chosen.employee_code})</span></span>
        {needsEmail && !chosen.official_email_id && <span className="text-xs text-red-400">no e-mail</span>}
        <button type="button" onClick={() => { setOpen(true); setQuery(''); }} className="text-xs text-brand-400 hover:underline">change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input autoFocus={open} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder}
             onBlur={() => setTimeout(() => setOpen(false), 150)}
             className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none" />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[280px] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 shadow-xl">
          {matches.map((p) => (
            <li key={p.employee_code}>
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onChange(p.employee_code); setQuery(''); setOpen(false); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-800">
                <span className="text-white">{p.employee_name}</span> <span className="text-slate-500">({p.employee_code})</span>
                <span className="block text-xs text-slate-400">{[p.designation, p.location].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The builder ────────────────────────────────────────────────────────────

/** "September 2026" for the month just finished — what reports usually cover. */
function lastMonthLabel() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * New cycle (cycle = null) or "add trainees" to an existing one.
 * Only employee codes are sent; the server looks everyone up in the master.
 */
export default function CycleBuilder({ track, cycle = null, existingCodes = [], onDone, onCancel }) {
  const adding = Boolean(cycle);
  const [period, setPeriod] = useState(lastMonthLabel());
  const [submitBy, setSubmitBy] = useState(istYmdIn(7));
  const [reviewBy, setReviewBy] = useState(istYmdIn(14));

  const [options, setOptions] = useState({});
  const [people, setPeople] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);
  const [results, setResults] = useState(null);
  const [applying, setApplying] = useState(false);

  const [picked, setPicked] = useState([]); // [{ code, supervisor_code, hr_spoc_code }]
  const [bulkSupervisor, setBulkSupervisor] = useState('');
  const [bulkSpoc, setBulkSpoc] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opts, all] = await Promise.all([
          api('/api/admin/master/filter-options'),
          api('/api/admin/master/employees'),
        ]);
        if (cancelled) return;
        setOptions(opts);
        setPeople(all.employees);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byCode = useMemo(() => new Map(people.map((p) => [p.employee_code, p])), [people]);
  const already = useMemo(() => new Set(existingCodes), [existingCodes]);
  const shown = (results ?? people).filter((p) => !already.has(p.employee_code));
  const pickedSet = new Set(picked.map((p) => p.code));

  async function applyFilters() {
    setApplying(true);
    setError(null);
    try {
      const { employees } = await api(`/api/admin/master/employees?${filterQuery(draft)}`);
      setResults(employees);
      setApplied(draft);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  function clearFilters() {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
    setResults(null);
  }

  const blank = (code) => ({ code, supervisor_code: '', hr_spoc_code: '' });
  const toggle = (code) => setPicked((list) => (
    list.some((p) => p.code === code) ? list.filter((p) => p.code !== code) : [...list, blank(code)]
  ));
  const allShownPicked = shown.length > 0 && shown.every((p) => pickedSet.has(p.employee_code));
  const toggleAllShown = () => setPicked((list) => {
    if (allShownPicked) {
      const drop = new Set(shown.map((p) => p.employee_code));
      return list.filter((p) => !drop.has(p.code));
    }
    const have = new Set(list.map((p) => p.code));
    return [...list, ...shown.filter((p) => !have.has(p.employee_code)).map((p) => blank(p.employee_code))];
  });
  /** field is 'supervisor_code' or 'hr_spoc_code'. */
  const setRole = (code, field, value) => setPicked((list) => list.map((p) => (p.code === code ? { ...p, [field]: value } : p)));
  /** Fills one role for everyone who does not have it yet (never the trainee themselves). */
  const applyBulk = (field, value) => {
    if (!value) return;
    setPicked((list) => list.map((p) => (p[field] || p.code === value ? p : { ...p, [field]: value })));
  };

  const missingSupervisor = picked.filter((p) => !p.supervisor_code).length;
  const missingSpoc = picked.filter((p) => !p.hr_spoc_code).length;
  const noEmail = picked.filter((p) => !byCode.get(p.code)?.official_email_id).length;

  async function send() {
    setError(null);
    if (!picked.length) return setError('Select at least one trainee.');
    if (missingSupervisor) return setError(`Assign a supervisor to every trainee (${missingSupervisor} still without one).`);
    if (missingSpoc) return setError(`Assign an HR SPOC to every trainee (${missingSpoc} still without one).`);
    setSending(true);
    try {
      if (adding) {
        await api(`/api/admin/report-cycles/${cycle.id}/trainees`, { method: 'POST', body: { trainees: picked } });
        onDone(cycle.id);
      } else {
        const { id } = await api('/api/admin/report-cycles', {
          method: 'POST',
          body: { track, period_label: period, submit_by: submitBy, review_by: reviewBy, trainees: picked },
        });
        onDone(id);
      }
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {adding ? `Add trainees — ${cycle.period_label}` : `New ${track === 'ops' ? 'Operations' : 'Sales'} report cycle`}
        </h2>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-white">Cancel</button>
      </div>

      {!adding && (
        <div className="grid gap-4 rounded-2xl border border-slate-700 bg-slate-800/60 p-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-200">Report month</span>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. September 2026" className={input} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-200">Last date for trainees to upload</span>
            <input type="date" value={submitBy} onChange={(e) => setSubmitBy(e.target.value)} className={`${input} [color-scheme:dark]`} />
            <span className="mt-1 block text-xs text-slate-500">The link closes at the end of this day. AI evaluation runs after it.</span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-200">Last date for supervisors to rate</span>
            <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} className={`${input} [color-scheme:dark]`} />
            <span className="mt-1 block text-xs text-slate-500">Reminders go out 2 days before each date.</span>
          </label>
        </div>
      )}

      {loadError ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          <AlertCircle size={18} /> Could not load the employee master: {loadError}
        </div>
      ) : (
        <FilterPanel draft={draft} setDraft={setDraft} options={options} appliedCount={countFilters(applied)}
                     resultCount={shown.length} applying={applying} onApply={applyFilters} onClear={clearFilters} />
      )}

      {/* Matching employees */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/40">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 text-sm">
          <span className="font-semibold text-slate-200">
            {people.length === 0 && !loadError ? 'Loading employees…' : `${shown.length} employees shown`}
          </span>
          {shown.length > 0 && (
            <button onClick={toggleAllShown} className="text-brand-400 hover:underline">
              {allShownPicked ? 'Untick all shown' : `Tick all ${shown.length} shown`}
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr><th className="w-10 p-2" /><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Designation</th><th className="p-2">Location</th></tr>
            </thead>
            <tbody>
              {shown.slice(0, 500).map((p) => (
                <tr key={p.employee_code} onClick={() => toggle(p.employee_code)}
                    className={`cursor-pointer border-t border-slate-800 ${pickedSet.has(p.employee_code) ? 'bg-brand-500/10' : 'hover:bg-slate-800/60'}`}>
                  <td className="p-2 text-center">
                    <input type="checkbox" readOnly checked={pickedSet.has(p.employee_code)} aria-label={`Select ${p.employee_name}`} className="accent-emerald-500" />
                  </td>
                  <td className="p-2 font-mono text-xs text-slate-400">{p.employee_code}</td>
                  <td className="p-2 text-slate-200">{p.employee_name}</td>
                  <td className="p-2 text-slate-400">{p.designation}</td>
                  <td className="p-2 text-slate-400">{p.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="p-3 text-center text-xs text-slate-500">Showing the first 500 — narrow the filters to see the rest.</p>}
        </div>
      </div>

      {/* Selected trainees and their supervisors */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Selected trainees ({picked.length})</h3>
            <p className="text-xs text-slate-400">Every trainee needs a supervisor and an HR SPOC from the employee master.</p>
          </div>
          {picked.length > 0 && (
            <div className="flex flex-wrap items-end gap-4">
              {[
                ['supervisor_code', 'Same supervisor for everyone still without one', bulkSupervisor, setBulkSupervisor],
                ['hr_spoc_code', 'Same HR SPOC for everyone still without one', bulkSpoc, setBulkSpoc],
              ].map(([field, label, value, setValue]) => (
                <div key={field} className="flex items-end gap-2">
                  <div className="w-64">
                    <span className="mb-1 block text-xs text-slate-400">{label}</span>
                    <PersonPicker people={people} value={value} onChange={setValue} needsEmail={field === 'supervisor_code'} />
                  </div>
                  <button onClick={() => applyBulk(field, value)} disabled={!value}
                          className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                    Apply
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {picked.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Tick trainees in the list above.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr><th className="p-2">Trainee</th><th className="p-2">Location</th><th className="p-2 w-[28%]">Supervisor</th><th className="p-2 w-[28%]">HR SPOC</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {picked.map(({ code, supervisor_code, hr_spoc_code }) => {
                const p = byCode.get(code);
                return (
                  <tr key={code} className="border-t border-slate-700">
                    <td className="p-2 text-slate-200">
                      {p?.employee_name || code} <span className="text-slate-500">({code})</span>
                      {p && !p.official_email_id && <span className="ml-2 text-xs text-red-400">no e-mail in master</span>}
                    </td>
                    <td className="p-2 text-slate-400">{p?.location}</td>
                    <td className="p-2"><PersonPicker people={people} value={supervisor_code} exclude={code} onChange={(v) => setRole(code, 'supervisor_code', v)} /></td>
                    <td className="p-2"><PersonPicker people={people} value={hr_spoc_code} exclude={code} onChange={(v) => setRole(code, 'hr_spoc_code', v)} needsEmail={false} /></td>
                    <td className="p-2">
                      <button onClick={() => toggle(code)} title="Remove" className="text-slate-500 hover:text-red-400"><X size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={18} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {noEmail > 0 && <span className="text-xs text-red-400">{noEmail} selected trainee(s) have no e-mail and cannot receive a link.</span>}
        <button onClick={send} disabled={sending || !picked.length}
                className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
          {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          {adding ? `Add ${picked.length} and send their links` : `Send links to ${picked.length} trainee${picked.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
