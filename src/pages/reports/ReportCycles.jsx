import { useState } from 'react';
import { Loader2, Plus, ChevronRight } from 'lucide-react';
import { STATUS, fmtDate, useApi } from './api';
import CycleBuilder from './CycleBuilder';
import CycleDetail from './CycleDetail';

/**
 * Monthly trainee reports for one track (Operations or Sales): HR starts a
 * cycle, trainees upload through their own link, the AI evaluates after the
 * last date, supervisors rate, and HR sends the results.
 *
 * Rendered with key={track}, so switching track starts afresh on the list.
 */
export default function ReportCycles({ track }) {
  const [view, setView] = useState({ name: 'list' });
  const { data: cycles, error, reload: load } = useApi(`/api/admin/report-cycles?track=${track}`);

  if (view.name === 'new') {
    return <CycleBuilder track={track} onCancel={() => setView({ name: 'list' })}
                         onDone={(id) => { load(); setView({ name: 'cycle', id }); }} />;
  }
  if (view.name === 'cycle') {
    return <CycleDetail cycleId={view.id} onBack={() => { load(); setView({ name: 'list' }); }} />;
  }

  const trackName = track === 'ops' ? 'Operations' : 'Sales';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">{trackName} trainee reports</h2>
          <p className="text-sm text-slate-400">Each cycle sends trainees a link to upload their monthly report, then routes the AI evaluation to their supervisor.</p>
        </div>
        <button onClick={() => setView({ name: 'new' })}
                className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500">
          <Plus size={18} /> New cycle
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {cycles === null && !error ? (
        <div className="flex justify-center p-12"><Loader2 className="animate-spin text-brand-500" size={32} /></div>
      ) : cycles?.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-12 text-center text-slate-400">
          No cycles yet. Press <strong className="text-white">New cycle</strong> to send the first links.
        </div>
      ) : cycles && (
        <div className="overflow-x-auto rounded-2xl border border-slate-700">
          <table className="w-full bg-slate-900 text-left text-sm">
            <thead className="bg-slate-950/60 text-slate-400">
              <tr>
                <th className="p-3">Month</th>
                <th className="p-3">Trainees upload by</th>
                <th className="p-3">Supervisors rate by</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center">Uploaded</th>
                <th className="p-3 text-center">Evaluated</th>
                <th className="p-3 text-center">Rated</th>
                <th className="p-3 text-center">Red flags</th>
                <th className="p-3 text-center">Results sent</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => {
                const status = STATUS[c.status] || STATUS.collecting;
                return (
                  <tr key={c.id} onClick={() => setView({ name: 'cycle', id: c.id })}
                      className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3 font-semibold text-white">{c.period_label}</td>
                    <td className="p-3 text-slate-300">{fmtDate(c.submit_by)}</td>
                    <td className="p-3 text-slate-300">{fmtDate(c.review_by)}</td>
                    <td className="p-3"><span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}>{status.label}</span></td>
                    <td className="p-3 text-center text-slate-300">{c.submitted}/{c.total}</td>
                    <td className="p-3 text-center text-slate-300">{c.evaluated}</td>
                    <td className="p-3 text-center text-slate-300">{c.rated}</td>
                    <td className={`p-3 text-center ${c.flagged ? 'font-bold text-red-400' : 'text-slate-500'}`}>{c.flagged}</td>
                    <td className="p-3 text-center text-slate-300">{c.results_sent}</td>
                    <td className="p-3 text-slate-500"><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
