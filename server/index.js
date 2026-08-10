import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { evaluateReport } from './aiService.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// On the HR platform the app is mounted at hr.rdcc.ai/eval and nginx proxies
// the prefix through unstripped, so every route has to live under it. Empty
// everywhere else, which mounts the router at "/" exactly as before.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const router = express.Router();

// ── Admin API ───────────────────────────────────────────────────────────────
// These endpoints were previously mixed in with the candidate ones under
// /api/, with no server-side authentication at all — the admin password was a
// client-side check compiled into the JS bundle, so anyone could list every
// candidate by requesting /api/interviews directly.
//
// They now live under /api/admin/, which nginx gates with the HR allowlist and
// where it forwards the verified identity as X-Auth-Email. That header can
// only originate from nginx: it is blanked for every inbound request and
// re-set solely from the auth_request result.
//
// REQUIRE_SSO is set on the HR platform. Without it (Railway, local dev) the
// behaviour is unchanged, so those deployments keep working as before.
const REQUIRE_SSO = process.env.REQUIRE_SSO === 'true';
const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
    if (!REQUIRE_SSO) return next();
    const email = req.get('X-Auth-Email');
    if (!email) return res.status(401).json({ error: 'HR sign-in required' });
    req.hrEmail = email;
    next();
});

// Lets the client skip its password screen when the platform already knows who
// this is. Returns null rather than 401 when SSO is off, so the UI can fall
// back to asking for the password.
adminRouter.get('/me', (req, res) => {
    // Only claim an identity when SSO is actually switched on, so a
    // half-configured deployment shows an honest password prompt rather than
    // looping between the login screen and a dashboard that cannot authorise.
    const email = REQUIRE_SSO ? (req.get('X-Auth-Email') || null) : null;
    res.json({ email, sso: REQUIRE_SSO });
});


// Database Initialization
const DATABASE_URL = process.env.DATABASE_URL;
let pool;
let memoryDb = new Map(); // Fallback for local testing without Postgres
let memoryMcqDb = new Map(); // Fallback for MCQ questions locally

if (DATABASE_URL) {
    console.log("Connecting to Postgres database...");
    pool = new Pool({
        connectionString: DATABASE_URL,
        // Railway's Postgres requires TLS; the HR platform's runs on a private
        // Docker network with TLS disabled, and pg fails outright if it asks
        // for a secure connection the server cannot offer. PGSSL=disable opts out.
        ssl: process.env.PGSSL === 'disable'
            ? false
            : process.env.NODE_ENV === 'production'
                ? { rejectUnauthorized: false }
                : false,
    });

    pool.query(`
        CREATE TABLE IF NOT EXISTS interviews (
            id SERIAL PRIMARY KEY,
            join_code VARCHAR(20) UNIQUE NOT NULL,
            assessment_type VARCHAR(50) NOT NULL,
            candidate_details JSONB,
            transcript_answers JSONB,
            ai_report TEXT,
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS kaushal_mcq_questions (
            id SERIAL PRIMARY KEY,
            assessment_type VARCHAR(50) NOT NULL,
            sr_no INT NOT NULL,
            question TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            answer_option VARCHAR(10) NOT NULL,
            time_seconds INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `).then(() => {
        console.log("Postgres tables verified.");
        // Non-destructive addition if table already existed
        return pool.query('ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ai_report TEXT;');
    }).catch(err => console.error("Postgres init error:", err));
} else {
    console.warn("⚠️ No DATABASE_URL found. Using IN-MEMORY database for local testing! Data will be lost on restart. ⚠️");
}

// Helper to generate random 6-character alphanumeric code
const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// -- API ROUTES --

// 1. Admin generates a new interview link
adminRouter.post('/interviews', async (req, res) => {
    const { assessment_type } = req.body;
    if (!assessment_type) return res.status(400).json({ error: "assessment_type required" });

    const code = generateCode();

    try {
        if (pool) {
            const result = await pool.query(
                'INSERT INTO interviews (join_code, assessment_type) VALUES ($1, $2) RETURNING *',
                [code, assessment_type]
            );
            res.json(result.rows[0]);
        } else {
            const record = {
                id: Date.now(),
                join_code: code,
                assessment_type,
                candidate_details: null,
                transcript_answers: null,
                ai_report: null,
                status: 'pending',
                created_at: new Date()
            };
            memoryDb.set(code, record);
            res.json(record);
        }
    } catch (error) {
        console.error("Create Interview Error:", error);
        res.status(500).json({ error: "Server error creating interview" });
    }
});

// 2. Admin fetches all interviews
adminRouter.get('/interviews', async (req, res) => {
    try {
        if (pool) {
            const result = await pool.query('SELECT * FROM interviews ORDER BY created_at DESC');
            res.json(result.rows);
        } else {
            const records = Array.from(memoryDb.values()).sort((a, b) => b.created_at - a.created_at);
            res.json(records);
        }
    } catch (error) {
        res.status(500).json({ error: "Server error fetching interviews" });
    }
});

// 3. Candidate fetches an interview by code
router.get('/api/interviews/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    try {
        if (pool) {
            const result = await pool.query('SELECT * FROM interviews WHERE join_code = $1', [code]);
            if (result.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            res.json(result.rows[0]);
        } else {
            const record = memoryDb.get(code);
            if (!record) return res.status(404).json({ error: "Invalid Join Code" });
            res.json(record);
        }
    } catch (error) {
        res.status(500).json({ error: "Server error fetching interview" });
    }
});

// 4. Candidate submits their interview (Part B)
router.put('/api/interviews/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { candidate_details, transcript_answers } = req.body;

    try {
        if (pool) {
            const check = await pool.query('SELECT status, transcript_answers FROM interviews WHERE join_code = $1', [code]);
            if (check.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            if (check.rows[0].status === 'completed') return res.status(400).json({ error: "Interview already submitted" });

            let dbAnswers = check.rows[0].transcript_answers || {};
            if (typeof dbAnswers === 'string') {
                try { dbAnswers = JSON.parse(dbAnswers); } catch(e) { dbAnswers = {}; }
            }

            let finalAnswers = {};
            if (dbAnswers.part_a) {
                finalAnswers.part_a = dbAnswers.part_a;
                finalAnswers.part_b = { raw: transcript_answers.raw };
            } else {
                finalAnswers = transcript_answers;
            }

            const result = await pool.query(
                'UPDATE interviews SET candidate_details = $1, transcript_answers = $2, status = $3 WHERE join_code = $4 RETURNING *',
                [JSON.stringify(candidate_details), JSON.stringify(finalAnswers), 'completed', code]
            );
            res.json(result.rows[0]);
        } else {
            const record = memoryDb.get(code);
            if (!record) return res.status(404).json({ error: "Invalid Join Code" });
            if (record.status === 'completed') return res.status(400).json({ error: "Interview already submitted" });

            let dbAnswers = record.transcript_answers || {};
            let finalAnswers = {};
            if (dbAnswers.part_a) {
                finalAnswers.part_a = dbAnswers.part_a;
                finalAnswers.part_b = { raw: transcript_answers.raw };
            } else {
                finalAnswers = transcript_answers;
            }

            record.candidate_details = candidate_details;
            record.transcript_answers = finalAnswers;
            record.status = 'completed';
            memoryDb.set(code, record);
            res.json(record);
        }
    } catch (error) {
        console.error("Submit Interview Error:", error);
        res.status(500).json({ error: "Server error submitting interview" });
    }
});

// 4.5. Admin saves AI Report
adminRouter.post('/interviews/:code/report', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { ai_report } = req.body;

    try {
        if (pool) {
            const result = await pool.query(
                'UPDATE interviews SET ai_report = $1 WHERE join_code = $2 RETURNING *',
                [ai_report, code]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            res.json(result.rows[0]);
        } else {
            const record = memoryDb.get(code);
            if (!record) return res.status(404).json({ error: "Invalid Join Code" });
            record.ai_report = ai_report;
            memoryDb.set(code, record);
            res.json(record);
        }
    } catch (error) {
        console.error("Save Report Error:", error);
        res.status(500).json({ error: "Server error saving report" });
    }
});

// MCQ Question Bank Upload Route
adminRouter.post('/interviews/mcq-upload', async (req, res) => {
    const { fileData, assessmentType } = req.body;
    if (!fileData || !assessmentType) {
        return res.status(400).json({ error: "fileData and assessmentType required" });
    }

    try {
        const cleanBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
        const buffer = Buffer.from(cleanBase64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const questions = [];
        let index = 1;
        for (const row of jsonData) {
            const keys = Object.keys(row);
            const getVal = (possibleNames) => {
                const key = keys.find(k => {
                    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return possibleNames.includes(cleanK);
                });
                return key ? row[key] : null;
            };

            const question = getVal(['question', 'q']);
            if (!question) continue;

            const srNo = parseInt(getVal(['srno', 'srnum', 'serialnumber', 'no']), 10) || index;
            const optA = getVal(['optiona', 'opta', 'a', 'option1']) || '';
            const optB = getVal(['optionb', 'optb', 'b', 'option2']) || '';
            const optC = getVal(['optionc', 'optc', 'c', 'option3']) || '';
            const optD = getVal(['optiond', 'optd', 'd', 'option4']) || '';
            const answer = String(getVal(['answeroption', 'answer', 'ans', 'correctoption', 'ansoption', 'correctanswer']) || '').trim().toUpperCase();
            const timeSecs = parseInt(getVal(['timeseconds', 'time', 'seconds', 'duration']), 10) || 30;

            questions.push({
                id: index++,
                sr_no: srNo,
                question: String(question),
                option_a: String(optA),
                option_b: String(optB),
                option_c: String(optC),
                option_d: String(optD),
                answer_option: answer,
                time_seconds: timeSecs
            });
        }

        if (pool) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('DELETE FROM kaushal_mcq_questions WHERE assessment_type = $1', [assessmentType]);
                for (const q of questions) {
                    await client.query(
                        `INSERT INTO kaushal_mcq_questions 
                        (assessment_type, sr_no, question, option_a, option_b, option_c, option_d, answer_option, time_seconds) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [assessmentType, q.sr_no, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.answer_option, q.time_seconds]
                    );
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } else {
            memoryMcqDb.set(assessmentType, questions);
        }

        res.json({ success: true, count: questions.length });
    } catch (error) {
        console.error("MCQ Upload Error:", error);
        res.status(500).json({ error: "Failed to parse and save MCQ questions: " + error.message });
    }
});

// Fetch 25 random MCQ questions for Part A (Security-trimmed, answers excluded)
router.get('/api/interviews/:code/mcq', async (req, res) => {
    const code = req.params.code.toUpperCase();
    try {
        let assessmentType = null;
        if (pool) {
            const check = await pool.query('SELECT assessment_type FROM interviews WHERE join_code = $1', [code]);
            if (check.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            assessmentType = check.rows[0].assessment_type;
        } else {
            const record = memoryDb.get(code);
            if (!record) return res.status(404).json({ error: "Invalid Join Code" });
            assessmentType = record.assessment_type;
        }

        if (assessmentType !== 'kaushal_mm' && assessmentType !== 'kaushal_tech' && assessmentType !== 'kaushal_batching') {
            return res.json([]);
        }

        let questions = [];
        if (pool) {
            const result = await pool.query(
                `SELECT id, sr_no, question, option_a, option_b, option_c, option_d, time_seconds 
                 FROM kaushal_mcq_questions 
                 WHERE assessment_type = $1 
                 ORDER BY RANDOM() 
                 LIMIT 25`,
                [assessmentType]
            );
            questions = result.rows;
        } else {
            const allQ = memoryMcqDb.get(assessmentType) || [];
            const shuffled = [...allQ].sort(() => 0.5 - Math.random());
            questions = shuffled.slice(0, 25).map(q => ({
                id: q.id,
                sr_no: q.sr_no,
                question: q.question,
                option_a: q.option_a,
                option_b: q.option_b,
                option_c: q.option_c,
                option_d: q.option_d,
                time_seconds: q.time_seconds
            }));
        }

        res.json(questions);
    } catch (error) {
        console.error("Fetch MCQ Error:", error);
        res.status(500).json({ error: "Server error fetching MCQ questions" });
    }
});

// Grade Part A (MCQ) selections on the server and update database
router.post('/api/interviews/:code/part-a', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { answers } = req.body;

    if (!answers) return res.status(400).json({ error: "answers required" });

    try {
        let interview = null;
        if (pool) {
            const check = await pool.query('SELECT * FROM interviews WHERE join_code = $1', [code]);
            if (check.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            interview = check.rows[0];
        } else {
            interview = memoryDb.get(code);
            if (!interview) return res.status(404).json({ error: "Invalid Join Code" });
        }

        if (interview.status === 'completed') {
            return res.status(400).json({ error: "Interview already submitted" });
        }

        const assessmentType = interview.assessment_type;
        let dbQuestions = [];

        if (pool) {
            const result = await pool.query(
                `SELECT id, sr_no, question, option_a, option_b, option_c, option_d, answer_option, time_seconds 
                 FROM kaushal_mcq_questions 
                 WHERE assessment_type = $1`,
                [assessmentType]
            );
            dbQuestions = result.rows;
        } else {
            dbQuestions = memoryMcqDb.get(assessmentType) || [];
        }

        const dbMap = new Map(dbQuestions.map(q => [String(q.id), q]));

        let score = 0;
        let total = 0;
        const details = [];

        for (const [qId, selectedOption] of Object.entries(answers)) {
            const q = dbMap.get(String(qId));
            if (!q) continue;

            const correctOption = q.answer_option.trim().toUpperCase();
            const cleanSelected = String(selectedOption || '').trim().toUpperCase();
            const isCorrect = cleanSelected === correctOption;

            if (isCorrect) score++;
            total++;

            details.push({
                question_id: q.id,
                sr_no: q.sr_no,
                question: q.question,
                option_a: q.option_a,
                option_b: q.option_b,
                option_c: q.option_c,
                option_d: q.option_d,
                selected_option: cleanSelected || 'No Answer',
                correct_option: correctOption,
                is_correct: isCorrect
            });
        }

        details.sort((a, b) => a.sr_no - b.sr_no);

        const partAData = {
            score,
            total,
            questions: details
        };

        let currentAnswers = interview.transcript_answers || {};
        if (typeof currentAnswers === 'string') {
            try { currentAnswers = JSON.parse(currentAnswers); } catch(e) { currentAnswers = {}; }
        }
        currentAnswers.part_a = partAData;

        if (pool) {
            await pool.query(
                'UPDATE interviews SET transcript_answers = $1 WHERE join_code = $2',
                [JSON.stringify(currentAnswers), code]
            );
        } else {
            interview.transcript_answers = currentAnswers;
            memoryDb.set(code, interview);
        }

        res.json({ score, total, success: true });
    } catch (error) {
        console.error("Grade Part A Error:", error);
        res.status(500).json({ error: "Server error grading MCQ answers" });
    }
});

// 5. Admin deletes an interview
adminRouter.delete('/interviews/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    
    try {
        if (pool) {
            const result = await pool.query('DELETE FROM interviews WHERE join_code = $1 RETURNING *', [code]);
            if (result.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            res.json({ success: true });
        } else {
            if (!memoryDb.has(code)) return res.status(404).json({ error: "Invalid Join Code" });
            memoryDb.delete(code);
            res.json({ success: true });
        }
    } catch (error) {
        console.error("Delete Interview Error:", error);
        res.status(500).json({ error: "Server error deleting interview" });
    }
});

// 6. Secure AI evaluation proxy
adminRouter.post('/evaluate', async (req, res) => {
    const { reportText, type, fileData, mimeType } = req.body;
    if (!reportText && !fileData) {
        return res.status(400).json({ error: "reportText or fileData required for evaluation" });
    }

    try {
        const result = await evaluateReport(reportText, type, fileData, mimeType);
        res.json({ result });
    } catch (error) {
        console.error("AI Evaluation proxy error:", error);
        res.status(500).json({ error: error.message || "Failed to evaluate report using AI backend proxy." });
    }
});

router.use('/api/admin', adminRouter);

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    router.use(express.static(path.join(process.cwd(), 'dist')));
    router.use((req, res) => {
        res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
}

app.use(BASE_PATH || '/', router);

// Unprefixed health check, so container and uptime probes can hit the service
// directly without knowing the mount path.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
