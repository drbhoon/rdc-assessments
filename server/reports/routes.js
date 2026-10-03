/**
 * HTTP routes for monthly trainee report cycles.
 *
 *   /api/admin/...        HR console — behind the HR sign-in gate (nginx)
 *   /api/report/:token    the trainee's upload link — no sign-in, the token is the key
 *   /api/review/:token    the supervisor's link — likewise
 *
 * Only employee CODES come from the browser when a cycle is built; names,
 * e-mails and plants are looked up in the employee master here, so a typo in
 * the console can never send a trainee's link to the wrong address.
 */
import crypto from 'node:crypto';
import XLSX from 'xlsx';
import { ensureReportSchema } from './schema.js';
import { fetchByCodes, fetchEmployees, fetchFilterOptions, masterConfigured } from './master.js';
import { ACCEPTED_TYPES, MAX_FILE_BYTES } from './extract.js';
import {
  canUpload, evaluateCycle, notifySupervisors, processLate, remindSupervisors, remindTrainees,
  sendInvites, sendResultsForCycle, sendTraineeInviteFor, uploadDeadline,
} from './engine.js';
import { RATING_LABEL, TRACK_NAME, istDate, reportHtml, reportPdf } from './render.js';

const TRACKS = ['ops', 'sales'];
const newToken = () => crypto.randomBytes(24).toString('base64url');

/** "2026-10-15" → the last moment of that day in IST. */
function endOfDayIst(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}T23:59:59.999+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const EXTENSION_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Validates an upload body; returns { file } or { error }. */
function readUpload(body) {
  const name = String(body?.fileName || '').slice(0, 200);
  const ext = name.split('.').pop()?.toLowerCase();
  const mime = ACCEPTED_TYPES[body?.mime] ? body.mime : EXTENSION_TYPES[ext];
  if (!name || !mime) return { error: 'Please upload a PDF, Word (.docx), text file or a photo (PNG/JPG).' };
  const b64 = String(body?.data || '');
  const data = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64');
  if (!data.length) return { error: 'The file is empty.' };
  if (data.length > MAX_FILE_BYTES) return { error: 'The file is larger than 15 MB. Please reduce it and try again.' };
  return { file: { name, mime, data } };
}

/** The flags in one line, for the Excel summary. */
export function flagSummary(flags) {
  return (flags || []).map((f) => {
    const who = f.kind === 'repeat'
      ? `repeats own ${f.other.period_label} report`
      : `matches ${f.other.trainee_name} (${f.other.trainee_code})${f.other.same_cycle ? '' : `, ${f.other.period_label}`}`;
    return `${f.kind === 'repeat' ? 'Repeat' : 'Copy'} ${f.severity.toUpperCase()}: ${f.share}% ${who}`;
  }).join('; ');
}

/** What the HR console and the supervisor page show for a flag. */
const flagView = (f) => ({
  kind: f.kind,
  severity: f.severity,
  share: f.share,
  longest_run_words: f.longest_run_words,
  verdict: f.verdict,
  explanation: f.explanation,
  passages: f.passages,
  other: f.other,
});

const ASSIGNMENT_COLUMNS = `id, cycle_id, trainee_code, trainee_name, trainee_email, trainee_location, trainee_designation,
  supervisor_code, supervisor_name, supervisor_email, hr_spoc_code, hr_spoc_name, hr_spoc_email,
  reopen_until, invited_at, invite_error,
  file_name, file_mime, file_size, submitted_at, submitted_by, text_source, eval_status, eval_error,
  evaluated_at, ai_percent, ai_points, flags, supervisor_rating, supervisor_comments, reviewed_at,
  results_sent_at, results_error`;

export function mountReportRoutes({ router, adminRouter, pool }) {
  const ready = () => ensureReportSchema(pool);

  // Every route here needs Postgres; say so plainly rather than half-working.
  const guard = (handler) => async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'Monthly report cycles need a database (DATABASE_URL).' });
    try {
      await ready();
      await handler(req, res);
    } catch (err) {
      console.error('[reports] route error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message || 'Server error' });
    }
  };

  /** Runs work after the response, logging rather than crashing on failure. */
  const background = (label, fn) => {
    Promise.resolve().then(fn).catch((err) => console.error(`[reports] ${label} failed:`, err));
  };

  // ── Employee master (HR) ─────────────────────────────────────────────────

  adminRouter.get('/master/filter-options', guard(async (req, res) => {
    if (!masterConfigured()) return res.status(503).json({ error: 'Employee master is not configured.' });
    res.json(await fetchFilterOptions());
  }));

  adminRouter.get('/master/employees', guard(async (req, res) => {
    if (!masterConfigured()) return res.status(503).json({ error: 'Employee master is not configured.' });
    const employees = await fetchEmployees(req.query, true);
    res.json({ count: employees.length, employees });
  }));

  // ── Cycles (HR) ──────────────────────────────────────────────────────────

  adminRouter.get('/report-cycles', guard(async (req, res) => {
    const track = TRACKS.includes(req.query.track) ? req.query.track : null;
    const { rows } = await pool.query(
      `SELECT c.*,
              count(a.id)::int AS total,
              count(a.submitted_at)::int AS submitted,
              count(*) FILTER (WHERE a.eval_status = 'done')::int AS evaluated,
              count(a.supervisor_rating)::int AS rated,
              count(*) FILTER (WHERE jsonb_array_length(a.flags) > 0)::int AS flagged,
              count(a.results_sent_at)::int AS results_sent
         FROM report_cycles c LEFT JOIN report_assignments a ON a.cycle_id = c.id
        ${track ? 'WHERE c.track = $1' : ''}
        GROUP BY c.id ORDER BY c.created_at DESC`,
      track ? [track] : [],
    );
    res.json(rows);
  }));

  /**
   * Builds cycle rows from { code, supervisor_code, hr_spoc_code } entries,
   * resolving every person in the master. Returns { rows } or { error }
   * naming who is wrong.
   */
  async function resolvePeople(trainees) {
    if (!Array.isArray(trainees) || !trainees.length) return { error: 'Select at least one trainee.' };
    const seen = new Set();
    for (const t of trainees) {
      if (!t?.code) return { error: 'A trainee has no employee code.' };
      if (seen.has(t.code)) return { error: `${t.code} is selected twice.` };
      seen.add(t.code);
      if (!t.supervisor_code) return { error: `Assign a supervisor to every trainee (missing for ${t.code}).` };
      if (t.supervisor_code === t.code) return { error: `${t.code} cannot supervise themselves.` };
      if (!t.hr_spoc_code) return { error: `Assign an HR SPOC to every trainee (missing for ${t.code}).` };
      if (t.hr_spoc_code === t.code) return { error: `${t.code} cannot be their own HR SPOC.` };
    }
    const people = await fetchByCodes(trainees.flatMap((t) => [t.code, t.supervisor_code, t.hr_spoc_code]));
    const problems = [];
    const rows = [];
    for (const t of trainees) {
      const e = people.get(t.code);
      const s = people.get(t.supervisor_code);
      const h = people.get(t.hr_spoc_code);
      if (!e) { problems.push(`${t.code} is not in the employee master`); continue; }
      if (!s) { problems.push(`supervisor ${t.supervisor_code} is not in the employee master`); continue; }
      if (!h) { problems.push(`HR SPOC ${t.hr_spoc_code} is not in the employee master`); continue; }
      if (!e.official_email_id) problems.push(`${e.employee_name} (${e.employee_code}) has no e-mail in the master`);
      if (!s.official_email_id) problems.push(`supervisor ${s.employee_name} (${s.employee_code}) has no e-mail in the master`);
      rows.push({ e, s, h });
    }
    if (problems.length) return { error: `Cannot send: ${[...new Set(problems)].join('; ')}.` };
    return { rows };
  }

  async function insertPeople(client, cycleId, rows) {
    for (const { e, s, h } of rows) {
      await client.query(
        `INSERT INTO report_assignments
           (cycle_id, token, trainee_code, trainee_name, trainee_email, trainee_location, trainee_designation,
            person_id, supervisor_code, supervisor_name, supervisor_email,
            hr_spoc_code, hr_spoc_name, hr_spoc_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [cycleId, newToken(), e.employee_code, e.employee_name, e.official_email_id.toLowerCase(),
          e.location || null, e.designation || null, e.person_id ? String(e.person_id) : null,
          s.employee_code, s.employee_name, s.official_email_id.toLowerCase(),
          h.employee_code, h.employee_name, h.official_email_id ? h.official_email_id.toLowerCase() : null],
      );
      await client.query(
        `INSERT INTO report_supervisors (cycle_id, supervisor_code, supervisor_name, supervisor_email, token)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cycle_id, supervisor_code) DO NOTHING`,
        [cycleId, s.employee_code, s.employee_name, s.official_email_id.toLowerCase(), newToken()],
      );
    }
  }

  adminRouter.post('/report-cycles', guard(async (req, res) => {
    const { track, period_label, trainees } = req.body || {};
    if (!TRACKS.includes(track)) return res.status(400).json({ error: 'Choose Operations or Sales.' });
    const period = String(period_label || '').trim().slice(0, 60);
    if (!period) return res.status(400).json({ error: 'Name the month the reports cover, e.g. "September 2026".' });
    const submitBy = endOfDayIst(req.body.submit_by);
    const reviewBy = endOfDayIst(req.body.review_by);
    if (!submitBy) return res.status(400).json({ error: 'Choose the last date for trainees to upload.' });
    if (!reviewBy) return res.status(400).json({ error: 'Choose the last date for supervisors to rate.' });
    if (submitBy < new Date()) return res.status(400).json({ error: 'The last date for trainees is already past.' });
    if (reviewBy <= submitBy) return res.status(400).json({ error: "The supervisors' date must be after the trainees' date." });
    if (!masterConfigured()) return res.status(503).json({ error: 'Employee master is not configured.' });

    const resolved = await resolvePeople(trainees);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const client = await pool.connect();
    let cycleId;
    try {
      await client.query('BEGIN');
      const { rows: [cycle] } = await client.query(
        `INSERT INTO report_cycles (track, period_label, submit_by, review_by, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [track, period, submitBy, reviewBy, req.hrEmail || null],
      );
      cycleId = cycle.id;
      await insertPeople(client, cycleId, resolved.rows);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    background(`invites for cycle ${cycleId}`, () => sendInvites(pool, cycleId));
    res.json({ id: cycleId, trainees: resolved.rows.length });
  }));

  async function loadCycle(id) {
    const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [id]);
    return cycle || null;
  }

  adminRouter.get('/report-cycles/:id', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    const { rows: assignments } = await pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM report_assignments WHERE cycle_id = $1 ORDER BY trainee_name`,
      [cycle.id],
    );
    const { rows: supervisors } = await pool.query(
      `SELECT id, supervisor_code, supervisor_name, supervisor_email, notified_at, notify_error, reminded_at
         FROM report_supervisors WHERE cycle_id = $1 ORDER BY supervisor_name`,
      [cycle.id],
    );
    const now = new Date();
    res.json({
      cycle,
      supervisors,
      assignments: assignments.map((a) => ({
        ...a,
        flags: (a.flags || []).map(flagView),
        upload_deadline: uploadDeadline(a, cycle),
        can_upload: canUpload(a, cycle, now),
      })),
    });
  }));

  adminRouter.patch('/report-cycles/:id', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    const sets = [];
    const params = [cycle.id];
    const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)); };

    if (req.body.period_label !== undefined) {
      const period = String(req.body.period_label || '').trim().slice(0, 60);
      if (!period) return res.status(400).json({ error: 'The month cannot be blank.' });
      add('period_label = ?', period);
    }
    let submitBy = new Date(cycle.submit_by);
    if (req.body.submit_by !== undefined) {
      if (cycle.status !== 'collecting') {
        return res.status(400).json({ error: 'Reports are already evaluated. Reopen individual trainees instead.' });
      }
      submitBy = endOfDayIst(req.body.submit_by);
      if (!submitBy) return res.status(400).json({ error: 'Invalid date for trainees.' });
      add('submit_by = ?', submitBy);
      // A later date earns a fresh reminder.
      if (submitBy > new Date(cycle.submit_by)) sets.push('trainees_reminded_at = NULL');
    }
    if (req.body.review_by !== undefined) {
      const reviewBy = endOfDayIst(req.body.review_by);
      if (!reviewBy) return res.status(400).json({ error: 'Invalid date for supervisors.' });
      if (reviewBy <= submitBy) return res.status(400).json({ error: "The supervisors' date must be after the trainees' date." });
      add('review_by = ?', reviewBy);
      if (reviewBy > new Date(cycle.review_by)) sets.push('supervisors_reminded_at = NULL');
    }
    if (!sets.length) return res.json({ ok: true });
    await pool.query(`UPDATE report_cycles SET ${sets.join(', ')} WHERE id = $1`, params);
    res.json({ ok: true });
  }));

  adminRouter.delete('/report-cycles/:id', guard(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM report_cycles WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Cycle not found.' });
    res.json({ ok: true });
  }));

  adminRouter.post('/report-cycles/:id/trainees', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    if (cycle.status !== 'collecting') return res.status(400).json({ error: 'Trainees can be added only before the reports are evaluated.' });
    const { rows: existing } = await pool.query('SELECT trainee_code FROM report_assignments WHERE cycle_id = $1', [cycle.id]);
    const already = new Set(existing.map((r) => r.trainee_code));
    const dupes = (req.body.trainees || []).filter((t) => already.has(t?.code)).map((t) => t.code);
    if (dupes.length) return res.status(400).json({ error: `Already in this cycle: ${dupes.join(', ')}.` });

    const resolved = await resolvePeople(req.body.trainees);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const client = await pool.connect();
    let ids;
    try {
      await client.query('BEGIN');
      await insertPeople(client, cycle.id, resolved.rows);
      const { rows } = await client.query(
        'SELECT id FROM report_assignments WHERE cycle_id = $1 AND trainee_code = ANY($2)',
        [cycle.id, resolved.rows.map((r) => r.e.employee_code)],
      );
      ids = rows.map((r) => r.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    background(`invites for cycle ${cycle.id}`, () => sendInvites(pool, cycle.id, { onlyIds: ids }));
    res.json({ added: ids.length });
  }));

  async function loadAssignment(req) {
    const { rows: [a] } = await pool.query(
      'SELECT * FROM report_assignments WHERE id = $1 AND cycle_id = $2',
      [req.params.aid, req.params.id],
    );
    return a || null;
  }

  adminRouter.patch('/report-cycles/:id/trainees/:aid', guard(async (req, res) => {
    const a = await loadAssignment(req);
    if (!a) return res.status(404).json({ error: 'Trainee not found in this cycle.' });

    // HR SPOC: a name on the report and in the Excel, nothing more — so
    // changing it touches no rating and sends no e-mail.
    if (req.body?.hr_spoc_code !== undefined) {
      const spoc = String(req.body.hr_spoc_code || '');
      if (!spoc) return res.status(400).json({ error: 'Choose an HR SPOC.' });
      if (spoc === a.trainee_code) return res.status(400).json({ error: 'A trainee cannot be their own HR SPOC.' });
      const h = (await fetchByCodes([spoc])).get(spoc);
      if (!h) return res.status(400).json({ error: `${spoc} is not in the employee master.` });
      await pool.query(
        'UPDATE report_assignments SET hr_spoc_code = $2, hr_spoc_name = $3, hr_spoc_email = $4 WHERE id = $1',
        [a.id, h.employee_code, h.employee_name, h.official_email_id ? h.official_email_id.toLowerCase() : null],
      );
      return res.json({ ok: true });
    }

    const code = String(req.body?.supervisor_code || '');
    if (!code) return res.status(400).json({ error: 'Choose a supervisor.' });
    if (code === a.trainee_code) return res.status(400).json({ error: 'A trainee cannot supervise themselves.' });
    const people = await fetchByCodes([code]);
    const s = people.get(code);
    if (!s) return res.status(400).json({ error: `${code} is not in the employee master.` });
    if (!s.official_email_id) return res.status(400).json({ error: `${s.employee_name} has no e-mail in the master.` });
    await pool.query(
      `INSERT INTO report_supervisors (cycle_id, supervisor_code, supervisor_name, supervisor_email, token)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cycle_id, supervisor_code) DO NOTHING`,
      [a.cycle_id, s.employee_code, s.employee_name, s.official_email_id.toLowerCase(), newToken()],
    );
    await pool.query(
      `UPDATE report_assignments SET supervisor_code = $2, supervisor_name = $3, supervisor_email = $4,
              supervisor_rating = NULL, supervisor_comments = NULL, reviewed_at = NULL
        WHERE id = $1`,
      [a.id, s.employee_code, s.employee_name, s.official_email_id.toLowerCase()],
    );
    // If the reports are already out for review, the new supervisor hears now.
    background(`supervisor notice for cycle ${a.cycle_id}`, () => notifySupervisors(pool, a.cycle_id));
    res.json({ ok: true });
  }));

  adminRouter.delete('/report-cycles/:id/trainees/:aid', guard(async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM report_assignments WHERE id = $1 AND cycle_id = $2',
      [req.params.aid, req.params.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Trainee not found in this cycle.' });
    res.json({ ok: true });
  }));

  /** Stores an upload and, if the cycle is already evaluated, evaluates it now. */
  async function storeUpload(a, file, by) {
    await pool.query(
      `UPDATE report_assignments
          SET file_name = $2, file_mime = $3, file_size = $4, file_data = $5,
              submitted_at = now(), submitted_by = $6,
              report_text = NULL, text_source = NULL,
              eval_status = 'pending', eval_error = NULL, evaluated_at = NULL,
              ai_result = NULL, ai_percent = NULL, ai_points = NULL
        WHERE id = $1`,
      [a.id, file.name, file.mime, file.data.length, file.data, by],
    );
    background(`late evaluation of ${a.id}`, () => processLate(pool, a.id));
  }

  adminRouter.post('/report-cycles/:id/trainees/:aid/upload', guard(async (req, res) => {
    const a = await loadAssignment(req);
    if (!a) return res.status(404).json({ error: 'Trainee not found in this cycle.' });
    const { file, error } = readUpload(req.body);
    if (error) return res.status(400).json({ error });
    await storeUpload(a, file, `hr:${req.hrEmail || 'console'}`);
    res.json({ ok: true });
  }));

  adminRouter.post('/report-cycles/:id/trainees/:aid/reopen', guard(async (req, res) => {
    const a = await loadAssignment(req);
    if (!a) return res.status(404).json({ error: 'Trainee not found in this cycle.' });
    const until = endOfDayIst(req.body?.until);
    if (!until || until < new Date()) return res.status(400).json({ error: 'Choose a date from today onwards.' });
    await pool.query('UPDATE report_assignments SET reopen_until = $2 WHERE id = $1', [a.id, until]);
    let mailed = null;
    if (req.body?.notify !== false) {
      const cycle = await loadCycle(a.cycle_id);
      mailed = await sendTraineeInviteFor(pool, { ...a, reopen_until: until }, cycle, 'reopen');
    }
    res.json({ ok: true, mailed });
  }));

  adminRouter.post('/report-cycles/:id/trainees/:aid/resend-invite', guard(async (req, res) => {
    const a = await loadAssignment(req);
    if (!a) return res.status(404).json({ error: 'Trainee not found in this cycle.' });
    const cycle = await loadCycle(a.cycle_id);
    const mailed = await sendTraineeInviteFor(pool, a, cycle, 'invite');
    if (!mailed.ok) return res.status(502).json({ error: mailed.error });
    res.json({ ok: true });
  }));

  adminRouter.post('/report-cycles/:id/trainees/:aid/re-evaluate', guard(async (req, res) => {
    const a = await loadAssignment(req);
    if (!a) return res.status(404).json({ error: 'Trainee not found in this cycle.' });
    if (!a.submitted_at) return res.status(400).json({ error: 'Nothing has been uploaded yet.' });
    const cycle = await loadCycle(a.cycle_id);
    if (cycle.status !== 'reviewing') return res.status(400).json({ error: 'The cycle has not been evaluated yet.' });
    await pool.query(`UPDATE report_assignments SET eval_status = 'pending', eval_error = NULL WHERE id = $1`, [a.id]);
    background(`re-evaluation of ${a.id}`, () => processLate(pool, a.id));
    res.json({ ok: true });
  }));

  adminRouter.post('/report-cycles/:id/evaluate', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    if (cycle.status === 'reviewing') return res.status(400).json({ error: 'Already evaluated.' });
    await pool.query(`UPDATE report_cycles SET status = 'evaluating' WHERE id = $1 AND status = 'collecting'`, [cycle.id]);
    background(`evaluation of cycle ${cycle.id}`, () => evaluateCycle(pool, cycle.id));
    res.json({ ok: true });
  }));

  adminRouter.post('/report-cycles/:id/remind', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    const who = req.body?.who;
    if (who === 'trainees') return res.json(await remindTrainees(pool, cycle.id));
    if (who === 'supervisors') return res.json(await remindSupervisors(pool, cycle.id));
    res.status(400).json({ error: 'Remind trainees or supervisors?' });
  }));

  adminRouter.post('/report-cycles/:id/send-results', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    const includeUnrated = Boolean(req.body?.include_unrated);
    const { rows: [{ n }] } = await pool.query(
      `SELECT count(*)::int AS n FROM report_assignments
        WHERE cycle_id = $1 AND eval_status = 'done' AND results_sent_at IS NULL
          ${includeUnrated ? '' : 'AND supervisor_rating IS NOT NULL'}`,
      [cycle.id],
    );
    if (!n) return res.status(400).json({ error: 'Nobody is waiting for results.' });
    background(`results for cycle ${cycle.id}`, () => sendResultsForCycle(pool, cycle.id, { includeUnrated }));
    res.json({ queued: n });
  }));

  adminRouter.get('/report-cycles/:id/summary.xlsx', guard(async (req, res) => {
    const cycle = await loadCycle(req.params.id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found.' });
    const { rows } = await pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM report_assignments WHERE cycle_id = $1 ORDER BY trainee_name`,
      [cycle.id],
    );
    const sheet = rows.map((a) => ({
      'Report month': cycle.period_label,
      Date: a.submitted_at ? istDate(a.submitted_at) : 'Not submitted',
      'Trainee Emp Code': a.trainee_code,
      Name: a.trainee_name,
      'Plant location': a.trainee_location || '',
      'Supervisor name': a.supervisor_name,
      'HR SPOC': a.hr_spoc_name || '',
      'AI score (%)': a.ai_percent === null ? '' : Number(a.ai_percent),
      'AI points (/30)': a.ai_points === null ? '' : Number(a.ai_points),
      'AI flags': flagSummary(a.flags),
      'Supervisor score (/5)': a.supervisor_rating ?? '',
      'Supervisor rating': a.supervisor_rating ? RATING_LABEL[a.supervisor_rating] : '',
      'Supervisor comments': a.supervisor_comments || '',
      'Results e-mailed': a.results_sent_at ? istDate(a.results_sent_at) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheet);
    ws['!cols'] = [14, 14, 16, 26, 22, 26, 24, 12, 14, 60, 12, 14, 50, 16].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const name = `${TRACK_NAME[cycle.track]}_Trainee_Reports_${cycle.period_label}`.replace(/[^A-Za-z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(buffer);
  }));

  // ── One trainee's documents (HR) ─────────────────────────────────────────

  async function assignmentWithCycle(id) {
    const { rows: [a] } = await pool.query('SELECT * FROM report_assignments WHERE id = $1', [id]);
    if (!a) return {};
    return { a, cycle: await loadCycle(a.cycle_id) };
  }

  function sendFile(res, a) {
    if (!a.file_data) return res.status(404).json({ error: 'Nothing uploaded.' });
    res.setHeader('Content-Type', a.file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.file_name || 'report')}"`);
    res.send(a.file_data);
  }

  async function sendPdf(res, a, cycle, withSupervisor) {
    if (!a.ai_result) return res.status(404).json({ error: 'Not evaluated yet.' });
    const pdf = await reportPdf(a, cycle, { withSupervisor });
    const name = `AI_Evaluation_${a.trainee_code}_${cycle.period_label}`.replace(/[^A-Za-z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.send(pdf);
  }

  adminRouter.get('/report-assignments/:aid/file', guard(async (req, res) => {
    const { a } = await assignmentWithCycle(req.params.aid);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    sendFile(res, a);
  }));

  adminRouter.get('/report-assignments/:aid/report.pdf', guard(async (req, res) => {
    const { a, cycle } = await assignmentWithCycle(req.params.aid);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    await sendPdf(res, a, cycle, true);
  }));

  adminRouter.get('/report-assignments/:aid/report-html', guard(async (req, res) => {
    const { a, cycle } = await assignmentWithCycle(req.params.aid);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    if (!a.ai_result) return res.status(404).json({ error: 'Not evaluated yet.' });
    res.json({ html: reportHtml(a, cycle, { withSupervisor: true }) });
  }));

  // ── Trainee link (public) ────────────────────────────────────────────────

  async function byTraineeToken(token) {
    const { rows: [a] } = await pool.query('SELECT * FROM report_assignments WHERE token = $1', [String(token)]);
    if (!a) return {};
    return { a, cycle: await loadCycle(a.cycle_id) };
  }

  router.get('/api/report/:token', guard(async (req, res) => {
    const { a, cycle } = await byTraineeToken(req.params.token);
    if (!a) return res.status(404).json({ error: 'This link is not valid. Please check it, or ask HR for a new one.' });
    res.json({
      trainee_name: a.trainee_name,
      trainee_code: a.trainee_code,
      track: TRACK_NAME[cycle.track],
      period_label: cycle.period_label,
      deadline: uploadDeadline(a, cycle),
      can_upload: canUpload(a, cycle),
      submitted: a.submitted_at ? { file_name: a.file_name, submitted_at: a.submitted_at, file_size: a.file_size } : null,
    });
  }));

  router.post('/api/report/:token/upload', guard(async (req, res) => {
    const { a, cycle } = await byTraineeToken(req.params.token);
    if (!a) return res.status(404).json({ error: 'This link is not valid.' });
    if (!canUpload(a, cycle)) return res.status(403).json({ error: 'The last date for this report has passed. Please contact HR.' });
    const { file, error } = readUpload(req.body);
    if (error) return res.status(400).json({ error });
    await storeUpload(a, file, 'trainee');
    res.json({ ok: true });
  }));

  // ── Supervisor link (public) ─────────────────────────────────────────────

  async function bySupervisorToken(token) {
    const { rows: [sup] } = await pool.query('SELECT * FROM report_supervisors WHERE token = $1', [String(token)]);
    if (!sup) return {};
    return { sup, cycle: await loadCycle(sup.cycle_id) };
  }

  const canReview = (cycle) => cycle.status === 'reviewing' && new Date() <= new Date(cycle.review_by);

  router.get('/api/review/:token', guard(async (req, res) => {
    const { sup, cycle } = await bySupervisorToken(req.params.token);
    if (!sup) return res.status(404).json({ error: 'This link is not valid. Please check it, or ask HR for a new one.' });
    const { rows } = await pool.query(
      `SELECT * FROM report_assignments WHERE cycle_id = $1 AND supervisor_code = $2 ORDER BY trainee_name`,
      [cycle.id, sup.supervisor_code],
    );
    res.json({
      supervisor_name: sup.supervisor_name,
      track: TRACK_NAME[cycle.track],
      period_label: cycle.period_label,
      review_by: cycle.review_by,
      can_review: canReview(cycle),
      evaluated: cycle.status === 'reviewing',
      trainees: rows.map((a) => ({
        id: a.id,
        trainee_name: a.trainee_name,
        trainee_code: a.trainee_code,
        trainee_location: a.trainee_location,
        trainee_designation: a.trainee_designation,
        submitted_at: a.submitted_at,
        file_name: a.file_name,
        evaluated: a.eval_status === 'done',
        ai_percent: a.ai_percent === null ? null : Number(a.ai_percent),
        ai_points: a.ai_points === null ? null : Number(a.ai_points),
        flags: (a.flags || []).map(flagView),
        report_html: a.eval_status === 'done' ? reportHtml(a, cycle) : null,
        supervisor_rating: a.supervisor_rating,
        supervisor_comments: a.supervisor_comments,
        reviewed_at: a.reviewed_at,
      })),
    });
  }));

  async function supervisedAssignment(req) {
    const { sup, cycle } = await bySupervisorToken(req.params.token);
    if (!sup) return {};
    const { rows: [a] } = await pool.query(
      'SELECT * FROM report_assignments WHERE id = $1 AND cycle_id = $2 AND supervisor_code = $3',
      [req.params.aid, cycle.id, sup.supervisor_code],
    );
    return a ? { a, cycle } : {};
  }

  router.get('/api/review/:token/:aid/file', guard(async (req, res) => {
    const { a } = await supervisedAssignment(req);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    sendFile(res, a);
  }));

  router.get('/api/review/:token/:aid/report.pdf', guard(async (req, res) => {
    const { a, cycle } = await supervisedAssignment(req);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    await sendPdf(res, a, cycle, false);
  }));

  router.post('/api/review/:token/:aid', guard(async (req, res) => {
    const { a, cycle } = await supervisedAssignment(req);
    if (!a) return res.status(404).json({ error: 'Not found.' });
    if (!canReview(cycle)) return res.status(403).json({ error: 'The last date for ratings has passed. Please contact HR.' });
    if (a.eval_status !== 'done') return res.status(400).json({ error: 'This report has not been evaluated yet.' });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
    const comments = String(req.body?.comments || '').trim().slice(0, 4000);
    if (!comments) return res.status(400).json({ error: 'Please add your comments.' });
    await pool.query(
      `UPDATE report_assignments SET supervisor_rating = $2, supervisor_comments = $3, reviewed_at = now() WHERE id = $1`,
      [a.id, rating, comments],
    );
    res.json({ ok: true });
  }));

  return { ready };
}
