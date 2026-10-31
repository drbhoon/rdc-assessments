/**
 * The Recruitment Tracker's way in to Fresher and Sales interviews.
 *
 * The tracker owns the candidate; this app owns the interview. The tracker asks
 * for a link for one of its assessment records, the candidate takes the interview
 * here as usual, and on submission the answers are scored on the server and the
 * result is sent back against that record. A step that fails is retried by the
 * tick below, so a tracker or AI outage only delays a result.
 *
 * Interviews whose link was made in the HR console carry no tracker_ref and are
 * untouched by all of this.
 */
import { timingSafeEqual } from 'node:crypto';
import { TRACKS, reportHtml, scoreTranscript } from './scoring.js';

const MAX_SCORING_ATTEMPTS = 5;
const TICK_MS = () => Number(process.env.RECRUITMENT_TICK_MS) || 3 * 60 * 1000;

const trim = (s) => String(s || '').replace(/\/$/, '');
const publicUrl = () => trim(process.env.PUBLIC_URL) || `http://localhost:${process.env.PORT || 3000}${trim(process.env.BASE_PATH)}`;

function keyMatches(presented) {
  const expected = process.env.MASTER_API_KEY;
  if (!expected || !presented) return false; // an unset key must never mean "everyone passes"
  const a = Buffer.from(String(presented));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const log = (...args) => console.log('[recruitment]', ...args);

export async function ensureRecruitmentColumns(pool) {
  await pool.query(`
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS tracker_ref TEXT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS candidate_name TEXT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_percent NUMERIC(5,1);
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_points INT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_max INT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_verdict TEXT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_summary TEXT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS scoring_attempts INT NOT NULL DEFAULT 0;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS scoring_error TEXT;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
    ALTER TABLE interviews ADD COLUMN IF NOT EXISTS result_pushed_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS interviews_tracker_ref ON interviews (tracker_ref) WHERE tracker_ref IS NOT NULL;
  `);
}

/** What the candidate's own page may see: never the report, nor who sent the link. */
export function forCandidate(row) {
  if (!row) return row;
  const { ai_report, ai_percent, ai_points, ai_max, ai_verdict, ai_summary, tracker_ref, scoring_attempts, scoring_error, result_pushed_at, ...open } = row;
  return open;
}

const running = new Set();

/** Scores one submitted interview if it needs it, then sends the result back. */
export async function processInterview(pool, code) {
  if (running.has(code)) return;
  running.add(code);
  try {
    const { rows: [row] } = await pool.query(
      `SELECT * FROM interviews WHERE join_code = $1 AND tracker_ref IS NOT NULL AND status = 'completed' AND result_pushed_at IS NULL`,
      [code],
    );
    if (!row) return;
    let done = row;
    if (!row.ai_verdict) {
      if (row.scoring_attempts >= MAX_SCORING_ATTEMPTS) return;
      const raw = row.transcript_answers?.part_b?.raw || row.transcript_answers?.raw || '';
      try {
        const r = await scoreTranscript(row.assessment_type, raw);
        const name = row.candidate_name || r.name;
        const { rows: [saved] } = await pool.query(
          `UPDATE interviews SET ai_report = $2, ai_percent = $3, ai_points = $4, ai_max = $5, ai_verdict = $6, ai_summary = $7, scoring_error = NULL
            WHERE join_code = $1 RETURNING *`,
          [code, reportHtml(row.assessment_type, name, r), r.percent, r.points, r.max, r.verdict, r.executive_summary],
        );
        done = saved;
        log(`${code}: ${r.verdict} ${r.percent}%`);
      } catch (err) {
        log(`${code}: scoring failed — ${err.message}`);
        await pool.query(
          'UPDATE interviews SET scoring_attempts = scoring_attempts + 1, scoring_error = $2 WHERE join_code = $1',
          [code, String(err.message).slice(0, 500)],
        );
        return;
      }
    }
    await pushResult(pool, done);
  } finally {
    running.delete(code);
  }
}

async function pushResult(pool, row) {
  const base = trim(process.env.TRACKER_API_URL);
  if (!base) return; // nowhere to send it yet; the result is safe here
  const body = {
    assessment_id: row.tracker_ref,
    assessment_type: TRACKS[row.assessment_type].label,
    status: 'Completed',
    score: `${Number(row.ai_percent)}%`,
    result_summary: `${row.ai_verdict} · ${row.ai_points}/${row.ai_max} points. ${row.ai_summary || ''}`.trim(),
    report_link: `${publicUrl()}/admin/recruitment/report/${row.join_code}`,
    assessment_date: new Date(row.submitted_at || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
  };
  try {
    const res = await fetch(`${base}/api/integrations/assessment-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.MASTER_API_KEY || '' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`the tracker answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await pool.query('UPDATE interviews SET result_pushed_at = now() WHERE join_code = $1', [row.join_code]);
    log(`${row.join_code}: result sent to the tracker`);
  } catch (err) {
    log(`${row.join_code}: result not sent yet — ${err.message}`);
  }
}

export function mountRecruitmentService({ router, pool, generateCode }) {
  const ready = pool ? ensureRecruitmentColumns(pool).catch((err) => console.error('Recruitment columns:', err)) : Promise.resolve();

  // Reached over the private network by the tracker. /eval is open at nginx for
  // candidates, so the key is what guards this.
  router.post('/api/service/interviews', async (req, res) => {
    if (!keyMatches(req.get('x-service-key'))) return res.status(401).json({ error: 'Invalid service key.' });
    if (!pool) return res.status(503).json({ error: 'No database.' });
    const { assessment_type: type, tracker_ref: ref, candidate_name: name } = req.body || {};
    if (!TRACKS[type]) return res.status(400).json({ error: 'assessment_type must be recruitment or sales_recruitment.' });
    if (!ref) return res.status(400).json({ error: 'tracker_ref is required.' });
    try {
      await ready;
      // Asking twice for one assessment gives the same link, not a second interview.
      let { rows: [row] } = await pool.query('SELECT join_code, status FROM interviews WHERE tracker_ref = $1', [String(ref)]);
      for (let attempt = 0; !row && attempt < 5; attempt++) {
        try {
          ({ rows: [row] } = await pool.query(
            `INSERT INTO interviews (join_code, assessment_type, tracker_ref, candidate_name) VALUES ($1,$2,$3,$4) RETURNING join_code, status`,
            [generateCode(), type, String(ref), name ? String(name).slice(0, 200) : null],
          ));
        } catch (err) {
          if (err.code !== '23505') throw err; // a join code that happened to collide: try another
        }
      }
      if (!row) throw new Error('Could not create a join code.');
      res.json({ join_code: row.join_code, status: row.status, link: `${publicUrl()}/?code=${row.join_code}` });
    } catch (err) {
      console.error('Service interview error:', err);
      res.status(500).json({ error: 'Could not create the interview link.' });
    }
  });

  return { ready };
}

/** Called when a candidate submits; never holds up their confirmation. */
export function onSubmitted(pool, code) {
  if (!pool) return;
  pool.query('UPDATE interviews SET submitted_at = now() WHERE join_code = $1 AND submitted_at IS NULL', [code])
    .then(() => processInterview(pool, code))
    .catch((err) => console.error('Recruitment processing error:', err));
}

/** Picks up anything a failure or a restart left unfinished. */
export function startRecruitmentTick(pool, ready) {
  const run = async () => {
    try {
      await ready;
      const { rows } = await pool.query(
        `SELECT join_code FROM interviews
          WHERE tracker_ref IS NOT NULL AND status = 'completed' AND result_pushed_at IS NULL
            AND (ai_verdict IS NOT NULL OR scoring_attempts < $1)`,
        [MAX_SCORING_ATTEMPTS],
      );
      for (const { join_code: code } of rows) await processInterview(pool, code);
    } catch (err) {
      log('tick failed —', err.message);
    }
  };
  setTimeout(run, 15000);
  return setInterval(run, TICK_MS());
}
