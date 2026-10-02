import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileUp, Loader2, AlertCircle, Clock } from 'lucide-react';
import { withBase } from '../basePath';
import { ACCEPT, MAX_MB, api, fileToUpload, fmtDate, fmtDateTime, useApi } from './reports/api';

/** A trainee's own link: upload (or replace) this month's report until the last date. */
export default function TraineeReport() {
  const { token } = useParams();
  const { data: info, error, reload: load } = useApi(`/api/report/${token}`);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [justSent, setJustSent] = useState(false);
  const inputRef = useRef(null);

  const choose = (f) => {
    setUploadError(null);
    setJustSent(false);
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setFile(null);
      return setUploadError(`This file is larger than ${MAX_MB} MB. Please reduce it (or take a smaller photo) and try again.`);
    }
    setFile(f || null);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api(`/api/report/${token}/upload`, { method: 'POST', body: await fileToUpload(file) });
      setFile(null);
      setJustSent(true);
      load();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-800">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex justify-center">
          <img src={withBase('/rdc_logo.png')} alt="RDC" className="h-14 object-contain" />
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          {error ? (
            <div className="flex items-start gap-3 text-red-700"><AlertCircle className="mt-0.5 shrink-0" /> <p>{error}</p></div>
          ) : !info ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
          ) : (
            <>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{info.track} monthly report</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">{info.period_label}</h1>
              <p className="mt-3 text-slate-600">Hello <strong>{info.trainee_name}</strong> ({info.trainee_code}).</p>
              <p className={`mt-2 flex items-center gap-2 text-sm ${info.can_upload ? 'text-slate-600' : 'text-red-700'}`}>
                <Clock size={16} />
                {info.can_upload ? <>Last date: <strong>{fmtDate(info.deadline)}</strong></> : <>The last date ({fmtDate(info.deadline)}) has passed.</>}
              </p>

              {info.submitted && (
                <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" />
                  <div className="text-sm">
                    <p className="font-semibold">{justSent ? 'Thank you — your report has been received.' : 'Your report has been received.'}</p>
                    <p className="mt-1 break-all">{info.submitted.file_name} · {fmtDateTime(info.submitted.submitted_at)}</p>
                    {info.can_upload && <p className="mt-1 text-emerald-800">You can replace it with a new file until the last date.</p>}
                  </div>
                </div>
              )}

              {info.can_upload ? (
                <div className="mt-6">
                  <button type="button" onClick={() => inputRef.current?.click()}
                          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-slate-600 hover:border-emerald-500 hover:bg-emerald-50">
                    <FileUp size={32} className="text-emerald-600" />
                    <span className="font-semibold">{file ? file.name : info.submitted ? 'Choose a new file' : 'Choose your report'}</span>
                    <span className="text-xs text-slate-500">PDF, Word (.docx) or a photo · up to {MAX_MB} MB</span>
                  </button>
                  <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
                  {uploadError && <p className="mt-3 flex items-start gap-2 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {uploadError}</p>}
                  <button onClick={upload} disabled={!file || uploading}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                    {uploading ? <><Loader2 className="animate-spin" size={18} /> Uploading…</> : info.submitted ? 'Replace my report' : 'Upload my report'}
                  </button>
                </div>
              ) : !info.submitted && (
                <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">No report was received. Please contact HR if you still need to submit it.</p>
              )}
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">RDC Concrete (India) Ltd</p>
      </div>
    </div>
  );
}
