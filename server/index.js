import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database Initialization
const DATABASE_URL = process.env.DATABASE_URL;
let pool;
let memoryDb = new Map(); // Fallback for local testing without Postgres

if (DATABASE_URL) {
    console.log("Connecting to Postgres database...");
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    pool.query(`
        CREATE TABLE IF NOT EXISTS interviews (
            id SERIAL PRIMARY KEY,
            join_code VARCHAR(20) UNIQUE NOT NULL,
            assessment_type VARCHAR(50) NOT NULL,
            candidate_details JSONB,
            transcript_answers JSONB,
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `).then(() => console.log("Postgres tables verified."))
      .catch(err => console.error("Postgres init error:", err));
} else {
    console.warn("⚠️ No DATABASE_URL found. Using IN-MEMORY database for local testing! Data will be lost on restart. ⚠️");
}

// Helper to generate random 6-character alphanumeric code
const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// -- API ROUTES --

// 1. Admin generates a new interview link
app.post('/api/interviews', async (req, res) => {
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
app.get('/api/interviews', async (req, res) => {
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
app.get('/api/interviews/:code', async (req, res) => {
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

// 4. Candidate submits their interview
app.put('/api/interviews/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { candidate_details, transcript_answers } = req.body;

    try {
        if (pool) {
            const check = await pool.query('SELECT status FROM interviews WHERE join_code = $1', [code]);
            if (check.rows.length === 0) return res.status(404).json({ error: "Invalid Join Code" });
            if (check.rows[0].status === 'completed') return res.status(400).json({ error: "Interview already submitted" });

            const result = await pool.query(
                'UPDATE interviews SET candidate_details = $1, transcript_answers = $2, status = $3 WHERE join_code = $4 RETURNING *',
                [JSON.stringify(candidate_details), JSON.stringify(transcript_answers), 'completed', code]
            );
            res.json(result.rows[0]);
        } else {
            const record = memoryDb.get(code);
            if (!record) return res.status(404).json({ error: "Invalid Join Code" });
            if (record.status === 'completed') return res.status(400).json({ error: "Interview already submitted" });

            record.candidate_details = candidate_details;
            record.transcript_answers = transcript_answers;
            record.status = 'completed';
            memoryDb.set(code, record);
            res.json(record);
        }
    } catch (error) {
        console.error("Submit Interview Error:", error);
        res.status(500).json({ error: "Server error submitting interview" });
    }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.use((req, res) => {
        res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
