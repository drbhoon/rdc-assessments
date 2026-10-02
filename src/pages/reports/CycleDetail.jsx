import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, Bell, Download, FileText, Flag, Loader2, Mail, Play, RefreshCw,
  Trash2, Upload, UserPlus, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import { withBase } from '../../basePath';
import { ACCEPT, MAX_MB, RATING_LABEL, STATUS, api, fileToUpload, flagLine, fmtDate, fmtDateTime, istYmd, istYmdIn, useApi } from './api';
import CycleBuilder, { PersonPicker } from './CycleBuilder';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40';

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className={`my-8 w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const SEVERITY = {
  high: 'bg-red-500/15 text-red-300 border-red-500/40',
  medium: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
};

/** The flags for one trainee — shared by the console and (lighter) the supervisor page. */
function FlagList({ flags }) {
  const [open, setOpen] = useState(null);
  return (
    <ul className="space-y-3">
      {flags.map((f, i) => (
        <li key={i} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${SEVERITY[f.severity]}`}>{f.severity}</span>
            <span className="font-semibold text-white">{f.kind === 'repeat' ? 'Repeats an earlier report' : 'Copying'}</span>
            <span className="text-slate-300">— {flagLine(f)}</span>
          </div>
          {f.explanation && <p className="mt-2 text-slate-300">{f.explanation}</p>}
          {f.passages?.length > 0 && (
            <button onClick={() => setOpen(open === i ? null : i)} className="mt-2 text-xs text-brand-400 hover:underline">
              {open === i ? 'Hide' : 'Show'} matching passages
            </button>
          )}
          {open === i && f.passages.map((p, j) => (
            <blockquote key={j} className="mt-2 border-l-2 border-red-500/50 pl-3 text-xs text-slate-400">
              “{p.text}” <span className="text-slate-500">({p.words} words)</span>
            </blockquote>
          ))}
        </li>
      ))}
    </ul>
  );
}

function UploadStatus({ a }) {
  if (a.submitted_at) {
    return (
      <div>
        <span className="text-emerald-300">Uploaded</span> <span className="text-xs text-slate-500">{fmtDateTime(a.submitted_at)}</span>
        {a.submitted_by?.startsWith('hr:') && <span className="block text-xs text-slate-500">by HR</span>}
      </div>
    );
  }
  if (a.invite_error) return <span className="text-red-400" title={a.invite_error}>Link not sent</span>;
  if (!a.invited_at) return <span className="text-slate-500">Sending link…</span>;
  return (
    <div>
      <span className="text-slate-400">Not yet</span>
      {a.reopen_until && <span className="block text-xs text-sky-400">reopened to {fmtDate(a.reopen_until)}</span>}
    </div>
  );
}

function AiStatus({ a, status }) {
  if (!a.submitted_at) return <span className="text-slate-600">—</span>;
  if (a.eval_status === 'done') return <span className="font-semibold text-orange-300">{Number(a.ai_percent)}%</span>;
  if (a.eval_status === 'failed') return <span className="text-red-400" title={a.eval_error}>Failed</span>;
  return <span className="text-slate-500">{status === 'collecting' ? 'after last date' : 'evaluating…'}</span>;
}

/** Secondary actions for one trainee, shown when the row is expanded. */
function RowActions({ a, cycle, people, onChanged, setNote }) {
  const [reopenDate, setReopenDate] = useState(istYmdIn(3));
  const [supervisor, setSupervisor] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const base = `/api/admin/report-cycles/${cycle.id}/trainees/${a.id}`;

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) setNote(done);
      onChanged();
    } catch (err) {
      setNote(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const uploadFor = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return setNote(`The file is larger than ${MAX_MB} MB.`, true);
    run(async () => api(`${base}/upload`, { method: 'POST', body: await fileToUpload(file) }), `Uploaded ${file.name} for ${a.trainee_name}.`);
  };

  return (
    <div className="grid gap-4 p-4 text-sm md:grid-cols-3">
      <div className="space-y-2">
        <p className="font-semibold text-slate-200">Upload</p>
        <button disabled={busy} onClick={() => fileRef.current?.click()} className={btn}><Upload size={14} /> Upload on trainee's behalf</button>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={uploadFor} />
        <div className="flex items-center gap-2">
          <input type="date" value={reopenDate} min={istYmdIn(0)} onChange={(e) => setReopenDate(e.target.value)}
                 className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white [color-scheme:dark]" />
          <button disabled={busy} className={btn}
                  onClick={() => run(() => api(`${base}/reopen`, { method: 'POST', body: { until: reopenDate } }), `Link reopened for ${a.trainee_name} until ${fmtDate(reopenDate)}; they have been e-mailed.`)}>
            Reopen link
          </button>
        </div>
        <button disabled={busy} className={btn}
                onClick={() => run(() => api(`${base}/resend-invite`, { method: 'POST' }), `Link re-sent to ${a.trainee_email}.`)}>
          <Mail size={14} /> Re-send link
        </button>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-slate-200">Supervisor</p>
        <p className="text-slate-400">{a.supervisor_name} ({a.supervisor_code}) · {a.supervisor_email}</p>
        <PersonPicker people={people} value={supervisor} exclude={a.trainee_code} onChange={setSupervisor} placeholder="Change to… (name or code)" />
        <button disabled={busy || !supervisor || !people.length} className={btn}
                onClick={() => run(() => api(base, { method: 'PATCH', body: { supervisor_code: supervisor } }), 'Supervisor changed.')}>
          Change supervisor
        </button>
        {a.supervisor_comments && (
          <div className="rounded-lg bg-slate-950/60 p-2 text-xs text-slate-300">
            <span className="font-semibold">Comments:</span> <span className="whitespace-pre-wrap">{a.supervisor_comments}</span>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-slate-200">Evaluation</p>
        {a.eval_error && <p className="text-xs text-red-400">{a.eval_error}</p>}
        {cycle.status === 'reviewing' && a.submitted_at && (
          <button disabled={busy} className={btn}
                  onClick={() => run(() => api(`${base}/re-evaluate`, { method: 'POST' }), `Re-evaluating ${a.trainee_name}…`)}>
            <RefreshCw size={14} /> Re-run AI evaluation
          </button>
        )}
        {a.results_error && <p className="text-xs text-red-400">Results e-mail failed: {a.results_error}</p>}
        <button disabled={busy} className={`${btn} text-red-300`}
                onClick={() => window.confirm(`Remove ${a.trainee_name} from this cycle? Their upload and evaluation will be deleted.`)
                  && run(() => api(base, { method: 'DELETE' }), `${a.trainee_name} removed.`)}>
          <Trash2 size={14} /> Remove from cycle
        </button>
      </div>
    </div>
  );
}

export default function CycleDetail({ cycleId, onBack }) {
  const { data, error, reload: load } = useApi(`/api/admin/report-cycles/${cycleId}`);
  const [note, setNoteState] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal] = useState(null); // { kind: 'report'|'flags'|'results'|'dates', a? }
  const [reportHtml, setReportHtml] = useState(null);
  const [people, setPeople] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState(0);

  const setNote = (text, isError = false) => setNoteState(text ? { text, isError } : null);

  useEffect(() => {
    api('/api/admin/master/employees').then((d) => setPeople(d.employees)).catch(() => {});
  }, []);

  // Keep the screen live while background work is running: evaluation, links
  // still going out, or anything HR triggered in the last few minutes.
  useEffect(() => {
    if (!data) return undefined;
    const pendingInvites = data.assignments.some((a) => !a.invited_at && !a.invite_error);
    const pendingEval = data.assignments.some((a) => a.submitted_at && a.eval_status === 'pending' && data.cycle.status === 'reviewing');
    const live = data.cycle.status === 'evaluating' || pendingInvites || pendingEval || Date.now() - lastAction < 180000;
    if (!live) return undefined;
    const t = setTimeout(load, 8000);
    return () => clearTimeout(t);
  }, [data, load, lastAction]);

  const act = async (fn, done) => {
    setBusy(true);
    try {
      const out = await fn();
      setNote(typeof done === 'function' ? done(out) : done);
      setLastAction(Date.now());
      load();
    } catch (err) {
      setNote(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (a) => {
    setModal({ kind: 'report', a });
    setReportHtml(null);
    try {
      setReportHtml((await api(`/api/admin/report-assignments/${a.id}/report-html`)).html);
    } catch (err) {
      setReportHtml(`<p style="color:#b91c1c">${err.message}</p>`);
    }
  };

  if (error && !data) return <div className="rounded-xl bg-red-500/10 p-4 text-red-300">{error}</div>;
  if (!data) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-brand-500" size={32} /></div>;

  const { cycle, assignments, supervisors } = data;

  if (adding) {
    return (
      <CycleBuilder track={cycle.track} cycle={cycle} existingCodes={assignments.map((a) => a.trainee_code)}
                    onCancel={() => setAdding(false)}
                    onDone={() => { setAdding(false); setLastAction(Date.now()); setNote('Trainees added; their links are being sent.'); load(); }} />
    );
  }

  const count = (pred) => assignments.filter(pred).length;
  const submitted = count((a) => a.submitted_at);
  const evaluated = count((a) => a.eval_status === 'done');
  const rated = count((a) => a.supervisor_rating);
  const flagged = assignments.filter((a) => a.flags.length);
  const awaitingResults = count((a) => a.eval_status === 'done' && !a.results_sent_at);
  const ratedAwaiting = count((a) => a.eval_status === 'done' && a.supervisor_rating && !a.results_sent_at);
  const status = STATUS[cycle.status] || STATUS.collecting;
  const supFailures = supervisors.filter((s) => s.notify_error);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> All cycles</button>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{cycle.track === 'ops' ? 'Operations' : 'Sales'} — {cycle.period_label}</h2>
            <p className="mt-1 text-sm text-slate-400">
              Trainees upload by <strong className="text-slate-200">{fmtDate(cycle.submit_by)}</strong> · Supervisors rate by <strong className="text-slate-200">{fmtDate(cycle.review_by)}</strong>
              <button onClick={() => setModal({ kind: 'dates' })} className="ml-2 text-brand-400 hover:underline">change</button>
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${status.cls}`}>{status.label}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Trainees', assignments.length],
            ['Uploaded', submitted],
            ['AI evaluated', evaluated],
            ['Supervisor rated', rated],
            ['Red flags', flagged.length],
          ].map(([label, n]) => (
            <div key={label} className="rounded-xl bg-slate-900/70 p-3 text-center">
              <div className={`text-2xl font-bold ${label === 'Red flags' && n ? 'text-red-400' : 'text-white'}`}>{n}</div>
              <div className="text-xs uppercase text-slate-400">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setModal({ kind: 'flags' })} disabled={!flagged.length}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40">
            <Flag size={14} /> Red flags ({flagged.length})
          </button>
          {cycle.status === 'collecting' && (
            <>
              <button disabled={busy} className={btn} onClick={() => setAdding(true)}><UserPlus size={14} /> Add trainees</button>
              <button disabled={busy} className={btn}
                      onClick={() => act(() => api(`/api/admin/report-cycles/${cycle.id}/remind`, { method: 'POST', body: { who: 'trainees' } }), (o) => `Reminder sent to ${o.sent} trainee(s) who have not uploaded.`)}>
                <Bell size={14} /> Remind trainees now
              </button>
              <button disabled={busy} className={btn}
                      onClick={() => window.confirm('Evaluate now, before the last date? Trainees can still upload until the last date; anything uploaded later is evaluated as it arrives.')
                        && act(() => api(`/api/admin/report-cycles/${cycle.id}/evaluate`, { method: 'POST' }), 'Evaluation started.')}>
                <Play size={14} /> Evaluate now
              </button>
            </>
          )}
          {cycle.status === 'reviewing' && (
            <>
              <button disabled={busy} className={btn}
                      onClick={() => act(() => api(`/api/admin/report-cycles/${cycle.id}/remind`, { method: 'POST', body: { who: 'supervisors' } }), (o) => `Reminder sent to ${o.sent} supervisor(s) with reports still to rate.`)}>
                <Bell size={14} /> Remind supervisors now
              </button>
              <button disabled={busy || !awaitingResults} className={btnPrimary} onClick={() => setModal({ kind: 'results' })}>
                <Mail size={14} /> Send results to trainees
              </button>
            </>
          )}
          <a href={withBase(`/api/admin/report-cycles/${cycle.id}/summary.xlsx`)} className={btn}><Download size={14} /> Excel summary</a>
          <button disabled={busy} className={`${btn} ml-auto text-red-300`}
                  onClick={() => window.prompt(`Type DELETE to remove the whole ${cycle.period_label} cycle, with every upload, evaluation and rating.`) === 'DELETE'
                    && act(() => api(`/api/admin/report-cycles/${cycle.id}`, { method: 'DELETE' }), 'Deleted.').then(onBack)}>
            <Trash2 size={14} /> Delete cycle
          </button>
        </div>

        {supFailures.length > 0 && (
          <p className="mt-3 text-sm text-red-400">
            E-mail to {supFailures.map((s) => s.supervisor_name).join(', ')} failed: {supFailures[0].notify_error}
          </p>
        )}
      </div>

      {note && (
        <div className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${note.isError ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          <span className="flex items-start gap-2">{note.isError && <AlertCircle size={16} className="mt-0.5" />}{note.text}</span>
          <button onClick={() => setNote(null)}><X size={16} /></button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-700">
        <table className="w-full bg-slate-900 text-left text-sm">
          <thead className="bg-slate-950/60 text-slate-400">
            <tr>
              <th className="w-8 p-3" />
              <th className="p-3">Trainee</th>
              <th className="p-3">Supervisor</th>
              <th className="p-3">Report</th>
              <th className="p-3">AI score</th>
              <th className="p-3">Flags</th>
              <th className="p-3">Supervisor</th>
              <th className="p-3">Results</th>
              <th className="p-3 text-right">Documents</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <FragmentRow key={a.id} a={a} cycle={cycle} open={expanded === a.id}
                           onToggle={() => setExpanded(expanded === a.id ? null : a.id)}
                           onReport={() => openReport(a)} onFlags={() => setModal({ kind: 'flags', a })}>
                <RowActions a={a} cycle={cycle} people={people} setNote={setNote}
                            onChanged={() => { setLastAction(Date.now()); load(); }} />
              </FragmentRow>
            ))}
          </tbody>
        </table>
        {assignments.length === 0 && <p className="bg-slate-900 p-6 text-center text-slate-500">No trainees in this cycle.</p>}
      </div>

      {modal?.kind === 'report' && (
        <Modal wide title={`AI evaluation — ${modal.a.trainee_name}`} onClose={() => setModal(null)}>
          <div className="mb-3 flex justify-end">
            <a href={withBase(`/api/admin/report-assignments/${modal.a.id}/report.pdf`)} className={btnPrimary}><Download size={14} /> Download PDF</a>
          </div>
          {reportHtml === null
            ? <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-500" /></div>
            : <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: reportHtml }} />}
        </Modal>
      )}

      {modal?.kind === 'flags' && (
        <Modal wide title={modal.a ? `Red flags — ${modal.a.trainee_name}` : `Red flags — ${cycle.period_label}`} onClose={() => setModal(null)}>
          <p className="mb-4 text-sm text-slate-400">
            Each report is compared word for word with the other reports in this cycle and with every earlier {cycle.track === 'ops' ? 'Operations' : 'Sales'} report.
            Overlaps the AI judged to be template text are not shown. Copying flags appear on both trainees, since the comparison cannot tell who copied whom.
          </p>
          <div className="space-y-5">
            {(modal.a ? [modal.a] : flagged).map((a) => (
              <div key={a.id}>
                <p className="mb-2 font-semibold text-white">{a.trainee_name} <span className="text-slate-500">({a.trainee_code}) · {a.trainee_location}</span></p>
                <FlagList flags={a.flags} />
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modal?.kind === 'results' && (
        <ResultsModal cycle={cycle} ratedAwaiting={ratedAwaiting} unrated={awaitingResults - ratedAwaiting} onClose={() => setModal(null)}
                      onSend={(includeUnrated) => { setModal(null); act(() => api(`/api/admin/report-cycles/${cycle.id}/send-results`, { method: 'POST', body: { include_unrated: includeUnrated } }), (o) => `Sending results to ${o.queued} trainee(s)…`); }} />
      )}

      {modal?.kind === 'dates' && (
        <DatesModal cycle={cycle} onClose={() => setModal(null)}
                    onSave={(body) => { setModal(null); act(() => api(`/api/admin/report-cycles/${cycle.id}`, { method: 'PATCH', body }), 'Dates updated.'); }} />
      )}
    </div>
  );
}

function FragmentRow({ a, cycle, open, onToggle, onReport, onFlags, children }) {
  return (
    <>
      <tr className="border-t border-slate-800 align-top hover:bg-slate-800/40">
        <td className="p-3">
          <button onClick={onToggle} title="More actions" className="text-slate-400 hover:text-white">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="p-3">
          <div className="font-medium text-slate-100">{a.trainee_name}</div>
          <div className="text-xs text-slate-500">{a.trainee_code}{a.trainee_location ? ` · ${a.trainee_location}` : ''}</div>
        </td>
        <td className="p-3 text-slate-300">{a.supervisor_name}</td>
        <td className="p-3"><UploadStatus a={a} /></td>
        <td className="p-3"><AiStatus a={a} status={cycle.status} /></td>
        <td className="p-3">
          {a.flags.length ? (
            <button onClick={onFlags} className={`rounded-full border px-2 py-0.5 text-xs font-bold ${SEVERITY[a.flags[0].severity]}`}>
              ⚑ {a.flags.length}
            </button>
          ) : a.eval_status === 'done' ? <span className="text-xs text-slate-500">none</span> : <span className="text-slate-600">—</span>}
        </td>
        <td className="p-3">
          {a.supervisor_rating
            ? <span className="font-semibold text-sky-300" title={a.supervisor_comments}>{a.supervisor_rating}/5 <span className="text-xs font-normal text-slate-400">{RATING_LABEL[a.supervisor_rating]}</span></span>
            : a.eval_status === 'done' ? <span className="text-slate-500">awaiting</span> : <span className="text-slate-600">—</span>}
        </td>
        <td className="p-3 text-xs">
          {a.results_sent_at ? <span className="text-emerald-300">sent {fmtDate(a.results_sent_at)}</span>
            : a.results_error ? <span className="text-red-400" title={a.results_error}>failed</span>
              : <span className="text-slate-600">—</span>}
        </td>
        <td className="p-3">
          <div className="flex justify-end gap-2">
            {a.submitted_at && (
              <a href={withBase(`/api/admin/report-assignments/${a.id}/file`)} title={`Download ${a.file_name}`} className="text-slate-400 hover:text-white">
                <FileText size={18} />
              </a>
            )}
            {a.eval_status === 'done' && (
              <button onClick={onReport} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-500">AI report</button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-800 bg-slate-950/50">
          <td colSpan={9}>{children}</td>
        </tr>
      )}
    </>
  );
}

function ResultsModal({ ratedAwaiting, unrated, onClose, onSend }) {
  const [includeUnrated, setIncludeUnrated] = useState(ratedAwaiting === 0);
  const n = ratedAwaiting + (includeUnrated ? unrated : 0);
  return (
    <Modal title="Send results to trainees" onClose={onClose}>
      <p className="text-sm text-slate-300">
        Each trainee receives an e-mail with their AI evaluation report (PDF) and their supervisor's rating and comments.
        Red flags are not included. Nobody is e-mailed twice.
      </p>
      <ul className="mt-4 space-y-1 text-sm text-slate-300">
        <li><strong className="text-white">{ratedAwaiting}</strong> rated by their supervisor, ready to send.</li>
        {unrated > 0 && <li><strong className="text-white">{unrated}</strong> evaluated but not yet rated by their supervisor.</li>}
      </ul>
      {unrated > 0 && (
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={includeUnrated} onChange={(e) => setIncludeUnrated(e.target.checked)} className="accent-emerald-500" />
          Also send to the {unrated} not yet rated (their e-mail will say "Supervisor's rating: not given")
        </label>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className={btn}>Cancel</button>
        <button disabled={!n} onClick={() => onSend(includeUnrated)} className={btnPrimary}><Mail size={14} /> Send to {n} trainee{n === 1 ? '' : 's'}</button>
      </div>
    </Modal>
  );
}

function DatesModal({ cycle, onClose, onSave }) {
  const [period, setPeriod] = useState(cycle.period_label);
  const [submitBy, setSubmitBy] = useState(istYmd(cycle.submit_by));
  const [reviewBy, setReviewBy] = useState(istYmd(cycle.review_by));
  const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white [color-scheme:dark]';
  const save = () => {
    const body = {};
    if (period !== cycle.period_label) body.period_label = period;
    if (cycle.status === 'collecting' && submitBy !== istYmd(cycle.submit_by)) body.submit_by = submitBy;
    if (reviewBy !== istYmd(cycle.review_by)) body.review_by = reviewBy;
    onSave(body);
  };
  return (
    <Modal title="Change month and dates" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="block"><span className="mb-1 block text-slate-300">Report month</span>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} className={field} /></label>
        <label className="block"><span className="mb-1 block text-slate-300">Last date for trainees</span>
          <input type="date" value={submitBy} disabled={cycle.status !== 'collecting'} onChange={(e) => setSubmitBy(e.target.value)} className={field} />
          {cycle.status !== 'collecting' && <span className="mt-1 block text-xs text-slate-500">Reports are already evaluated — reopen individual trainees instead.</span>}
        </label>
        <label className="block"><span className="mb-1 block text-slate-300">Last date for supervisors</span>
          <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} className={field} /></label>
        <p className="text-xs text-slate-500">Moving a date later sends a fresh reminder 2 days before the new date.</p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className={btn}>Cancel</button>
        <button onClick={save} className={btnPrimary}>Save</button>
      </div>
    </Modal>
  );
}
