/**
 * Gemini calls for monthly trainee reports.
 *
 * Scoring follows the rules the Operations and Sales evaluators have always
 * used — the same six criteria, 1 to 5 each, out of 30, and zero for any
 * section under ten words. The difference is the output: the old screen asked
 * the model to write the whole report as HTML, so the score existed only as
 * text inside markup. Here it returns the scores as data; the app adds them up,
 * renders the report and writes the Excel summary from the same numbers.
 */
import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-2.5-flash';

export const CRITERIA = {
  ops: [
    'Contributions to SARTAJ Improvement',
    'Engagement and Knowledge Sharing',
    'Curiosity and Observations',
    'Practical Work and Skill Development',
    'Challenges Faced and Resolutions',
    'Plan for Next Month',
  ],
  sales: [
    'Contribution to Sales Improvement',
    'Engagement and Knowledge Sharing',
    'Curiosity and Observations',
    'Practical Work and Skill Development',
    'Challenges Faced and Resolutions',
    'Plan for Next Month',
  ],
};

export const MAX_POINTS = 30;

const PERSONA = {
  ops: `You are a ready mix concrete (RMC) industry expert with deep knowledge across all RMC plant functions:
Operations, QC, Sales, Accounts, Logistics, Maintenance, and HSE.
You are evaluating a monthly progress report from a Graduate/Diploma Engineer Trainee.`,
  sales: `You are an RMC industry sales expert evaluating a Monthly Progress Report submitted by a Sales Trainee.
Be rigorous and honest.`,
};

const SPECIAL = {
  ops: '',
  sales: '\nFor "Contribution to Sales Improvement": score 0 if the trainee generated zero actual concrete volume.',
};

function evaluationPrompt(track) {
  const list = CRITERIA[track].map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `${PERSONA[track]}

## Assessment Criteria (score each 1 to 5)
${list}
${SPECIAL[track]}
Max Points: ${MAX_POINTS}.

## MINIMUM WORD COUNT RULE - CRITICAL
If the trainee's entry for a criterion contains fewer than 10 words (or is completely blank or missing),
you MUST award exactly ZERO (0) for that criterion. No exceptions.

## OUTPUT
Return JSON only, matching the schema. "criteria" must list the six criteria above, in that order,
with their exact names. "insight" is a detailed observation on that specific area (2-3 sentences).
"executive_summary" is 2-3 sentences on the trainee's core competencies and readiness.
"strengths", "gaps" and "roadmap" have exactly three items each; the roadmap items are actionable steps.`;
}

const EVALUATION_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 5 },
          insight: { type: 'string' },
        },
        required: ['name', 'score', 'insight'],
      },
    },
    executive_summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    roadmap: { type: 'array', items: { type: 'string' } },
  },
  required: ['criteria', 'executive_summary', 'strengths', 'gaps', 'roadmap'],
};

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['copied', 'repeated', 'template', 'coincidental'] },
    explanation: { type: 'string' },
  },
  required: ['verdict', 'explanation'],
};

let client = null;
function ai() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API Key is not set in environment variables on the backend.');
  }
  if (!client) {
    // GEMINI_BASE_URL is unset in every real deployment; it exists so the
    // whole cycle can be exercised locally against a stand-in.
    const httpOptions = process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined;
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions });
  }
  return client;
}

/** Gemini is often briefly overloaded; three tries with a pause between. */
async function generate(request) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await ai().models.generateContent(request);
    } catch (err) {
      last = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  throw last;
}

function parseJson(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(clean);
}

/** The report as Gemini content: the file itself when it can read one, else text. */
export function reportContent({ fileData, mime, text }) {
  const visual = mime === 'application/pdf' || String(mime || '').startsWith('image/');
  if (visual && fileData) {
    return [
      { inlineData: { mimeType: mime, data: Buffer.from(fileData).toString('base64') } },
      'Please evaluate this monthly report according to your system instructions.',
    ];
  }
  return `Monthly report:\n\n${text || ''}`;
}

/**
 * Score one report.
 * @returns { criteria:[{name,score,insight}], executive_summary, strengths, gaps, roadmap,
 *            points, percent }
 */
export async function evaluateReport(track, report) {
  const response = await generate({
    model: MODEL,
    contents: reportContent(report),
    config: {
      systemInstruction: evaluationPrompt(track),
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseJsonSchema: EVALUATION_SCHEMA,
    },
  });
  const raw = parseJson(response.text);

  // The six criteria are ours, not the model's: match by position, keep our
  // names, clamp each score to 0-5. A missing criterion scores zero rather
  // than silently shrinking the total.
  const criteria = CRITERIA[track].map((name, i) => {
    const got = Array.isArray(raw.criteria) ? raw.criteria[i] : null;
    const score = Math.max(0, Math.min(5, Math.round(Number(got?.score) || 0)));
    return { name, score, insight: String(got?.insight || 'Not assessed.') };
  });
  const points = criteria.reduce((n, c) => n + c.score, 0);
  const three = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 3) : []);

  return {
    criteria,
    executive_summary: String(raw.executive_summary || ''),
    strengths: three(raw.strengths),
    gaps: three(raw.gaps),
    roadmap: three(raw.roadmap),
    points,
    percent: Math.round((points / MAX_POINTS) * 1000) / 10,
  };
}

/** Plain text of a scanned report, so it can be compared with the others. */
export async function transcribe({ fileData, mime }) {
  const response = await generate({
    model: MODEL,
    contents: [
      { inlineData: { mimeType: mime, data: Buffer.from(fileData).toString('base64') } },
      'Transcribe all of the text in this document exactly as written, in reading order. Output the text only, with no commentary.',
    ],
    config: { temperature: 0 },
  });
  return String(response.text || '').trim();
}

/**
 * Is an overlap the detector found genuine copying, or shared template text?
 *
 * @param flag  { kind: 'copy'|'repeat', share, passages:[{text}] }
 * @param who   { subject, other } human labels, e.g. "Ravi Kumar (A01234), September 2026"
 * @returns { verdict, explanation }
 */
export async function judgeOverlap(flag, who) {
  const relation = flag.kind === 'repeat'
    ? `the same trainee's own earlier report (${who.other})`
    : `another trainee's report (${who.other})`;
  const passages = flag.passages.map((p, i) => `Passage ${i + 1} (${p.words} words):\n"${p.text}"`).join('\n\n');

  const response = await generate({
    model: MODEL,
    contents: `A monthly trainee report by ${who.subject} shares ${flag.share}% of its content with ${relation}.
The longest identical passages are below (lower-cased, punctuation removed).

${passages}

Decide which it is:
- "copied": substantive content (work done, observations, numbers, plans) taken from another trainee's report.
- "repeated": substantive content carried over unchanged from the trainee's own earlier report.
- "template": the shared words are the report form's headings, instructions or standard phrases every trainee uses.
- "coincidental": generic wording any two people could write independently.

Give a one or two sentence explanation HR can read, naming what was shared.`,
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: JUDGE_SCHEMA,
    },
  });
  const raw = parseJson(response.text);
  const verdicts = ['copied', 'repeated', 'template', 'coincidental'];
  return {
    verdict: verdicts.includes(raw.verdict) ? raw.verdict : 'copied',
    explanation: String(raw.explanation || ''),
  };
}
