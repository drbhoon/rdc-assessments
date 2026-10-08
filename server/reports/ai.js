/**
 * AI calls for monthly trainee reports (OpenAI, through ../openai.js).
 *
 * Scoring follows the rules the Operations and Sales evaluators have always
 * used — the same six criteria, 1 to 5 each, out of 30, and zero for any
 * section under ten words. The difference is the output: the old screen asked
 * the model to write the whole report as HTML, so the score existed only as
 * text inside markup. Here it returns the scores as data; the app adds them up,
 * renders the report and writes the Excel summary from the same numbers.
 */
import { fileInput, readableFile, respond } from '../openai.js';

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
Return JSON matching the schema. "criteria" must list the six criteria above, in that order,
with their exact names. "insight" is a detailed observation on that specific area (2-3 sentences).
"executive_summary" is 2-3 sentences on the trainee's core competencies and readiness.
"strengths", "gaps" and "roadmap" have exactly three items each; the roadmap items are actionable steps.`;
}

// Strict structured output: every object closed, every field required. The
// 0-5 range is stated in the prompt and enforced in code below.
const EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          score: { type: 'integer' },
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
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['copied', 'repeated', 'template', 'coincidental'] },
    explanation: { type: 'string' },
  },
  required: ['verdict', 'explanation'],
};

/** The report as model input: the file itself when it can read one, else text. */
export function reportContent({ fileData, mime, text }) {
  if (readableFile(mime) && fileData) {
    return fileInput(
      { data: fileData, mime },
      'Please evaluate this monthly report according to your system instructions.',
    );
  }
  return `Monthly report:\n\n${text || ''}`;
}

/**
 * Score one report.
 * @returns { criteria:[{name,score,insight}], executive_summary, strengths, gaps, roadmap,
 *            points, percent }
 */
export async function evaluateReport(track, report) {
  const raw = await respond({
    instructions: evaluationPrompt(track),
    input: reportContent(report),
    schema: EVALUATION_SCHEMA,
    schemaName: 'trainee_report_evaluation',
  });

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
  const text = await respond({
    instructions: 'You transcribe documents. Output the text only, with no commentary.',
    input: fileInput(
      { data: fileData, mime },
      'Transcribe all of the text in this document exactly as written, in reading order. Output the text only, with no commentary.',
    ),
    maxOutputTokens: 16000,
  });
  return String(text || '').trim();
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

  const raw = await respond({
    instructions: 'You help HR review overlap between monthly trainee reports. Reply in JSON matching the schema.',
    schema: JUDGE_SCHEMA,
    schemaName: 'overlap_judgement',
    maxOutputTokens: 2000,
    input: `A monthly trainee report by ${who.subject} shares ${flag.share}% of its content with ${relation}.
The longest identical passages are below (lower-cased, punctuation removed).

${passages}

Decide which it is:
- "copied": substantive content (work done, observations, numbers, plans) taken from another trainee's report.
- "repeated": substantive content carried over unchanged from the trainee's own earlier report.
- "template": the shared words are the report form's headings, instructions or standard phrases every trainee uses.
- "coincidental": generic wording any two people could write independently.

Give a one or two sentence explanation HR can read, naming what was shared.`,
  });
  const verdicts = ['copied', 'repeated', 'template', 'coincidental'];
  return {
    verdict: verdicts.includes(raw.verdict) ? raw.verdict : 'copied',
    explanation: String(raw.explanation || ''),
  };
}
