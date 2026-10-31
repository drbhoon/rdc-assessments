/**
 * Scoring a Fresher or Sales interview on the server, as data.
 *
 * The HR console's older path has the model write the whole report as HTML and
 * only runs when someone clicks Evaluate, so the score exists only as text in a
 * page. The Recruitment Tracker needs it as a number, as soon as the candidate
 * submits. The rules and the look of the report are the same.
 *
 * The model judges each answer. Everything arithmetic is done here: the ten-word
 * rule, the total, the percentage and the HIRE / BORDERLINE / REJECT verdict.
 */
import { respond } from '../openai.js';
import { escapeHtml } from '../reports/render.js';
import { CANDIDATE_QUESTIONS_HEADING } from '../../shared/taraInterview.js';

export const TRACKS = {
  recruitment: {
    label: 'Fresher Recruitment',
    title: 'Candidate Recruitment Assessment - Fresher',
    persona: 'You are the RMC Operational Auditor evaluating Fresher candidates. Hunt for Operational Grit.',
    hire: 75,
    borderline: 65,
  },
  sales_recruitment: {
    label: 'Sales Recruitment',
    title: 'Candidate Recruitment Assessment - Sales',
    persona: 'You are the RDC Sales Auditor evaluating field sales candidates. Score using Behavioral STAR indicators (Situation, Task, Action, Result).',
    hire: 70,
    borderline: 55,
  },
};

const MIN_WORDS = 10;
const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * The questions and answers in a submitted transcript, as RecruitmentTab writes
 * it: "--- Q1: question ---" then "Candidate Answer: answer". The candidate's own
 * closing questions to RDC come after the last answer and are not scored.
 */
export function parseTranscript(raw) {
  const text = String(raw || '').split(CANDIDATE_QUESTIONS_HEADING)[0];
  const name = (text.match(/^Name:\s*(.+)$/m) || [])[1];
  const questions = [];
  const pattern = /--- Q\d+: ([\s\S]*?) ---\s*\nCandidate Answer: ([\s\S]*?)(?=\n--- Q\d+: |\s*$)/g;
  for (const m of text.matchAll(pattern)) {
    const answer = m[2].trim();
    questions.push({ question: m[1].trim(), answer: answer === 'No answer provided.' ? '' : answer });
  }
  return { name: name && name.trim() !== 'N/A' ? name.trim() : '', questions };
}

export function verdictFor(track, percent) {
  const t = TRACKS[track];
  if (percent >= t.hire) return 'HIRE';
  if (percent >= t.borderline) return 'BORDERLINE';
  return 'REJECT';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'integer' }, // strict schemas take no range: the prompt states 1-5 and tally() enforces it
          insight: { type: 'string' },
        },
        required: ['score', 'insight'],
      },
    },
    executive_summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    roadmap: { type: 'array', items: { type: 'string' } },
  },
  required: ['answers', 'executive_summary', 'strengths', 'gaps', 'roadmap'],
};

/** Totals the model's judgements. Pure, so the arithmetic can be tested alone. */
export function tally(track, questions, judged) {
  const scored = questions.map((q, i) => {
    const j = (judged.answers || [])[i];
    if (wordCount(q.answer) < MIN_WORDS) {
      return { question: q.question, score: 0, insight: q.answer ? 'Answer under ten words: scored zero under the assessment rule.' : 'No answer given.' };
    }
    return {
      question: q.question,
      score: Math.max(1, Math.min(5, Math.round(Number(j?.score) || 1))),
      insight: String(j?.insight || 'Not assessed.'),
    };
  });
  const points = scored.reduce((n, q) => n + q.score, 0);
  const max = questions.length * 5;
  const percent = max ? Math.round((points / max) * 1000) / 10 : 0;
  const three = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 3) : []);
  return {
    questions: scored,
    points,
    max,
    percent,
    verdict: verdictFor(track, percent),
    executive_summary: String(judged.executive_summary || ''),
    strengths: three(judged.strengths),
    gaps: three(judged.gaps),
    roadmap: three(judged.roadmap),
  };
}

export async function scoreTranscript(track, raw) {
  const { name, questions } = parseTranscript(raw);
  if (!questions.length) throw new Error('No questions could be read from the transcript.');
  const judged = await respond({
    instructions: `${TRACKS[track].persona}

Score every answer in the transcript from 1 to 5, in order, one entry per question. "insight" is a detailed observation on that answer.
The transcript may be spoken English or Hinglish captured by speech recognition: judge the meaning, not the grammar.
"executive_summary" is 2-3 sentences on the candidate's core competencies and readiness.
"strengths", "gaps" and "roadmap" have exactly three items each; roadmap items are actionable steps.
Do not score or comment on any questions the candidate asks RDC.`,
    input: raw,
    schema: SCHEMA,
    schemaName: 'recruitment_evaluation',
    maxOutputTokens: 12000,
  });
  return { name, ...tally(track, questions, judged) };
}

/** The same report the HR console has always shown, drawn from the scores. */
export function reportHtml(track, name, r) {
  const li = (items) => items.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const rows = r.questions.map((q) => `
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(q.question)}</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${q.score}/5</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(q.insight)}</td>
        </tr>`).join('');
  return `<div style="font-family: sans-serif; border: 1px solid #e0e0e0; padding: 25px; border-radius: 8px; background: #fff;">
<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2E7D32; padding-bottom: 15px;">
    <div>
        <h1 style="margin: 0; color: #2E7D32;">${TRACKS[track].title}</h1>
        <p style="margin: 5px 0; color: #666;">Candidate: <strong>${escapeHtml(name || 'Candidate')}</strong></p>
    </div>
    <div style="text-align: right;">
        <div style="font-size: 24px; font-weight: bold; color: #F57C00;">${r.percent}%</div>
        <div style="font-size: 12px; text-transform: uppercase; color: #F57C00;">${r.points}/${r.max} pts | ${r.verdict}</div>
    </div>
</div>
<br>
<h3 style="color: #2E7D32;">Executive Summary</h3>
<p style="line-height: 1.6;">${escapeHtml(r.executive_summary)}</p>
<div style="display: flex; gap: 20px; margin: 20px 0;">
    <div style="flex: 1; background: #E8F5E9; padding: 15px; border-radius: 5px;">
        <strong style="color: #2E7D32;">✓ Core Strengths</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">${li(r.strengths)}</ul>
    </div>
    <div style="flex: 1; background: #FFF3E0; padding: 15px; border-radius: 5px;">
        <strong style="color: #E65100;">⚠ Priority Gaps</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">${li(r.gaps)}</ul>
    </div>
</div>
<br>
<h3 style="color: #2E7D32;">Performance Breakdown</h3>
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <thead>
        <tr style="background-color: #f5f5f5;">
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Area / Question</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Rating (0-5)</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Evaluator Insight</th>
        </tr>
    </thead>
    <tbody>${rows}</tbody>
</table>
<br>
<div style="border: 2px dashed #2E7D32; padding: 15px; border-radius: 8px;">
    <h3 style="margin-top: 0; color: #2E7D32;">Post-Assessment Roadmap / Suggestions</h3>
    <ol style="line-height: 1.8; margin-bottom: 0;">${li(r.roadmap)}</ol>
</div>
</div>`;
}
