import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Download, FileText, Flag, Loader2 } from 'lucide-react';
import { withBase } from '../basePath';
import { RATING_LABEL, api, flagLine, fmtDate, fmtDateTime, useApi } from './reports/api';

const RATINGS = [1, 2, 3, 4, 5];

function TraineeCard({ t, token, canReview, onSaved }) {
  const [rating, setRating] = useState(t.supervisor_rating || 0);
  const [comments, setComments] = useState(t.supervisor_comments || '');
  const [showReport, setShowReport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const dirty = rating !== (t.supervisor_rating || 0) || comments !== (t.supervisor_comments || '');

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/review/${token}/${t.id}`, { method: 'POST', body: { rating, comments } });
      setMessage({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{t.trainee_name}</h2>
          <p className="text-sm text-slate-500">{[t.trainee_code, t.trainee_designation, t.trainee_location].filter(Boolean).join(' · ')}</p>
        </div>
        {t.evaluated && (
          <div className="text-right">
            <div className="text-2xl font-bold text-orange-600">{t.ai_percent}%</div>
            <div className="text-xs uppercase text-orange-600">AI score · {t.ai_points}/30</div>
          </div>
        )}
      </div>

      {!t.submitted_at ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">No report was uploaded.</p>
      ) : !t.evaluated ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Uploaded {fmtDateTime(t.submitted_at)} — the AI evaluation is not ready yet.</p>
      ) : (
        <>
          {t.flags.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="flex items-center gap-2 font-semibold text-red-800"><Flag size={16} /> Red flags</p>
              <ul className="mt-2 space-y-2 text-sm text-red-900">
                {t.flags.map((f, i) => (
                  <li key={i}>
                    <strong className="uppercase">{f.severity}</strong> · {f.kind === 'repeat' ? 'Repeats an earlier report' : 'Copying'}: {flagLine(f)}
                    {f.explanation && <span className="block text-red-800/80">{f.explanation}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href={withBase(`/api/review/${token}/${t.id}/file`)}
               className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FileText size={16} /> Trainee's report
            </a>
            <a href={withBase(`/api/review/${token}/${t.id}/report.pdf`)}
               className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download size={16} /> AI assessment (PDF)
            </a>
            <button onClick={() => setShowReport(!showReport)} className="rounded-lg px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
              {showReport ? 'Hide' : 'View'} AI assessment here
            </button>
          </div>
          {showReport && <div className="mt-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: t.report_html }} />}

          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-800">Your rating</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {RATINGS.map((n) => (
                <button key={n} type="button" disabled={!canReview} onClick={() => setRating(n)}
                        aria-label={`Rate ${n} of 5, ${RATING_LABEL[n]}`} aria-pressed={rating === n}
                        className={`rounded-lg border px-3 py-2 text-sm ${rating === n ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed`}>
                  <span className="font-bold">{n}</span> <span className="text-xs">{RATING_LABEL[n]}</span>
                </button>
              ))}
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor={`c-${t.id}`}>Your comments</label>
            <textarea id={`c-${t.id}`} value={comments} onChange={(e) => setComments(e.target.value)} disabled={!canReview} rows={4}
                      placeholder="What did the trainee do well this month, and what should they work on?"
                      className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50" />
            <div className="mt-3 flex items-center gap-3">
              {canReview && (
                <button onClick={save} disabled={saving || !rating || !comments.trim() || !dirty}
                        className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {saving ? 'Saving…' : t.supervisor_rating ? 'Update' : 'Submit rating'}
                </button>
              )}
              {t.reviewed_at && !dirty && <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={16} /> Rated {fmtDateTime(t.reviewed_at)}</span>}
              {message && <span className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One link per supervisor per cycle, listing every trainee they supervise. */
export default function SupervisorReview() {
  const { token } = useParams();
  const { data: info, error, reload: load } = useApi(`/api/review/${token}`);

  const pending = info?.trainees.filter((t) => t.evaluated && !t.supervisor_rating).length ?? 0;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-800">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex justify-center"><img src={withBase('/rdc_logo.png')} alt="RDC" className="h-14 object-contain" /></div>
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl bg-white p-6 text-red-700 shadow"><AlertCircle className="mt-0.5 shrink-0" /> {error}</div>
        ) : !info ? (
          <div className="flex justify-center p-12"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
        ) : (
          <>
            <div className="rounded-2xl bg-white p-6 shadow">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{info.track} trainee reports · {info.period_label}</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Hello {info.supervisor_name}</h1>
              {!info.evaluated ? (
                <p className="mt-2 text-slate-600">The reports are still being evaluated. You will receive an e-mail when they are ready.</p>
              ) : info.can_review ? (
                <p className="mt-2 text-slate-600">
                  Please review each trainee's report and the AI assessment, then give your comments and a final rating by <strong>{fmtDate(info.review_by)}</strong>.
                  {pending > 0 ? ` ${pending} still to rate.` : ' All done — thank you.'}
                </p>
              ) : (
                <p className="mt-2 text-red-700">The last date for ratings ({fmtDate(info.review_by)}) has passed. Please contact HR if you still need to rate.</p>
              )}
            </div>
            {info.evaluated && info.trainees.map((t) => (
              <TraineeCard key={t.id} t={t} token={token} canReview={info.can_review} onSaved={load} />
            ))}
          </>
        )}
        <p className="text-center text-xs text-slate-500">RDC Concrete (India) Ltd</p>
      </div>
    </div>
  );
}
