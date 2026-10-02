/**
 * Tables for monthly trainee report cycles (Operations and Sales).
 *
 *   report_cycles       one per HR launch: track, month, the two deadlines
 *   report_assignments  one per trainee in a cycle: their upload, the AI
 *                       evaluation, the copy/repeat flags, the supervisor's
 *                       rating, and what was e-mailed when
 *   report_supervisors  one per supervisor per cycle: the single link that
 *                       lists all of that supervisor's trainees
 *   report_overlap_judgements
 *                       the AI's verdict on each overlap the detector found,
 *                       kept so a re-check never pays for the same question
 *                       twice and a flag never changes its explanation
 *
 * Every report ever submitted stays in report_assignments, which is what the
 * "repeats an earlier report" check reads. Nothing older exists: the previous
 * upload screen evaluated reports in the browser and stored nothing.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS report_cycles (
    id SERIAL PRIMARY KEY,
    track VARCHAR(10) NOT NULL,
    period_label TEXT NOT NULL,
    submit_by TIMESTAMPTZ NOT NULL,
    review_by TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'collecting',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    eval_started_at TIMESTAMPTZ,
    eval_heartbeat_at TIMESTAMPTZ,
    evaluated_at TIMESTAMPTZ,
    trainees_reminded_at TIMESTAMPTZ,
    supervisors_reminded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS report_assignments (
    id SERIAL PRIMARY KEY,
    cycle_id INT NOT NULL REFERENCES report_cycles(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    trainee_code TEXT NOT NULL,
    trainee_name TEXT NOT NULL,
    trainee_email TEXT NOT NULL,
    trainee_location TEXT,
    trainee_designation TEXT,
    person_id TEXT,
    supervisor_code TEXT NOT NULL,
    supervisor_name TEXT NOT NULL,
    supervisor_email TEXT NOT NULL,
    reopen_until TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    invite_error TEXT,
    file_name TEXT,
    file_mime TEXT,
    file_size INT,
    file_data BYTEA,
    submitted_at TIMESTAMPTZ,
    submitted_by TEXT,
    report_text TEXT,
    text_source VARCHAR(10),
    eval_status VARCHAR(12) NOT NULL DEFAULT 'pending',
    eval_error TEXT,
    evaluated_at TIMESTAMPTZ,
    ai_result JSONB,
    ai_percent NUMERIC(5,1),
    ai_points NUMERIC(5,1),
    flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    flags_checked_at TIMESTAMPTZ,
    supervisor_rating SMALLINT,
    supervisor_comments TEXT,
    reviewed_at TIMESTAMPTZ,
    results_sent_at TIMESTAMPTZ,
    results_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cycle_id, trainee_code)
);
CREATE INDEX IF NOT EXISTS report_assignments_trainee ON report_assignments (trainee_code);

CREATE TABLE IF NOT EXISTS report_supervisors (
    id SERIAL PRIMARY KEY,
    cycle_id INT NOT NULL REFERENCES report_cycles(id) ON DELETE CASCADE,
    supervisor_code TEXT NOT NULL,
    supervisor_name TEXT NOT NULL,
    supervisor_email TEXT NOT NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    notified_at TIMESTAMPTZ,
    notify_error TEXT,
    reminded_at TIMESTAMPTZ,
    UNIQUE (cycle_id, supervisor_code)
);

CREATE TABLE IF NOT EXISTS report_overlap_judgements (
    subject_id INT NOT NULL REFERENCES report_assignments(id) ON DELETE CASCADE,
    other_id INT NOT NULL REFERENCES report_assignments(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    verdict VARCHAR(20) NOT NULL,
    explanation TEXT,
    judged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_id, other_id)
);
`;

let ready = null;

/** Creates the tables once per process; every route awaits the same promise. */
export function ensureReportSchema(pool) {
  if (!ready) {
    ready = pool.query(DDL).catch((err) => {
      ready = null; // let the next request try again rather than failing forever
      throw err;
    });
  }
  return ready;
}
