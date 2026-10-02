/**
 * What happens to a monthly report cycle without anyone pressing a button:
 *
 *   collecting  trainees upload until the last date; one reminder 2 days before
 *   evaluating  after the last date: text extracted, copy/repeat flags found,
 *               each report scored by the AI
 *   reviewing   supervisors are e-mailed their link; one reminder 2 days before
 *               their deadline. Late uploads (HR reopened a trainee, or HR
 *               uploaded on their behalf) are evaluated as they arrive.
 *
 * Results go to trainees only when HR presses "Send results".
 *
 * A tick runs every few minutes. Everything it does is idempotent and stamped
 * in the database, so a restart mid-evaluation simply carries on where it
 * stopped, and nothing is ever e-mailed twice.
 */
import { evaluateReport, judgeOverlap } from './ai.js';
import { extractText } from './extract.js';
import { findOverlaps } from './similarity.js';
import { sendSupervisorNotice, sendTraineeInvite, sendResults } from './mail.js';
import { reportPdf } from './render.js';

const DAY = 24 * 60 * 60 * 1000;
const REMIND_BEFORE = 2 * DAY;

export function publicUrl() {
  const configured = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const base = String(process.env.BASE_PATH || '').replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}${base}`;
}
export const traineeLink = (token) => `${publicUrl()}/report/${token}`;
export const supervisorLink = (token) => `${publicUrl()}/review/${token}`;

/** The moment this trainee's upload closes: the cycle's date, or a later reopen. */
export function uploadDeadline(a, cycle) {
  const base = new Date(cycle.submit_by);
  const reopen = a.reopen_until ? new Date(a.reopen_until) : null;
  return reopen && reopen > base ? reopen : base;
}

export function canUpload(a, cycle, now = new Date()) {
  return now <= uploadDeadline(a, cycle);
}

const log = (...args) => console.log('[reports]', ...args);

// ── Invites ────────────────────────────────────────────────────────────────

/** Sends every trainee link in the cycle that has not gone out yet. */
export async function sendInvites(pool, cycleId, { onlyIds = null } = {}) {
  const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [cycleId]);
  if (!cycle) return { sent: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT * FROM report_assignments WHERE cycle_id = $1 AND invited_at IS NULL
       ${onlyIds ? 'AND id = ANY($2)' : ''} ORDER BY trainee_name`,
    onlyIds ? [cycleId, onlyIds] : [cycleId],
  );
  let sent = 0;
  let failed = 0;
  for (const a of rows) {
    const result = await sendTraineeInvite({ a, cycle, link: traineeLink(a.token) });
    if (result.ok) {
      sent++;
      await pool.query('UPDATE report_assignments SET invited_at = now(), invite_error = NULL WHERE id = $1', [a.id]);
    } else {
      failed++;
      await pool.query('UPDATE report_assignments SET invite_error = $2 WHERE id = $1', [a.id, result.error]);
    }
  }
  if (rows.length) log(`cycle ${cycleId}: invites sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

/** One trainee e-mail (invite, reopen) sent now, with the outcome recorded. */
export async function sendTraineeInviteFor(pool, a, cycle, kind) {
  const result = await sendTraineeInvite({ a, cycle, link: traineeLink(a.token), kind });
  await pool.query(
    result.ok
      ? 'UPDATE report_assignments SET invited_at = COALESCE(invited_at, now()), invite_error = NULL WHERE id = $1'
      : 'UPDATE report_assignments SET invite_error = $2 WHERE id = $1',
    result.ok ? [a.id] : [a.id, result.error],
  );
  return result;
}

// ── Text, flags, scores ────────────────────────────────────────────────────

/** Reads the text of every submitted report in the cycle that has none yet. */
async function extractMissing(pool, cycleId, onlyId = null) {
  const { rows } = await pool.query(
    `SELECT id, file_data, file_mime FROM report_assignments
      WHERE cycle_id = $1 AND submitted_at IS NOT NULL AND report_text IS NULL
        ${onlyId ? 'AND id = $2' : ''}`,
    onlyId ? [cycleId, onlyId] : [cycleId],
  );
  for (const a of rows) {
    try {
      const { text, source } = await extractText({ fileData: a.file_data, mime: a.file_mime });
      await pool.query('UPDATE report_assignments SET report_text = $2, text_source = $3 WHERE id = $1', [a.id, text, source]);
    } catch (err) {
      // An unreadable file still gets scored (the AI reads it visually); it
      // just cannot be compared, which the flags column records.
      log(`assignment ${a.id}: text extraction failed — ${err.message}`);
      await pool.query(`UPDATE report_assignments SET report_text = '', text_source = 'none' WHERE id = $1`, [a.id]);
    }
  }
}

const label = (r) => `${r.trainee_name} (${r.trainee_code}), ${r.period_label}`;

/**
 * Recomputes the copy/repeat flags for every report in the cycle.
 *
 * Compared against: every other report in this cycle, and every report of the
 * same track from earlier cycles — a junior copying a senior's old report is
 * as much a copy as two juniors sharing one this month.
 */
export async function refreshFlags(pool, cycle) {
  const { rows: corpus } = await pool.query(
    `SELECT a.id, a.cycle_id, a.trainee_code, a.trainee_name, a.report_text, c.period_label
       FROM report_assignments a JOIN report_cycles c ON c.id = a.cycle_id
      WHERE c.track = $1 AND c.id <= $2 AND a.submitted_at IS NOT NULL
        AND COALESCE(a.report_text, '') <> ''`,
    [cycle.track, cycle.id],
  );
  const byId = new Map(corpus.map((r) => [r.id, r]));
  const subjects = corpus.filter((r) => r.cycle_id === cycle.id);
  const docs = (list) => list.map((r) => ({ id: r.id, owner: r.trainee_code, text: r.report_text }));
  const candidates = findOverlaps(docs(subjects), docs(corpus));

  const { rows: cached } = await pool.query(
    'SELECT * FROM report_overlap_judgements WHERE subject_id = ANY($1)',
    [subjects.map((s) => s.id)],
  );
  const judged = new Map(cached.map((j) => [`${j.subject_id}:${j.other_id}`, j]));

  const flags = new Map(subjects.map((s) => [s.id, []]));
  for (const c of candidates) {
    const subject = byId.get(c.subjectId);
    const other = byId.get(c.otherId);
    const fingerprint = `${c.share}|${c.longestRunWords}`;
    const key = `${c.subjectId}:${c.otherId}`;
    let verdict;
    let explanation;
    const prior = judged.get(key);
    if (prior && prior.fingerprint === fingerprint) {
      ({ verdict, explanation } = prior);
    } else {
      try {
        ({ verdict, explanation } = await judgeOverlap(c, { subject: label(subject), other: label(other) }));
        await pool.query(
          `INSERT INTO report_overlap_judgements (subject_id, other_id, fingerprint, verdict, explanation)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (subject_id, other_id) DO UPDATE
             SET fingerprint = EXCLUDED.fingerprint, verdict = EXCLUDED.verdict,
                 explanation = EXCLUDED.explanation, judged_at = now()`,
          [c.subjectId, c.otherId, fingerprint, verdict, explanation],
        );
      } catch (err) {
        // Not stored, so the next refresh asks again. Meanwhile HR sees the
        // flag: a measured overlap is not hidden because the AI was busy.
        log(`overlap ${key}: AI check failed — ${err.message}`);
        verdict = 'unverified';
        explanation = `Measured overlap of ${c.share}%. The AI check could not run; please compare the two reports.`;
      }
    }
    if (verdict === 'template' || verdict === 'coincidental') continue;
    flags.get(c.subjectId).push({
      kind: c.kind,
      severity: c.severity,
      share: c.share,
      longest_run_words: c.longestRunWords,
      verdict,
      explanation,
      passages: c.passages,
      other: {
        assignment_id: other.id,
        cycle_id: other.cycle_id,
        trainee_code: other.trainee_code,
        trainee_name: other.trainee_name,
        period_label: other.period_label,
        same_cycle: other.cycle_id === cycle.id,
      },
    });
  }

  for (const [id, list] of flags) {
    list.sort((x, y) => y.share - x.share);
    await pool.query(
      'UPDATE report_assignments SET flags = $2::jsonb, flags_checked_at = now() WHERE id = $1',
      [id, JSON.stringify(list)],
    );
  }
  return candidates.length;
}

/** Scores one report with the AI and stores the result. */
export async function evaluateAssignment(pool, cycle, id) {
  const { rows: [a] } = await pool.query(
    'SELECT id, file_data, file_mime, report_text FROM report_assignments WHERE id = $1 AND submitted_at IS NOT NULL',
    [id],
  );
  if (!a) return false;
  try {
    const result = await evaluateReport(cycle.track, { fileData: a.file_data, mime: a.file_mime, text: a.report_text });
    await pool.query(
      `UPDATE report_assignments
          SET ai_result = $2::jsonb, ai_percent = $3, ai_points = $4,
              eval_status = 'done', eval_error = NULL, evaluated_at = now()
        WHERE id = $1`,
      [id, JSON.stringify(result), result.percent, result.points],
    );
    return true;
  } catch (err) {
    log(`assignment ${id}: evaluation failed — ${err.message}`);
    await pool.query(
      `UPDATE report_assignments SET eval_status = 'failed', eval_error = $2 WHERE id = $1`,
      [id, String(err.message || err).slice(0, 500)],
    );
    return false;
  }
}

// ── The cycle-level run ────────────────────────────────────────────────────

const running = new Set();

/**
 * Evaluates every submitted report in a cycle, then e-mails the supervisors.
 * Safe to call repeatedly: a second call while one is running returns at
 * once, and each step skips work already done.
 */
export async function evaluateCycle(pool, cycleId) {
  const key = `cycle:${cycleId}`;
  if (running.has(key)) return { started: false };
  running.add(key);
  try {
    const { rows: [cycle] } = await pool.query(
      `UPDATE report_cycles
          SET status = 'evaluating', eval_started_at = COALESCE(eval_started_at, now()), eval_heartbeat_at = now()
        WHERE id = $1 AND status IN ('collecting', 'evaluating')
        RETURNING *`,
      [cycleId],
    );
    if (!cycle) return { started: false };
    log(`cycle ${cycleId}: evaluating`);

    const beat = () => pool.query('UPDATE report_cycles SET eval_heartbeat_at = now() WHERE id = $1', [cycleId]);

    await extractMissing(pool, cycleId);
    await beat();
    await refreshFlags(pool, cycle);
    await beat();

    const { rows: todo } = await pool.query(
      `SELECT id FROM report_assignments
        WHERE cycle_id = $1 AND submitted_at IS NOT NULL AND eval_status <> 'done' ORDER BY id`,
      [cycleId],
    );
    for (const { id } of todo) {
      await evaluateAssignment(pool, cycle, id);
      await beat();
    }

    await pool.query(`UPDATE report_cycles SET status = 'reviewing', evaluated_at = now() WHERE id = $1`, [cycleId]);
    log(`cycle ${cycleId}: evaluated ${todo.length} report(s)`);
    await notifySupervisors(pool, cycleId);
    return { started: true };
  } finally {
    running.delete(key);
  }
}

/**
 * A report that arrived after the cycle was evaluated — a reopened trainee,
 * or HR uploading on their behalf. Flags are recomputed for the whole cycle
 * (the newcomer may match someone already evaluated), then the one report is
 * scored, and its supervisor told if they have not heard yet.
 */
export async function processLate(pool, assignmentId) {
  const key = `late:${assignmentId}`;
  if (running.has(key)) return;
  running.add(key);
  try {
    const { rows: [row] } = await pool.query(
      `SELECT a.id, a.cycle_id FROM report_assignments a JOIN report_cycles c ON c.id = a.cycle_id
        WHERE a.id = $1 AND c.status = 'reviewing' AND a.submitted_at IS NOT NULL`,
      [assignmentId],
    );
    if (!row) return;
    const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [row.cycle_id]);
    await extractMissing(pool, cycle.id, assignmentId);
    await refreshFlags(pool, cycle);
    await evaluateAssignment(pool, cycle, assignmentId);
    await notifySupervisors(pool, cycle.id);
  } finally {
    running.delete(key);
  }
}

// ── Supervisors ────────────────────────────────────────────────────────────

/** First notice to each supervisor who has at least one evaluated report. */
export async function notifySupervisors(pool, cycleId) {
  const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [cycleId]);
  const { rows: sups } = await pool.query(
    'SELECT * FROM report_supervisors WHERE cycle_id = $1 AND notified_at IS NULL',
    [cycleId],
  );
  for (const sup of sups) {
    const { rows: trainees } = await pool.query(
      `SELECT trainee_name, trainee_code, trainee_location FROM report_assignments
        WHERE cycle_id = $1 AND supervisor_code = $2 AND eval_status = 'done' ORDER BY trainee_name`,
      [cycleId, sup.supervisor_code],
    );
    if (!trainees.length) continue;
    const result = await sendSupervisorNotice({ sup, cycle, trainees, link: supervisorLink(sup.token) });
    await pool.query(
      result.ok
        ? 'UPDATE report_supervisors SET notified_at = now(), notify_error = NULL WHERE id = $1'
        : 'UPDATE report_supervisors SET notify_error = $2 WHERE id = $1',
      result.ok ? [sup.id] : [sup.id, result.error],
    );
  }
}

/** Reminder to supervisors with evaluated reports they have not yet rated. */
export async function remindSupervisors(pool, cycleId, { automatic = false } = {}) {
  const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [cycleId]);
  // The automatic reminder skips anyone whose first notice is under a day old;
  // HR pressing "Remind now" reaches everyone with something outstanding.
  const { rows: sups } = await pool.query(
    `SELECT * FROM report_supervisors WHERE cycle_id = $1 AND notified_at IS NOT NULL
       ${automatic ? "AND notified_at <= now() - interval '1 day'" : ''}`,
    [cycleId],
  );
  let sent = 0;
  for (const sup of sups) {
    const { rows: trainees } = await pool.query(
      `SELECT trainee_name, trainee_code, trainee_location FROM report_assignments
        WHERE cycle_id = $1 AND supervisor_code = $2 AND eval_status = 'done' AND supervisor_rating IS NULL
        ORDER BY trainee_name`,
      [cycleId, sup.supervisor_code],
    );
    if (!trainees.length) continue;
    const result = await sendSupervisorNotice({ sup, cycle, trainees, link: supervisorLink(sup.token), kind: 'reminder' });
    if (result.ok) {
      sent++;
      await pool.query('UPDATE report_supervisors SET reminded_at = now() WHERE id = $1', [sup.id]);
    } else {
      await pool.query('UPDATE report_supervisors SET notify_error = $2 WHERE id = $1', [sup.id, result.error]);
    }
  }
  await pool.query('UPDATE report_cycles SET supervisors_reminded_at = now() WHERE id = $1', [cycleId]);
  return { sent };
}

/** Reminder to trainees who were invited and have not uploaded. */
export async function remindTrainees(pool, cycleId) {
  const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [cycleId]);
  const { rows } = await pool.query(
    `SELECT * FROM report_assignments
      WHERE cycle_id = $1 AND submitted_at IS NULL AND invited_at IS NOT NULL ORDER BY trainee_name`,
    [cycleId],
  );
  let sent = 0;
  for (const a of rows) {
    if (!canUpload(a, cycle)) continue;
    const result = await sendTraineeInvite({ a, cycle, link: traineeLink(a.token), kind: 'reminder' });
    if (result.ok) sent++;
    else await pool.query('UPDATE report_assignments SET invite_error = $2 WHERE id = $1', [a.id, result.error]);
  }
  await pool.query('UPDATE report_cycles SET trainees_reminded_at = now() WHERE id = $1', [cycleId]);
  return { sent };
}

// ── Results to trainees ────────────────────────────────────────────────────

/**
 * E-mails each evaluated trainee their AI report (PDF) and supervisor rating.
 * Only reports the supervisor has rated, unless HR chooses to include the rest.
 * Never re-sends to anyone already sent.
 */
export async function sendResultsForCycle(pool, cycleId, { includeUnrated = false } = {}) {
  const { rows: [cycle] } = await pool.query('SELECT * FROM report_cycles WHERE id = $1', [cycleId]);
  const { rows } = await pool.query(
    `SELECT * FROM report_assignments
      WHERE cycle_id = $1 AND eval_status = 'done' AND results_sent_at IS NULL
        ${includeUnrated ? '' : 'AND supervisor_rating IS NOT NULL'}
      ORDER BY trainee_name`,
    [cycleId],
  );
  let sent = 0;
  let failed = 0;
  for (const a of rows) {
    try {
      const pdf = await reportPdf(a, cycle, { withSupervisor: true });
      const result = await sendResults({ a, cycle, pdf });
      if (!result.ok) throw new Error(result.error);
      sent++;
      await pool.query('UPDATE report_assignments SET results_sent_at = now(), results_error = NULL WHERE id = $1', [a.id]);
    } catch (err) {
      failed++;
      await pool.query('UPDATE report_assignments SET results_error = $2 WHERE id = $1', [a.id, String(err.message || err)]);
    }
  }
  log(`cycle ${cycleId}: results sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

// ── The tick ───────────────────────────────────────────────────────────────

export async function tick(pool, now = new Date()) {
  // 1. Last date passed (or an evaluation interrupted by a restart): evaluate.
  const { rows: due } = await pool.query(
    `SELECT id FROM report_cycles
      WHERE (status = 'collecting' AND submit_by < $1)
         OR (status = 'evaluating')`,
    [now],
  );
  for (const { id } of due) await evaluateCycle(pool, id);

  // 2. Reports that arrived after their cycle was evaluated.
  const { rows: late } = await pool.query(
    `SELECT a.id FROM report_assignments a JOIN report_cycles c ON c.id = a.cycle_id
      WHERE c.status = 'reviewing' AND a.submitted_at IS NOT NULL AND a.eval_status = 'pending'`,
  );
  for (const { id } of late) await processLate(pool, id);

  // 3. Trainee reminder, once, two days before the last date — and only if
  //    the invite went out at least a day earlier.
  const { rows: traineeDue } = await pool.query(
    `SELECT id FROM report_cycles
      WHERE status = 'collecting' AND trainees_reminded_at IS NULL
        AND submit_by - interval '2 days' <= $1 AND submit_by > $1
        AND created_at <= $1 - interval '1 day'`,
    [now],
  );
  for (const { id } of traineeDue) await remindTrainees(pool, id);

  // 4. Supervisor reminder, once, two days before their deadline — skipped
  //    for anyone notified less than a day ago.
  const { rows: supDue } = await pool.query(
    `SELECT id FROM report_cycles
      WHERE status = 'reviewing' AND supervisors_reminded_at IS NULL
        AND review_by - interval '2 days' <= $1 AND review_by > $1`,
    [now],
  );
  for (const { id } of supDue) await remindSupervisors(pool, id, { automatic: true });
}

/** Starts the background tick. Errors are logged, never thrown. */
export function startScheduler(pool, ready) {
  const every = Number(process.env.REPORT_TICK_MS) || 5 * 60 * 1000;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await ready();
      await tick(pool);
    } catch (err) {
      log('tick failed —', err.message);
    } finally {
      busy = false;
    }
  };
  setTimeout(run, Math.min(30000, every));
  return setInterval(run, every);
}
